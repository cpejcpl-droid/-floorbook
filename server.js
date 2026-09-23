require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

const MACHINES = [
  { id: 'PP50-1', name: 'Power Press', tag: '50 T' },
  { id: 'PP10-1', name: 'Power Press #1', tag: '10 T' },
  { id: 'PP10-2', name: 'Power Press #2', tag: '10 T' },
  { id: 'PP10-3', name: 'Power Press #3', tag: '10 T' },
  { id: 'OR-1', name: 'Orbital Riveting', tag: '—' },
];

const SUPERVISOR_EMAIL = process.env.SUPERVISOR_EMAIL || '';
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter = null;
if (GMAIL_USER && GMAIL_APP_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
} else {
  console.warn('[floorbook] GMAIL_USER / GMAIL_APP_PASSWORD not set — email notifications are disabled.');
}

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM; // e.g. whatsapp:+14155238886
const SUPERVISOR_WHATSAPP = process.env.SUPERVISOR_WHATSAPP || ''; // e.g. whatsapp:+919876543210

let twilioClient = null;
if (TWILIO_SID && TWILIO_TOKEN && TWILIO_WHATSAPP_FROM) {
  twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
} else {
  console.warn('[floorbook] Twilio env vars not set — WhatsApp notifications are disabled.');
}

function readBookings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return []; }
}
function writeBookings(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}
function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }

function buildICS(b, machineName) {
  const uid = b.id + '@floorbook.local';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const dt = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
  const desc = `Machine: ${machineName} (${b.machine})\\nOperator: ${b.operator || '-'}\\nQuantity: ${b.qty || '-'} pcs`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FloorBook//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid, 'DTSTAMP:' + stamp,
    'DTSTART:' + dt(b.date, b.start), 'DTEND:' + dt(b.date, b.end),
    'SUMMARY:' + (b.job || 'Machine booking') + ' — ' + machineName,
    'DESCRIPTION:' + desc,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

async function sendWhatsApp(b, machineName) {
  if (!twilioClient) return { sent: false, reason: 'not_configured' };
  const norm = (p) => p ? 'whatsapp:' + p.replace(/[^0-9+]/g, '') : null;
  const recipients = new Set([
    norm(b.opWhatsapp),
    norm(b.bookedByWhatsapp),
    SUPERVISOR_WHATSAPP || null,
  ].filter(Boolean));
  if (recipients.size === 0) return { sent: false, reason: 'no_recipient' };
  const body = `*Floor Book — machine booked*\n\n${machineName} (${b.machine})\nDate: ${b.date}\nTime: ${b.start}–${b.end}\nJob: ${b.job}\nOperator: ${b.operator || '-'}\nBooked by: ${b.bookedBy || '-'}\nQty: ${b.qty || '-'} pcs`;
  let anySent = false;
  for (const to of recipients) {
    try {
      await twilioClient.messages.create({ from: TWILIO_WHATSAPP_FROM, to, body });
      anySent = true;
    } catch (e) {
      console.error(`[floorbook] WhatsApp send to ${to} failed:`, e.message);
    }
  }
  return anySent ? { sent: true } : { sent: false, reason: 'send_error' };
}

async function notify(b) {
  const machine = MACHINES.find(m => m.id === b.machine);
  const machineName = machine ? machine.name : b.machine;
  const email = await sendEmail(b, machineName);
  const whatsapp = await sendWhatsApp(b, machineName);
  return { email, whatsapp };
}

async function sendEmail(b, machineName) {
  if (!transporter) return { sent: false, reason: 'not_configured' };
  const ics = buildICS(b, machineName);
  const to = b.opEmail || SUPERVISOR_EMAIL;
  if (!to) return { sent: false, reason: 'no_recipient' };
  const cc = b.opEmail && SUPERVISOR_EMAIL ? [SUPERVISOR_EMAIL] : [];
  const subject = `Machine booked: ${machineName} — ${b.job}`;
  const text = `${b.operator || 'Team'},\n\nA booking was made on ${machineName} (${b.machine}).\n\nDate: ${b.date}\nTime: ${b.start}–${b.end}\nJob / part no.: ${b.job}\nOperator: ${b.operator || '-'}\nQuantity: ${b.qty || '-'} pcs\n\nA calendar invite is attached.\n\n— Floor Book`;
  try {
    await transporter.sendMail({
      from: `"Floor Book" <${GMAIL_USER}>`,
      to, cc, subject, text,
      attachments: [{ filename: 'booking.ics', content: ics, contentType: 'text/calendar' }],
    });
    return { sent: true };
  } catch (e) {
    console.error('[floorbook] email failed:', e.message);
    return { sent: false, reason: 'send_error' };
  }
}

app.get('/api/machines', (req, res) => res.json(MACHINES));

app.get('/api/bookings', (req, res) => res.json(readBookings()));

app.post('/api/bookings', async (req, res) => {
  const b = req.body || {};
  if (!b.machine || !b.date || !b.start || !b.end || !b.job) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (toMin(b.start) >= toMin(b.end)) {
    return res.status(400).json({ error: 'End time must be after start time.' });
  }
  const list = readBookings();
  const conflict = list.find(x => x.machine === b.machine && x.date === b.date &&
    toMin(b.start) < toMin(x.end) && toMin(b.end) > toMin(x.start));
  if (conflict) {
    return res.status(409).json({ error: `Clash with "${conflict.job}" (${conflict.start}–${conflict.end}) on this machine.` });
  }
  const record = { id: 'b' + Date.now(), machine: b.machine, date: b.date, start: b.start, end: b.end, qty: b.qty || '', job: b.job, operator: b.operator || '', opEmail: b.opEmail || '', opWhatsapp: b.opWhatsapp || '', bookedBy: b.bookedBy || '', bookedByWhatsapp: b.bookedByWhatsapp || '' };
  list.push(record);
  writeBookings(list);
  const result = await notify(record);
  res.json({ booking: record, notify: result });
});

app.put('/api/bookings/:id', async (req, res) => {
  const list = readBookings();
  const idx = list.findIndex(x => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found.' });
  const b = req.body || {};
  if (toMin(b.start) >= toMin(b.end)) return res.status(400).json({ error: 'End time must be after start time.' });
  const conflict = list.find(x => x.id !== req.params.id && x.machine === b.machine && x.date === b.date &&
    toMin(b.start) < toMin(x.end) && toMin(b.end) > toMin(x.start));
  if (conflict) return res.status(409).json({ error: `Clash with "${conflict.job}" (${conflict.start}–${conflict.end}) on this machine.` });
  list[idx] = { ...list[idx], ...b, id: req.params.id };
  writeBookings(list);
  res.json({ booking: list[idx] });
});

app.delete('/api/bookings/:id', (req, res) => {
  const list = readBookings().filter(x => x.id !== req.params.id);
  writeBookings(list);
  res.json({ ok: true });
});

app.get('/api/bookings/:id/ics', (req, res) => {
  const b = readBookings().find(x => x.id === req.params.id);
  if (!b) return res.status(404).send('Not found');
  const machine = MACHINES.find(m => m.id === b.machine);
  const ics = buildICS(b, machine ? machine.name : b.machine);
  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', `attachment; filename="${(b.job || 'booking').replace(/[^a-z0-9]+/gi, '_')}.ics"`);
  res.send(ics);
});

app.post('/api/bookings/:id/notify', async (req, res) => {
  const b = readBookings().find(x => x.id === req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found.' });
  const result = await notify(b);
  res.json({ notify: result });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Floor Book running on http://localhost:${PORT}`));
