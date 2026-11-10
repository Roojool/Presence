require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../server.js');
const { createTestServer, createPgLiteSql } = require('./helper.cjs');

describe('Private Reason Redaction & Availability', () => {
  let ctx;
  let sql;
  const privateReason = 'Confidential private engagement in Bangalore';
  const blockDate = '2026-11-16';
  const adminToken = 'redaction_admin_token';

  before(async () => {
    sql = await createPgLiteSql();
    ctx = await createTestServer(app, { sql });

    // Seed private block
    await sql.query(
      'INSERT INTO blocks (date, time, reason) VALUES ($1, $2, $3)',
      [blockDate, null, privateReason]
    );

    // Seed admin session
    const tokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await sql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [tokenHash, Date.now() + 3600000]
    );
  });

  after(async () => {
    await ctx.close();
  });

  test('public /api/slots redacts admin block reason to generic "unavailable"', async () => {
    const res = await ctx.request(`/api/slots?start=${blockDate}&days=1`);
    assert.equal(res.status, 200);
    const day = res.data.days[0];
    assert.ok(day);
    assert.equal(day.closed, true);
    assert.equal(day.closedReason, 'unavailable');
    assert.ok(!res.raw.includes(privateReason));
  });

  test('public /api/bookings redacts block reason on attempted booking', async () => {
    const body = {
      name: 'Curious Visitor',
      contact: '+91 98765 43210',
      date: blockDate,
      time: '10:00',
      practice: 'The Plus-One',
      lady: true,
    };

    const res = await ctx.request('/api/bookings', { method: 'POST', body });
    assert.equal(res.status, 409);
    assert.ok(res.data.error.includes('unavailable'));
    assert.ok(!res.raw.includes(privateReason));
  });

  test('private admin /api/admin/blocks retains the original reason', async () => {
    const res = await ctx.request('/api/admin/blocks', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    const block = res.data.blocks.find(b => b.date === blockDate);
    assert.ok(block);
    assert.equal(block.reason, privateReason);
  });
});
