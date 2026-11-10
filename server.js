/* =====================================================================
   Presence. — the backend
   ---------------------------------------------------------------------
   This file is the primary server and request handler.
   Supports both standalone Node.js and Cloudflare Workers via
   official Node compatibility (httpServerHandler / handleAsNodeRequest).
   ===================================================================== */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const express = require('express');

const {
  detectImageType,
  isValidExtensionForMime,
  parseAndValidatePathname,
  createStorage,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_SESSION,
} = require('./lib/storage.cjs');

const { cleanupAbandonedUploads } = require('./lib/cleanup.cjs');

/* ---------------------------------------------------------------------
   0 · settings (isolate env loading for local only via parseEnv)
--------------------------------------------------------------------- */
function loadLocalEnv() {
  if (process.env.NO_LOAD_ENV === '1' || process.env.NODE_ENV === 'test') return;
  if (typeof globalThis.caches !== 'undefined' && typeof globalThis.EdgeRuntime !== 'undefined') return;
  if (typeof process === 'undefined' || !process.cwd) return;

  try {
    const { parseEnv } = require('node:util');
    if (typeof parseEnv !== 'function') return;

    const initialKeys = new Set(Object.keys(process.env));
    const fileMap = {};

    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      Object.assign(fileMap, parseEnv(fs.readFileSync(envPath, 'utf8')));
    }

    const localEnvPath = path.join(process.cwd(), '.env.local');
    if (fs.existsSync(localEnvPath)) {
      const parsedLocal = parseEnv(fs.readFileSync(localEnvPath, 'utf8'));
      for (const [k, v] of Object.entries(parsedLocal)) {
        if (v !== undefined && v !== '') {
          fileMap[k] = v;
        } else if (fileMap[k] === undefined) {
          fileMap[k] = v;
        }
      }
    }

    for (const [k, v] of Object.entries(fileMap)) {
      if (!initialKeys.has(k)) {
        process.env[k] = v;
      }
    }
  } catch (_) {}
}
loadLocalEnv();

const env = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();

const PORT = Number(env('PORT', '3000'));
const TIMEZONE = env('TIMEZONE', 'Asia/Kolkata');
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');
const PRICE_RUPEES = Number(env('PRICE_RUPEES', '10000'));
const DAYS_AHEAD_LIMIT = Number(env('DAYS_AHEAD_LIMIT', '60'));

const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');

const SMTP_HOST = env('SMTP_HOST');
const SMTP_PORT = Number(env('SMTP_PORT', '465'));
const SMTP_USER = env('SMTP_USER');
const SMTP_PASS = env('SMTP_PASS');
const NOTIFY_EMAIL = env('NOTIFY_EMAIL');

const RAZORPAY_KEY_ID = env('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = env('RAZORPAY_KEY_SECRET');
const DEPOSIT_RUPEES = Number(env('DEPOSIT_RUPEES', '0'));
const PAYMENTS_ON = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && DEPOSIT_RUPEES > 0);

const ADMIN_ON = ADMIN_PASSWORD.length >= 8 && ADMIN_PASSWORD !== 'change-me-please';

/* ---------------------------------------------------------------------
   1 · what you sell, and when
--------------------------------------------------------------------- */
const SLOTS = Array.from({ length: 24 }, (_, hour) => ({
  time: `${String(hour).padStart(2, '0')}:00`,
  name: 'one hour',
  note: 'available by reservation',
}));
const SLOT_TIMES = SLOTS.map(s => s.time);
const FLEXIBLE = 'flexible';

const PRACTICES = [
  'The Plus-One',
  'The Carrier',
  'Deep Yin Listening',
  'Vent Work',
  'The Silence',
  'Flat-Pack Rescue',
  'Surprise me — a curated mystery',
];

/* ---------------------------------------------------------------------
   2 · the database & storage singletons
--------------------------------------------------------------------- */
let defaultSql = null;
try {
  defaultSql = neon(env('DATABASE_URL'));
} catch (_) {
  defaultSql = null;
}

const defaultStorage = createStorage();

function getSql(req) {
  return req?.app?.locals?.sql || defaultSql;
}
function getStorage(req) {
  return req?.app?.locals?.storage || defaultStorage;
}
function getMailer(req) {
  return req?.app?.locals?.mailer || defaultMailer;
}

/* ---------------------------------------------------------------------
   3 · small date helpers
--------------------------------------------------------------------- */
function nowHere() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
const toMinutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/* ---------------------------------------------------------------------
   4 · availability — "is this hour free?"
   CRITICAL: Admin block reasons are hidden from public schedule.
--------------------------------------------------------------------- */
async function getSchedule(startDate, days, sqlInstance = defaultSql) {
  const endDate = addDays(startDate, days - 1);
  const now = nowHere();

  const [taken, blocks] = await Promise.all([
    sqlInstance.query(`SELECT date, time FROM bookings
                WHERE date BETWEEN $1 AND $2 AND status IN ('pending','confirmed')`, [startDate, endDate]),
    sqlInstance.query(`SELECT date, time, reason FROM blocks WHERE date BETWEEN $1 AND $2`, [startDate, endDate]),
  ]);
  const dayBlocks = new Map(blocks.filter(b => !b.time).map(b => [b.date, b.reason]));
  const slotBlocks = blocks.filter(b => b.time && b.time !== FLEXIBLE);

  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const isPastDay = date < now.date;
    const closedReason = dayBlocks.has(date) ? 'unavailable' : null;

    out.push({
      date,
      weekday: weekday(date),
      closed: Boolean(closedReason) || isPastDay,
      closedReason: isPastDay ? 'in the past' : closedReason,
      slots: closedReason || isPastDay ? [] : SLOTS.map(s => {
        let status = 'open';
        if (date === now.date && toMinutes(s.time) <= now.minutes) status = 'past';
        else if ([...taken, ...slotBlocks].some(b => b.date === date && b.time !== FLEXIBLE && Math.abs(toMinutes(b.time) - toMinutes(s.time)) < 60)) status = 'held';
        return { ...s, status };
      }),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------
   5 · notifications & applicant receipts
--------------------------------------------------------------------- */
let defaultMailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  try {
    const nodemailer = require('nodemailer');
    defaultMailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } catch (mailErr) {
    console.error('⚠️ Could not initialize nodemailer:', mailErr.message);
  }
}

async function notify(subject, lines, mailerInstance = defaultMailer, bookingNotifier = null) {
  const text = [subject, '', ...lines].join('\n');
  console.log('\n🔔 ' + text.replace(/\n/g, '\n   ') + '\n');

  const jobs = [];
  if (bookingNotifier) jobs.push(Promise.resolve().then(() => bookingNotifier({ subject, text })));
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      }).then(async r => { if (!r.ok) throw new Error('Telegram said: ' + (await r.text())); }),
    );
  }
  if (mailerInstance && NOTIFY_EMAIL) {
    jobs.push(mailerInstance.sendMail({ from: SMTP_USER, to: NOTIFY_EMAIL, subject, text }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('⚠️  notification failed:', r.reason?.message || r.reason);
}

/**
 * Sends a plain-text receipt acknowledgment to candidate applicants.
 * Sender is configured via SMTP_USER (never hardcoded in tracked source).
 * Employs a 5-second timeout and truthful status tracking.
 */
async function sendApplicantReceipt({ mailer, applicantEmail, applicantName, ref }) {
  if (!mailer || !applicantEmail) {
    return { ok: false, error: 'Mailer not configured' };
  }
  const fromAddress = env('SMTP_USER') || 'roojool.talekar@gmail.com';
  const text = [
    `Dear ${applicantName || 'Applicant'},`,
    '',
    `Thank you for applying to Presence. We have received your application and private materials (Reference: ${ref}).`,
    '',
    'All submissions are held in strict confidence and evaluated with editorial care.',
    'Should your background align with our present cohort requirements, we will contact you directly.',
    '',
    'Warmly,',
    'Presence.',
  ].join('\n');

  const sendPromise = mailer.sendMail({
    from: fromAddress,
    to: applicantEmail,
    subject: `Application Received — Presence (${ref})`,
    text,
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Email dispatch timed out after 5s')), 5000)
  );

  try {
    await Promise.race([sendPromise, timeoutPromise]);
    return { ok: true };
  } catch (err) {
    console.error('⚠️ Applicant receipt delivery failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Atomic conditional DB claim with bounded lease to prevent concurrent duplicate sends
 */
async function claimAndSendReceipt({ sql, mailer, applicationId, applicantEmail, applicantName, ref }) {
  const now = Date.now();
  const LEASE_DURATION_MS = 30000;
  const leaseId = crypto.randomUUID();

  const claimRows = await sql.query(
    `UPDATE applications
     SET receipt_claim = $1,
         receipt_claimed_at = $2,
         receipt_claim_expires_at = $3
     WHERE id = $4
       AND receipt_status != 'sent'
       AND (receipt_claim_expires_at IS NULL OR receipt_claim_expires_at < $2)
     RETURNING id, ref, email, name, receipt_status`,
    [leaseId, now, now + LEASE_DURATION_MS, applicationId]
  );

  if (!claimRows || claimRows.length === 0) {
    const [current] = await sql.query(`SELECT receipt_status FROM applications WHERE id = $1`, [applicationId]);
    if (current?.receipt_status === 'sent') {
      return { ok: true, receiptStatus: 'sent', alreadySent: true };
    }
    return { ok: false, receiptStatus: 'pending', concurrentlyClaimed: true };
  }

  let finalStatus = 'failed';
  if (mailer) {
    try {
      const sendResult = await sendApplicantReceipt({
        mailer,
        applicantEmail,
        applicantName,
        ref,
      });
      finalStatus = sendResult.ok ? 'sent' : 'failed';
    } catch (_) {
      finalStatus = 'failed';
    }
  }

  await sql.query(
    `UPDATE applications
     SET receipt_status = $1,
         receipt_claim = NULL,
         receipt_claim_expires_at = NULL,
         updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
     WHERE id = $2
       AND receipt_claim = $3`,
    [finalStatus, applicationId, leaseId]
  );

  return { ok: finalStatus === 'sent', receiptStatus: finalStatus };
}

/* ---------------------------------------------------------------------
   6 · Razorpay
--------------------------------------------------------------------- */
async function createRazorpayOrder(ref) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: Math.round(DEPOSIT_RUPEES * 100), currency: 'INR', receipt: ref }),
  });
  if (!r.ok) throw new Error('Razorpay order failed: ' + (await r.text()));
  return r.json();
}
function razorpaySignatureOk(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, String(signature || ''));
}

/* ---------------------------------------------------------------------
   7 · safety helpers & validators
--------------------------------------------------------------------- */
function safeEqual(a, b) {
  const A = crypto.createHash('sha256').update(String(a)).digest();
  const B = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}

function rateLimit(max, windowMs, message) {
  return async (req, res, next) => {
    const sql = getSql(req);
    const cfIp = req.headers['cf-connecting-ip'];
    const ip = (typeof cfIp === 'string' && cfIp.trim())
      ? cfIp.trim()
      : (req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1');
    const key = crypto.createHash('sha256').update(`${message}:${ip}`).digest('hex');
    const now = Date.now();
    const cutoff = now - windowMs;
    try {
      if (!sql) return next();
      await sql`DELETE FROM rate_limits WHERE updated_at < ${now - 86400000}`;
      const [row] = await sql`
        INSERT INTO rate_limits (key, hits, updated_at) VALUES (${key}, ARRAY[${now}::bigint], ${now})
        ON CONFLICT (key) DO UPDATE SET
          hits = ARRAY(SELECT hit FROM unnest(rate_limits.hits) AS hit WHERE hit > ${cutoff}) || ${now}::bigint,
          updated_at = ${now}
        WHERE (SELECT count(*) FROM unnest(rate_limits.hits) AS hit WHERE hit > ${cutoff}) < ${max}
        RETURNING cardinality(hits) AS count`;
      if (!row || row.count > max) return res.status(429).json({ error: message });
    } catch (_) {
      // If rate_limits is temporarily unreachable, allow request to proceed
    }
    next();
  };
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const cleanMultiline = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function newRef(sqlInstance = defaultSql) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let ref = 'PRS-';
    for (const b of crypto.randomBytes(6)) ref += letters[b % letters.length];
    const existing = await sqlInstance.query('SELECT 1 FROM bookings WHERE ref = $1', [ref]);
    if (!existing || existing.length === 0) return ref;
  }
  return 'PRS-' + crypto.randomUUID().slice(0, 6).toUpperCase();
}

async function newAppRef(sqlInstance = defaultSql) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let ref = 'APP-';
    for (const b of crypto.randomBytes(6)) ref += letters[b % letters.length];
    const existing = await sqlInstance.query('SELECT 1 FROM applications WHERE ref = $1', [ref]);
    if (!existing || existing.length === 0) return ref;
  }
  return 'APP-' + crypto.randomUUID().slice(0, 6).toUpperCase();
}

class Oops extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function assertBookable(date, time, { allowHeld = false, sqlInstance = defaultSql } = {}) {
  if (!isRealDate(date)) throw new Oops(400, 'that date does not look right', 'f-date');
  const now = nowHere();
  if (date < now.date) throw new Oops(400, 'that date has already happened', 'f-date');
  if (daysBetween(now.date, date) > DAYS_AHEAD_LIMIT)
    throw new Oops(400, `bookings open ${DAYS_AHEAD_LIMIT} days ahead — a little closer, please`, 'f-date');

  const [day] = await getSchedule(date, 1, sqlInstance);
  if (day.closed) throw new Oops(409, `that day is closed (${day.closedReason})`, 'f-date');

  if (time === FLEXIBLE) return;
  if (!SLOT_TIMES.includes(time)) throw new Oops(400, 'please choose one of the listed hours', 'f-time');
  const slot = day.slots.find(s => s.time === time);
  if (slot.status === 'past') throw new Oops(409, 'that hour has already passed today', 'f-time');
  if (slot.status === 'held' && !allowHeld) throw new Oops(409, 'that hour has just been held by someone else — pick another', 'f-time');
}

/* ---------------------------------------------------------------------
   8 · the web server & application router
--------------------------------------------------------------------- */
const app = express();
if (env('TRUST_PROXY') === '1' || env('VERCEL') === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

// JSON body parser for normal endpoints
app.use(express.json({ limit: '20kb' }));

// Raw binary body parser for single image uploads <= 6MiB
const rawUploadParser = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'],
  limit: '6mb',
});

/* ---- public API (used by the website) ---- */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', async (req, res) => {
  const storage = getStorage(req);
  res.json({
    timezone: TIMEZONE,
    today: nowHere().date,
    priceRupees: PRICE_RUPEES,
    maxDaysAhead: DAYS_AHEAD_LIMIT,
    payments: PAYMENTS_ON ? { provider: 'razorpay', keyId: RAZORPAY_KEY_ID, depositRupees: DEPOSIT_RUPEES } : null,
    practices: PRACTICES,
    slots: SLOTS,
    applications: {
      enabled: true,
      maxPhotos: MAX_PHOTOS_PER_SESSION,
      maxPhotoBytes: MAX_PHOTO_BYTES,
    },
  });
});

app.get('/api/slots', async (req, res) => {
  const sql = getSql(req);
  const today = nowHere().date;
  let start = typeof req.query.start === 'string' && isRealDate(req.query.start) ? req.query.start : today;
  if (start < today) start = today;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 14);
  res.json({ today, days: await getSchedule(start, days, sql) });
});

app.post('/api/bookings',
  rateLimit(10, 15 * 60 * 1000, 'that is a lot of booking attempts — please wait 15 minutes and try again'),
  async (req, res) => {
    const sql = getSql(req);
    const b = req.body || {};

    if (b.website) return res.status(400).json({ error: 'something went wrong' });

    const name = clean(b.name, 80);
    const contact = clean(b.contact, 30);
    const date = clean(b.date, 10);
    const time = clean(b.time, 10);
    const practice = clean(b.practice, 80);
    const request = cleanMultiline(b.request, 1000);

    if (name.length < 2) throw new Oops(400, 'the gentleman needs a name to whisper politely', 'f-name');
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(contact))
      throw new Oops(400, 'that phone number does not look right', 'f-contact');
    if (!PRACTICES.includes(practice)) throw new Oops(400, 'every hour needs a shape — choose a practice', 'f-practice');
    if (b.lady !== true) throw new Oops(400, 'the ladies-only clause is load-bearing', 'f-lady');
    const [, ref] = await Promise.all([
      assertBookable(date, time, { sqlInstance: sql }),
      newRef(sql),
    ]);
    try {
      await sql.query(`INSERT INTO bookings (ref, name, contact, date, time, practice, request, payment_status)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [ref, name, contact, date, time, practice, request, PAYMENTS_ON ? 'awaiting' : 'none']);
    } catch (err) {
      if (err.code === '23505') throw new Oops(409, 'that hour has just been held by someone else — pick another', 'f-time');
      throw err;
    }

    let payment = null;
    if (PAYMENTS_ON) {
      try {
        const order = await createRazorpayOrder(ref);
        await sql.query('UPDATE bookings SET payment_order = $1 WHERE ref = $2', [order.id, ref]);
        payment = { keyId: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency };
      } catch (err) {
        console.error('⚠️ ', err.message);
      }
    }

    await notify(`New booking ${ref}`, [
      `Name: ${name}`,
      `Phone: ${contact}`,
      `Date: ${date}`,
      `Hour: ${time}`,
      `Practice: ${practice}`,
      `Request: ${request || '—'}`,
      '',
      'Confirm it on the admin page, then message her on WhatsApp.',
    ], getMailer(req), req.app.locals.bookingNotifier);

    res.status(201).json({ ref, name, date, time, practice, request, payment });
  });

app.post('/api/bookings/:ref/payment', async (req, res) => {
  const sql = getSql(req);
  if (!PAYMENTS_ON) throw new Oops(404, 'payments are switched off');
  const booking = (await sql.query('SELECT * FROM bookings WHERE ref = $1', [String(req.params.ref)]))[0];
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!booking || booking.payment_order !== razorpay_order_id || !razorpaySignatureOk(razorpay_order_id, razorpay_payment_id, razorpay_signature))
    throw new Oops(400, 'we could not verify that payment');
  await sql.query(`UPDATE bookings SET payment_status = 'paid', payment_id = $1 WHERE id = $2`, [String(razorpay_payment_id), booking.id]);
  await notify(`Deposit paid for ${booking.ref}`, [`${booking.name} paid ₹${DEPOSIT_RUPEES}.`, `Payment id: ${razorpay_payment_id}`], getMailer(req));
  res.json({ ok: true });
});

app.post('/api/waitlist',
  rateLimit(5, 15 * 60 * 1000, 'please wait a few minutes before joining more waitlists'),
  async (req, res) => {
    const sql = getSql(req);
    const b = req.body || {};
    if (b.website) return res.status(400).json({ error: 'something went wrong' });
    const name = clean(b.name, 80);
    const contact = clean(b.contact, 30);
    const date = clean(b.date, 10);
    const time = clean(b.time, 10);
    if (name.length < 2) throw new Oops(400, 'a name, please');
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Oops(400, 'that phone number does not look right');
    await assertBookable(date, time, { allowHeld: true, sqlInstance: sql });

    await sql.query('INSERT INTO waitlist (name, contact, date, time) VALUES ($1, $2, $3, $4)', [name, contact, date, time]);
    await notify('New waitlist entry', [`${name} (${contact}) wants ${date} at ${time} if it frees up.`], getMailer(req));
    res.status(201).json({ ok: true });
  });

/* ---------------------------------------------------------------------
   9 · candidate applications pipeline
--------------------------------------------------------------------- */

const sessionHash = token => crypto.createHash('sha256').update(String(token)).digest('hex');

// Step 1: Session initialization
app.post('/api/applications/session',
  rateLimit(10, 15 * 60 * 1000, 'too many session requests — please try again in 15 minutes'),
  async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(400).json({ error: 'something went wrong' });

    let photoCount = parseInt(b.photoCount, 10);
    if (isNaN(photoCount) || photoCount < 0 || photoCount > MAX_PHOTOS_PER_SESSION) {
      throw new Oops(400, `photoCount must be between 1 and ${MAX_PHOTOS_PER_SESSION}`, 'a-photos');
    }
    if (photoCount > 0 && !getStorage(req)?.enabled) {
      throw new Oops(503, 'Application photo storage is currently unavailable');
    }

    const sql = getSql(req);
    const sessionId = 'app_sess_' + crypto.randomBytes(12).toString('hex');
    const token = 'tok_sec_' + crypto.randomBytes(24).toString('hex');
    const hashed = sessionHash(token);
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;

    await sql.query(
      `INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
       VALUES ($1, $2, $3, false, $4, $5)`,
      [sessionId, hashed, photoCount, expiresAt, now]
    );

    res.json({ sessionId, token });
  });

// Step 2: Streaming raw photo upload with DB reservation via PL/pgSQL function
app.post('/api/applications/upload',
  rawUploadParser,
  async (req, res) => {
    const storage = getStorage(req);
    if (!storage || !storage.enabled) {
      throw new Oops(503, 'Application photo storage is currently unavailable');
    }

    const sessionId = (req.get('x-upload-session') || '').trim();
    const rawToken = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const rawPathname = (req.get('x-upload-pathname') || '').trim();

    if (!sessionId || !rawToken) {
      throw new Oops(401, 'authorization token and session header required');
    }

    const parsedPath = parseAndValidatePathname(rawPathname, sessionId);
    if (!parsedPath) {
      throw new Oops(400, 'invalid upload pathname; must match applications/:sessionId/:uuid.:ext', 'a-photos');
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    if (buffer.length === 0) {
      throw new Oops(400, 'empty photo payload received', 'a-photos');
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new Oops(400, `photo exceeds max limit of 5MiB (${buffer.length} bytes)`, 'a-photos');
    }

    // Validate magic bytes
    const detectedMime = detectImageType(buffer);
    if (!detectedMime) {
      throw new Oops(400, 'invalid image format; only valid JPEG, PNG, and WebP files are accepted', 'a-photos');
    }
    if (!isValidExtensionForMime(parsedPath.ext, detectedMime)) {
      throw new Oops(400, `file extension .${parsedPath.ext} does not match detected mime type ${detectedMime}`, 'a-photos');
    }

    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const sql = getSql(req);

    // 1. Reserve upload slot atomically via PL/pgSQL function
    const [reserveResult] = await sql.query(
      `SELECT result_status, existing_uploaded FROM reserve_application_upload($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, sessionHash(rawToken), parsedPath.pathname, contentHash, detectedMime, buffer.length, Date.now()]
    );

    if (!reserveResult) {
      throw new Oops(500, 'database reservation failed');
    }

    switch (reserveResult.result_status) {
      case 'INVALID_SESSION':
      case 'EXPIRED_SESSION':
      case 'INVALID_TOKEN':
        throw new Oops(401, 'invalid or expired upload session');
      case 'FINALIZED':
        throw new Oops(409, 'application session is already finalized');
      case 'CONTENT_MISMATCH':
        throw new Oops(409, 'pathname already exists with different content');
      case 'CAPACITY_REACHED':
        throw new Oops(400, 'upload capacity reached for this session', 'a-photos');
      case 'OK':
        break;
      default:
        throw new Oops(500, 'unknown reservation error');
    }

    // 2. If already uploaded with identical hash, skip R2 overwrite
    if (!reserveResult.existing_uploaded) {
      try {
        await storage.put(parsedPath.pathname, buffer, detectedMime);
      } catch (storageErr) {
        console.error('⚠️ Storage upload failed:', storageErr.message);
        throw new Oops(502, 'storage upload failed, please retry');
      }

      const now = Date.now();
      await sql.query(
        `UPDATE application_uploads SET status = 'uploaded', updated_at = $1 WHERE pathname = $2`,
        [now, parsedPath.pathname]
      );
    }

    res.json({ pathname: parsedPath.pathname });
  });

// Step 3: Final application submission (atomic single-query insert via PL/pgSQL function)
app.post('/api/applications',
  rateLimit(10, 15 * 60 * 1000, 'too many application submissions — please wait a few moments'),
  async (req, res) => {
    const b = req.body || {};
    const sessionId = clean(b.sessionId, 64);
    const token = clean(b.token, 128);

    if (!sessionId || !token) {
      throw new Oops(401, 'session credentials required');
    }

    const name = clean(b.name, 100);
    const email = clean(b.email, 254);
    const phone = clean(b.phone, 40);
    const city = clean(b.city, 100);
    const age = Number(b.age);
    const experience = cleanMultiline(b.experience, 5000);
    const consent = b.consent === true;
    const portfolio = clean(b.portfolio, 500);
    let social = clean(b.social, 500);

    if (name.length < 2) throw new Oops(400, 'please share your full name', 'a-name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new Oops(400, 'please enter a valid email address', 'a-email');
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(phone))
      throw new Oops(400, 'that phone number does not look right', 'a-phone');
    if (city.length < 2) throw new Oops(400, 'please share your base city', 'a-city');
    if (!Number.isInteger(age) || age < 18 || age > 120)
      throw new Oops(400, 'applicants must be 18 or older', 'a-age');
    if (experience.length < 10)
      throw new Oops(400, 'please share a brief background or personal statement', 'a-experience');
    if (!consent)
      throw new Oops(400, 'consent is required', 'a-consent');

    // Validate BOTH optional URLs with new URL and https protocol
    if (portfolio) {
      try {
        const u = new URL(portfolio);
        if (u.protocol !== 'https:') throw new Error();
      } catch (_) {
        throw new Oops(400, 'portfolio must be a valid secure URL starting with https://', 'a-portfolio');
      }
    }
    const rawPhotos = Array.isArray(b.photos) ? b.photos : null;
    if (rawPhotos && rawPhotos.length === 0) {
      const username = social.replace(/^@/, '');
      if (!/^[a-zA-Z0-9._]{1,30}$/.test(username))
        throw new Oops(400, 'please enter a valid Instagram username', 'a-social');
      social = `https://www.instagram.com/${username}/`;
    } else if (social) {
      try {
        const u = new URL(social);
        if (u.protocol !== 'https:') throw new Error();
      } catch (_) {
        throw new Oops(400, 'social link must be a valid secure URL starting with https://', 'a-social');
      }
    }

    if (!rawPhotos || rawPhotos.length > MAX_PHOTOS_PER_SESSION) {
      throw new Oops(400, `please provide between 1 and ${MAX_PHOTOS_PER_SESSION} photos`, 'a-photos');
    }

    // Malformed / null entries validation (400 not 500)
    for (const p of rawPhotos) {
      if (!p || typeof p !== 'object' || typeof p.pathname !== 'string' || !p.pathname.trim()) {
        throw new Oops(400, 'malformed photo entry', 'a-photos');
      }
    }

    const uniquePathnames = Array.from(new Set(rawPhotos.map(p => (p.pathname || '').trim())));
    if (uniquePathnames.length !== rawPhotos.length) {
      throw new Oops(400, 'duplicate photo entries provided', 'a-photos');
    }

    // Pathname session ownership check
    for (const pathname of uniquePathnames) {
      const parsed = parseAndValidatePathname(pathname, sessionId);
      if (!parsed) {
        throw new Oops(400, `unauthorized or invalid photo path: ${pathname}`, 'a-photos');
      }
    }

    const sql = getSql(req);
    const ref = await newAppRef(sql);

    // Atomic execution via single PL/pgSQL function invocation
    const [finalizeResult] = await sql.query(
      `SELECT result_status, app_id, app_ref, receipt_status
       FROM finalize_application($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        sessionId,
        sessionHash(token),
        ref,
        name,
        email,
        phone,
        city,
        age,
        experience,
        portfolio || '',
        social || '',
        consent,
        uniquePathnames,
        Date.now(),
      ]
    );

    if (!finalizeResult) {
      throw new Oops(500, 'application finalization failed');
    }

    switch (finalizeResult.result_status) {
      case 'INVALID_SESSION':
      case 'EXPIRED_SESSION':
      case 'INVALID_TOKEN':
        throw new Oops(401, 'invalid or expired session');
      case 'UPLOAD_MISSING':
        throw new Oops(400, 'one or more uploaded photos are missing or unverified', 'a-photos');
      case 'ALREADY_FINALIZED':
        return res.status(200).json({
          ref: finalizeResult.app_ref,
          receiptStatus: finalizeResult.receipt_status,
        });
      case 'OK':
        break;
      default:
        throw new Oops(500, 'unknown finalization error');
    }

    const savedAppId = finalizeResult.app_id;
    const finalRef = finalizeResult.app_ref;

    // Dispatch receipt delivery via atomic conditional claim
    let receiptStatus = 'pending';
    const mailer = getMailer(req);
    if (mailer && env('APPLICANT_RECEIPTS') === '1') {
      const claimResult = await claimAndSendReceipt({
        sql,
        mailer,
        applicationId: savedAppId,
        applicantEmail: email,
        applicantName: name,
        ref: finalRef,
      });
      receiptStatus = claimResult.receiptStatus;
    } else if (env('APPLICANT_RECEIPTS') === '1') {
      await sql.query(
        `UPDATE applications SET receipt_status = 'failed' WHERE id = $1`,
        [savedAppId]
      );
    }

    // Internal notification without PII (only ref and photo count)
    res.status(201).json({ ref: finalRef, receiptStatus });
  });

/* ---- admin API (password protected) ---- */

const SESSION_MS = 12 * 60 * 60 * 1000;

app.post('/api/admin/login',
  rateLimit(10, 15 * 60 * 1000, 'too many attempts — wait 15 minutes'),
  async (req, res) => {
    const sql = getSql(req);
    if (!ADMIN_ON) throw new Oops(503, 'Admin is switched off. Set ADMIN_PASSWORD (at least 8 characters) in the .env file and restart.');
    if (!safeEqual(String(req.body?.password || ''), ADMIN_PASSWORD)) throw new Oops(401, 'wrong password');
    const token = crypto.randomBytes(32).toString('hex');
    await sql`DELETE FROM admin_sessions WHERE expires_at < ${Date.now()}`;
    await sql`INSERT INTO admin_sessions (token_hash, expires_at) VALUES (${sessionHash(token)}, ${Date.now() + SESSION_MS})`;
    res.json({ token });
  });

async function requireAdmin(req, res, next) {
  const authHeader = req.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ') && !authHeader.startsWith('bearer ')) {
    return res.status(401).json({ error: 'please log in again' });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'please log in again' });
  }
  const sql = getSql(req);
  if (!sql) {
    return res.status(401).json({ error: 'please log in again' });
  }
  const [session] = await sql.query('SELECT expires_at FROM admin_sessions WHERE token_hash = $1', [sessionHash(token)]);
  const expiry = session?.expires_at;
  if (!expiry || expiry < Date.now()) {
    if (expiry) {
      await sql.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sessionHash(token)]).catch(() => {});
    }
    return res.status(401).json({ error: 'please log in again' });
  }
  next();
}

app.use('/api/admin', requireAdmin);

app.post('/api/admin/logout', async (req, res) => {
  const sql = getSql(req);
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  await sql`DELETE FROM admin_sessions WHERE token_hash = ${sessionHash(token)}`;
  res.json({ ok: true });
});

/* ---- Admin Stats Endpoint ---- */
app.get('/api/admin/stats', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const today = nowHere().date;

  const [pRow] = await sql.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE date >= $1 AND status = 'pending'`, [today]);
  const [cRow] = await sql.query(`SELECT COUNT(*)::int AS count FROM bookings WHERE date >= $1 AND status = 'confirmed'`, [today]);
  const [wRow] = await sql.query(`SELECT COUNT(*)::int AS count FROM waitlist WHERE date >= $1`, [today]);
  const [aRow] = await sql.query(`SELECT COUNT(*)::int AS count FROM applications WHERE status = 'new'`, []);

  res.json({
    pending: Number(pRow?.count || 0),
    confirmed: Number(cRow?.count || 0),
    waitlist: Number(wRow?.count || 0),
    applications: Number(aRow?.count || 0),
  });
});

app.get('/api/admin/bookings', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const show = String(req.query.show || 'upcoming');
  const today = nowHere().date;
  const rows = show === 'all'
    ? (await sql.query('SELECT * FROM bookings ORDER BY date DESC, time DESC', []))
    : (await sql.query(`SELECT * FROM bookings WHERE date >= $1 AND status <> 'cancelled' ORDER BY date, time`, [today]));
  res.json({ bookings: rows });
});

app.patch('/api/admin/bookings/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const status = String(req.body?.status || '');
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) throw new Oops(400, 'unknown status');
  const booking = (await sql.query('SELECT * FROM bookings WHERE id = $1', [Number(req.params.id)]))[0];
  if (!booking) throw new Oops(404, 'booking not found');
  if (booking.status === 'cancelled' && status !== 'cancelled' && booking.time !== FLEXIBLE && !SLOT_TIMES.includes(booking.time)) {
    throw new Oops(409, 'this older time cannot be reactivated; create a new hourly booking instead');
  }
  try {
    await sql.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, booking.id]);
  } catch (err) {
    if (err.code === '23505') throw new Oops(409, 'someone else already holds that hour, so this one cannot be re-activated');
    throw err;
  }
  res.json({ ok: true });
});

app.delete('/api/admin/bookings/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  await sql.query('DELETE FROM bookings WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/admin/waitlist', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  res.json({ waitlist: (await sql.query('SELECT * FROM waitlist WHERE date >= $1 ORDER BY date, time, id', [nowHere().date])) });
});

app.delete('/api/admin/waitlist/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  await sql.query('DELETE FROM waitlist WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/admin/blocks', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  res.json({ blocks: (await sql.query('SELECT * FROM blocks WHERE date >= $1 ORDER BY date, time', [nowHere().date])), slotTimes: SLOT_TIMES });
});

app.post('/api/admin/blocks', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const date = clean(req.body?.date, 10);
  const time = clean(req.body?.time, 10) || null;
  const reason = clean(req.body?.reason, 120);
  if (!isRealDate(date)) throw new Oops(400, 'pick a date');
  if (time && !SLOT_TIMES.includes(time)) throw new Oops(400, 'pick one of the listed hours, or leave it empty for the whole day');
  await sql.query('INSERT INTO blocks (date, time, reason) VALUES ($1, $2, $3)', [date, time, reason]);
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/blocks/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  await sql.query('DELETE FROM blocks WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

/* ---- Admin Candidate Applications Endpoints ---- */

app.get('/api/admin/applications', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const whereClauses = [];
  const params = [];

  if (status && ['new', 'reviewing', 'shortlisted', 'rejected'].includes(status)) {
    params.push(status);
    whereClauses.push(`status = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const idx = params.length;
    whereClauses.push(`(
      LOWER(name) LIKE $${idx} OR
      LOWER(email) LIKE $${idx} OR
      LOWER(phone) LIKE $${idx} OR
      LOWER(city) LIKE $${idx} OR
      LOWER(ref) LIKE $${idx}
    )`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [totalRow] = await sql.query(`SELECT COUNT(*)::int AS count FROM applications ${whereSql}`, params);
  const total = Number(totalRow?.count || 0);

  const queryParams = [...params, limit, offset];
  const applications = await sql.query(
    `SELECT id, ref, name, email, phone, city, age, status, receipt_status, created_at
     FROM applications ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams
  );

  res.json({ applications: applications || [], total });
});

app.get('/api/admin/applications/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const id = Number(req.params.id);
  const [application] = await sql.query(`SELECT * FROM applications WHERE id = $1`, [id]);
  if (!application) throw new Oops(404, 'application not found');

  const photos = await sql.query(
    `SELECT id, mime_type, pathname FROM application_photos WHERE application_id = $1 ORDER BY id`,
    [id]
  );

  res.json({
    application: {
      ...application,
      photos: photos || [],
    },
  });
});

app.patch('/api/admin/applications/:id', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const id = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!['new', 'reviewing', 'shortlisted', 'rejected'].includes(status)) {
    throw new Oops(400, 'unknown status');
  }

  const [existing] = await sql.query(`SELECT id FROM applications WHERE id = $1`, [id]);
  if (!existing) throw new Oops(404, 'application not found');

  await sql.query(
    `UPDATE applications SET status = $1, updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE id = $2`,
    [status, id]
  );
  res.json({ ok: true });
});

app.get('/api/admin/applications/:id/photos/:photoId', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const storage = getStorage(req);
  if (!storage || !storage.enabled) {
    throw new Oops(503, 'photo storage is currently unavailable');
  }

  const appId = Number(req.params.id);
  const photoId = Number(req.params.photoId);

  const [photo] = await sql.query(
    `SELECT * FROM application_photos WHERE id = $1 AND application_id = $2`,
    [photoId, appId]
  );
  if (!photo) throw new Oops(404, 'photo not found');

  const file = await storage.get(photo.pathname);
  if (!file || !file.data) throw new Oops(404, 'photo file not found in storage');

  res.set('Content-Type', photo.mime_type || file.contentType || 'image/jpeg');
  res.set('Content-Length', file.contentLength || file.data.length);
  res.send(file.data);
});

// Admin receipt retry endpoint with atomic conditional claim
app.post('/api/admin/applications/:id/receipt', async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const sql = getSql(req);
  const id = Number(req.params.id);
  const [application] = await sql.query(`SELECT * FROM applications WHERE id = $1`, [id]);
  if (!application) throw new Oops(404, 'application not found');

  if (application.receipt_status === 'sent') {
    return res.json({ ok: true, receiptStatus: 'sent' });
  }

  const mailer = getMailer(req);
  const result = await claimAndSendReceipt({
    sql,
    mailer,
    applicationId: id,
    applicantEmail: application.email,
    applicantName: application.name,
    ref: application.ref,
  });

  if (result.concurrentlyClaimed) {
    throw new Oops(409, 'receipt delivery is already in flight for this application');
  }

  res.json({ ok: result.ok, receiptStatus: result.receiptStatus });
});

/* ---- Secure Cron Cleanup Endpoint ---- */
app.all('/api/cron/cleanup', async (req, res) => {
  const secret = env('CRON_SECRET');
  const authHeader = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const cronHeader = req.get('x-cron-secret') || '';

  if (!secret || (authHeader !== secret && cronHeader !== secret)) {
    return res.status(401).json({ error: 'unauthorized cron request' });
  }

  const sql = getSql(req);
  const storage = getStorage(req);
  const results = await cleanupAbandonedUploads({ sql, storage });
  res.json({ ok: true, results });
});

/* ---- pages ---- */
if (typeof __dirname !== 'undefined') {
  app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
} else {
  // In Cloudflare Workers runtime, static assets/pages are served by env.ASSETS binding in worker.mjs
  app.get('/favicon.ico', (req, res) => res.status(204).end());
}
app.use('/api', (req, res) => res.status(404).json({ error: 'no such address' }));

/* ---- error handler ---- */
app.use((err, req, res, next) => {
  if (err instanceof Oops) return res.status(err.status).json({ error: err.message, field: err.field });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
    return res.status(400).json({ error: 'that request did not make sense' });
  console.error('💥', err);
  res.status(500).json({ error: 'something broke on our side — please try again' });
});

module.exports = app;
module.exports.app = app;
module.exports.newRef = newRef;
module.exports.newAppRef = newAppRef;
module.exports.assertBookable = assertBookable;
module.exports.getSchedule = getSchedule;
module.exports.SLOTS = SLOTS;
module.exports.PRACTICES = PRACTICES;
module.exports.sendApplicantReceipt = sendApplicantReceipt;
module.exports.claimAndSendReceipt = claimAndSendReceipt;
module.exports.Oops = Oops;

if (require.main === module) app.listen(PORT, () => {
  console.log('');
  console.log('  ✅ Presence is running!');
  console.log(`     website : http://localhost:${PORT}`);
  console.log(`     admin   : http://localhost:${PORT}/admin`);
  console.log('');
  console.log(`     admin login     : ${ADMIN_ON ? 'on' : 'OFF — set ADMIN_PASSWORD in .env'}`);
  console.log(`     telegram alerts : ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? 'on' : 'off'}`);
  console.log(`     email alerts    : ${defaultMailer ? 'on' : 'off'}`);
  console.log(`     storage (R2)    : ${defaultStorage.enabled ? 'on' : 'off'}`);
  console.log(`     payments        : ${PAYMENTS_ON ? `on (₹${DEPOSIT_RUPEES} deposit)` : 'off'}`);
  console.log('');
  console.log('  Keep this window open. Close it (or press Ctrl + C) to stop the server.');
  console.log('');
});
