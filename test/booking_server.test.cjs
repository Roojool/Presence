require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../server.js');
const { createTestServer, createPgLiteSql } = require('./helper.cjs');
const { initSchema } = require('../lib/schema.cjs');

describe('Server Booking Regression & Isolation (App + PGlite)', () => {
  let ctx;
  let sql;
  const adminToken = 'booking_regression_admin_token';

  before(async () => {
    sql = await createPgLiteSql();
    ctx = await createTestServer(app, { sql });

    // Seed admin session
    const tokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await sql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [tokenHash, Date.now() + 86400000]
    );
  });

  after(async () => {
    await ctx.close();
  });

  test('no external payments: deposit provider is skipped cleanly', async () => {
    const configRes = await ctx.request('/api/config');
    assert.equal(configRes.status, 200);
    assert.equal(configRes.data.payments, null, 'Payments must be null when credentials are not configured');
  });

  test('saved bookings notify the configured team destination', async () => {
    const notices = [];
    app.locals.bookingNotifier = async notice => notices.push(notice);
    try {
      const res = await ctx.request('/api/bookings', { method: 'POST', body: {
        name: 'Notification Test', contact: '+919876543210', date: '2026-11-21',
        time: '10:00', practice: 'The Plus-One', lady: true,
      } });
      assert.equal(res.status, 201);
      assert.equal(notices.length, 1);
      assert.match(notices[0].subject, new RegExp(res.data.ref));
      assert.match(notices[0].text, /Notification Test/);
    } finally { delete app.locals.bookingNotifier; }
  });

  test('booking remains saved if the notification fails', async () => {
    app.locals.bookingNotifier = () => { throw new Error('Mail unavailable'); };
    try {
      const res = await ctx.request('/api/bookings', { method: 'POST', body: {
        name: 'Mail Failure Test', contact: '+919876543210', date: '2026-11-21',
        time: '11:00', practice: 'The Plus-One', lady: true,
      } });
      assert.equal(res.status, 201);
      const rows = await sql.query('SELECT ref FROM bookings WHERE ref = $1', [res.data.ref]);
      assert.equal(rows.length, 1);
    } finally { delete app.locals.bookingNotifier; }
  });

  test('concurrent reservations: exactly one survives, competitor receives 409', async () => {
    const date = '2026-11-18'; // Wednesday
    const time = '10:00';

    const req1 = ctx.request('/api/bookings', {
      method: 'POST',
      body: {
        name: 'First Competitor',
        contact: '+91 98765 11111',
        date,
        time,
        practice: 'The Plus-One',
        lady: true,
      },
    });

    const req2 = ctx.request('/api/bookings', {
      method: 'POST',
      body: {
        name: 'Second Competitor',
        contact: '+91 98765 22222',
        date,
        time,
        practice: 'The Plus-One',
        lady: true,
      },
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();

    assert.deepEqual(statuses, [201, 409], 'Exactly one booking must succeed (201) and the loser must receive 409');

    const winner = res1.status === 201 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;

    assert.ok(winner.data.ref, 'Winner receives booking ref');
    assert.equal(winner.data.payment, null, 'Payment payload must be null');
    assert.ok(loser.data.error.includes('held by someone else'), 'Loser receives polite conflict error');

    // Confirm DB has exactly 1 active booking for this date/time
    const rows = await sql.query(
      `SELECT * FROM bookings WHERE date = $1 AND time = $2 AND status IN ('pending', 'confirmed')`,
      [date, time]
    );
    assert.equal(rows.length, 1);
  });

  test('cancellation frees slot allowing subsequent booking', async () => {
    const date = '2026-11-18';
    const time = '10:00';

    // Fetch existing booking
    const [existing] = await sql.query('SELECT id FROM bookings WHERE date = $1 AND time = $2', [date, time]);
    assert.ok(existing);

    // Cancel via admin endpoint
    const patchRes = await ctx.request(`/api/admin/bookings/${existing.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'cancelled' },
    });
    assert.equal(patchRes.status, 200);

    // Verify slots endpoint shows slot as free
    const slotsRes = await ctx.request(`/api/slots?start=${date}&days=1`);
    assert.equal(slotsRes.status, 200);
    const day = slotsRes.data.days[0];
    const slot = day.slots.find(s => s.time === time);
    assert.equal(slot.status, 'open', 'Cancelled slot must be marked open');

    // Re-booking now succeeds
    const rebookRes = await ctx.request('/api/bookings', {
      method: 'POST',
      body: {
        name: 'New Applicant',
        contact: '+91 98765 33333',
        date,
        time,
        practice: 'The Plus-One',
        lady: true,
      },
    });
    assert.equal(rebookRes.status, 201, 'Slot must be bookable again after cancellation');
  });

  test('public block prevents booking and redacts private reason', async () => {
    const date = '2026-11-19'; // Thursday
    const time = '16:00';
    const secretReason = 'Confidential state dignitary escort';

    // Add block via admin
    const blockRes = await ctx.request('/api/admin/blocks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { date, time, reason: secretReason },
    });
    assert.equal(blockRes.status, 201);

    // Attempt booking on blocked slot
    const bookRes = await ctx.request('/api/bookings', {
      method: 'POST',
      body: {
        name: 'Blocked Visitor',
        contact: '+91 98765 44444',
        date,
        time,
        practice: 'The Plus-One',
        lady: true,
      },
    });

    assert.equal(bookRes.status, 409);
    assert.ok(!bookRes.raw.includes(secretReason), 'Secret reason must not leak');
  });

  test('waitlist accepts held slot', async () => {
    const date = '2026-11-20'; // Friday
    const time = '07:00';

    // Book the slot
    const bookRes = await ctx.request('/api/bookings', {
      method: 'POST',
      body: {
        name: 'Primary Holder',
        contact: '+91 98765 55555',
        date,
        time,
        practice: 'The Plus-One',
        lady: true,
      },
    });
    assert.equal(bookRes.status, 201);

    // Join waitlist for the held slot
    const waitRes = await ctx.request('/api/waitlist', {
      method: 'POST',
      body: {
        name: 'Hopeful Waiter',
        contact: '+91 98765 66666',
        date,
        time,
      },
    });
    assert.equal(waitRes.status, 201);

    // Verify waitlist row in DB
    const waitRows = await sql.query('SELECT * FROM waitlist WHERE date = $1 AND time = $2', [date, time]);
    assert.equal(waitRows.length, 1);
    assert.equal(waitRows[0].name, 'Hopeful Waiter');
  });

  test('additive schema rerun preserves existing bookings and schema', async () => {
    const countBefore = await sql.query('SELECT COUNT(*)::int AS count FROM bookings');
    const beforeTotal = countBefore[0].count;
    assert.ok(beforeTotal > 0, 'Must have existing bookings');

    // Re-run schema initialization
    await initSchema(sql);

    const countAfter = await sql.query('SELECT COUNT(*)::int AS count FROM bookings');
    const afterTotal = countAfter[0].count;
    assert.equal(afterTotal, beforeTotal, 'Additive schema rerun must preserve all existing bookings without data loss');
  });

  test('weekend has 24 hourly slots and old half-hour bookings block overlaps', async () => {
    const date = '2026-11-22'; // Sunday
    await sql.query(`INSERT INTO bookings (ref, name, contact, date, time, practice, status)
      VALUES ('PRS-LEGACY', 'Legacy', '+919876543210', $1, '07:30', 'The Plus-One', 'pending')`, [date]);
    const result = await ctx.request(`/api/slots?start=${date}&days=1`);
    const day = result.data.days[0];
    assert.equal(day.closed, false);
    assert.equal(day.slots.length, 24);
    assert.equal(day.slots.find(s => s.time === '00:00').status, 'open');
    assert.equal(day.slots.find(s => s.time === '07:00').status, 'held');
    assert.equal(day.slots.find(s => s.time === '08:00').status, 'held');
    assert.equal(day.slots.find(s => s.time === '23:00').status, 'open');
    const [legacy] = await sql.query(`UPDATE bookings SET status = 'cancelled' WHERE ref = 'PRS-LEGACY' RETURNING id`);
    const reactivation = await ctx.request(`/api/admin/bookings/${legacy.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${adminToken}` }, body: { status: 'confirmed' },
    });
    assert.equal(reactivation.status, 409);
  });
});
