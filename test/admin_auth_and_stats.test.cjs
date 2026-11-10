require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../server.js');
const { createTestServer, createPgLiteSql, VALID_PNG } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Admin Authentication, Stats & Photo Streaming', () => {
  let ctx;
  let sql;
  let storage;
  const adminToken = 'auth_admin_secret_token';

  before(async () => {
    sql = await createPgLiteSql();
    storage = new MemoryStorage();
    ctx = await createTestServer(app, { sql, storage });

    // Seed admin session
    const tokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await sql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [tokenHash, Date.now() + 3600000]
    );

    // Seed bookings and waitlist for stats
    const configRes = await ctx.request('/api/config');
    const today = configRes.data?.today || new Date().toISOString().slice(0, 10);
    await sql.query(
      `INSERT INTO bookings (ref, name, contact, date, time, practice, status)
       VALUES ('PRS-1', 'Lady One', '+919999999991', $1, '07:30', 'The Plus-One', 'pending'),
              ('PRS-2', 'Lady Two', '+919999999992', $1, '10:00', 'The Carrier', 'confirmed'),
              ('PRS-3', 'Lady Three', '+919999999993', $1, '16:00', 'Deep Yin Listening', 'confirmed')`,
      [today]
    );
    await sql.query(
      `INSERT INTO waitlist (name, contact, date, time)
       VALUES ('Waitlist Lady', '+919999999994', $1, '19:00')`,
      [today]
    );

    // Seed application and photo
    const pathname = 'applications/app_sess_test/photo-1.png';
    await storage.put(pathname, VALID_PNG, 'image/png');

    const [appRow] = await sql.query(`
      INSERT INTO applications (ref, session_id, name, email, phone, city, age, experience, portfolio, social, status, receipt_status)
      VALUES ('APP-TEST99', 'app_sess_test', 'Adeline Sterling', 'adeline@example.com', '+91 98765 43210', 'Mumbai', 29,
              'Fine dining hosting and cultural escort.', 'https://adeline.example.com', 'https://instagram.com/adeline', 'new', 'sent')
      RETURNING id
    `);

    await sql.query(`
      INSERT INTO application_photos (application_id, pathname, mime_type, size_bytes)
      VALUES ($1, $2, 'image/png', $3)
    `, [appRow.id, pathname, VALID_PNG.length]);
  });

  after(async () => {
    await ctx.close();
  });

  test('unauthenticated access to admin endpoints returns 401', async () => {
    const endpoints = [
      ['GET', '/api/admin/stats'],
      ['GET', '/api/admin/applications'],
      ['GET', '/api/admin/applications/1'],
      ['PATCH', '/api/admin/applications/1'],
      ['GET', '/api/admin/applications/1/photos/1'],
    ];

    for (const [method, path] of endpoints) {
      const res = await ctx.request(path, { method });
      assert.equal(res.status, 401, `Expected 401 for ${method} ${path}`);
    }
  });

  test('admin endpoints return Cache-Control: private, no-store', async () => {
    const res = await ctx.request('/api/admin/stats', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('cache-control')?.includes('no-store'));
  });

  test('GET /api/admin/stats returns independent counts', async () => {
    const res = await ctx.request('/api/admin/stats', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.pending, 1);
    assert.equal(res.data.confirmed, 2);
    assert.equal(res.data.waitlist, 1);
    assert.equal(res.data.applications, 1);
  });

  test('GET /api/admin/applications supports status and pagination', async () => {
    const res = await ctx.request('/api/admin/applications?status=new&limit=10&offset=0', {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.total, 1);
    assert.equal(res.data.applications[0].name, 'Adeline Sterling');
  });

  test('GET /api/admin/applications/:id returns detail with photos', async () => {
    const [appRow] = await sql.query("SELECT id FROM applications WHERE ref = 'APP-TEST99'");
    const res = await ctx.request(`/api/admin/applications/${appRow.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.application.name, 'Adeline Sterling');
    assert.equal(res.data.application.photos.length, 1);
  });

  test('PATCH /api/admin/applications/:id updates status', async () => {
    const [appRow] = await sql.query("SELECT id FROM applications WHERE ref = 'APP-TEST99'");
    const res = await ctx.request(`/api/admin/applications/${appRow.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { status: 'shortlisted' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);

    const [updated] = await sql.query('SELECT status FROM applications WHERE id = $1', [appRow.id]);
    assert.equal(updated.status, 'shortlisted');
  });

  test('GET /api/admin/applications/:id/photos/:photoId streams binary image', async () => {
    const [appRow] = await sql.query("SELECT id FROM applications WHERE ref = 'APP-TEST99'");
    const [photoRow] = await sql.query('SELECT id FROM application_photos WHERE application_id = $1', [appRow.id]);

    const res = await ctx.request(`/api/admin/applications/${appRow.id}/photos/${photoRow.id}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(res.headers.get('cache-control')?.includes('no-store'));
  });
});
