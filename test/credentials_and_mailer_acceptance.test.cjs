require('./env.cjs');
process.env.APPLICANT_RECEIPTS = '1';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const app = require('../server.js');
const { createTestServer, createPgLiteSql, createMockMailer, VALID_JPEG } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Credentials, Upload Bounds & Mailer Failure Preservation Acceptance', () => {
  let ctx;
  let sql;
  let storage;
  let mailer;

  const validAdminToken = 'acceptance_admin_token';
  const expiredAdminToken = 'acceptance_expired_admin_token';

  before(async () => {
    sql = await createPgLiteSql();
    storage = new MemoryStorage();
    mailer = createMockMailer();
    ctx = await createTestServer(app, { sql, storage, mailer });

    const now = Date.now();
    // Valid admin session
    const validHash = crypto.createHash('sha256').update(validAdminToken).digest('hex');
    await sql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [validHash, now + 86400000]
    );

    // Expired admin session
    const expiredHash = crypto.createHash('sha256').update(expiredAdminToken).digest('hex');
    await sql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [expiredHash, now - 5000]
    );
  });

  after(async () => {
    await ctx.close();
  });

  test('expired admin Bearer cannot detail or stream photos (401)', async () => {
    // Attempt detail view with expired admin token
    const detailRes = await ctx.request('/api/admin/applications/1', {
      headers: { Authorization: `Bearer ${expiredAdminToken}` },
    });
    assert.equal(detailRes.status, 401);
    assert.equal(detailRes.data.error, 'please log in again');

    // Attempt photo stream with expired admin token
    const photoRes = await ctx.request('/api/admin/applications/1/photos/1', {
      headers: { Authorization: `Bearer ${expiredAdminToken}` },
    });
    assert.equal(photoRes.status, 401);

    // Unauthenticated access without Bearer token returns 401 immediately
    const noAuthRes = await ctx.request('/api/admin/applications/1');
    assert.equal(noAuthRes.status, 401);
  });

  test('expired or foreign app session cannot upload or finalize (401)', async () => {
    const now = Date.now();
    const token = 'sess_token_123';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Seed expired session
    const expiredSessId = 'sess_expired_1';
    await sql.query(
      'INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at) VALUES ($1, $2, 1, false, $3, $3)',
      [expiredSessId, tokenHash, now - 1000]
    );

    // Seed active session
    const activeSessId = 'sess_active_1';
    await sql.query(
      'INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at) VALUES ($1, $2, 1, false, $3, $3)',
      [activeSessId, tokenHash, now + 3600000]
    );

    const testPath = `applications/${activeSessId}/test.jpg`;

    // 1. Expired session cannot upload
    const expUpload = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': expiredSessId,
        'X-Upload-Pathname': `applications/${expiredSessId}/test.jpg`,
      },
      body: VALID_JPEG,
    });
    assert.equal(expUpload.status, 401);

    // 2. Foreign session (wrong token) cannot upload
    const foreignUpload = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: 'Bearer wrong_token_xyz',
        'X-Upload-Session': activeSessId,
        'X-Upload-Pathname': testPath,
      },
      body: VALID_JPEG,
    });
    assert.equal(foreignUpload.status, 401);

    // 3. Expired session cannot finalize
    const expFin = await ctx.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId: expiredSessId,
        token,
        name: 'Late Candidate',
        email: 'late@example.com',
        phone: '+91 98765 43210',
        city: 'Mumbai',
        age: 26,
        experience: 'Brand modeling',
        consent: true,
        photos: [{ pathname: `applications/${expiredSessId}/test.jpg` }],
      },
    });
    assert.equal(expFin.status, 401);

    // 4. Foreign session (wrong token) cannot finalize
    const foreignFin = await ctx.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId: activeSessId,
        token: 'wrong_token_xyz',
        name: 'Foreign Candidate',
        email: 'foreign@example.com',
        phone: '+91 98765 43210',
        city: 'Mumbai',
        age: 26,
        experience: 'Brand modeling',
        consent: true,
        photos: [{ pathname: testPath }],
      },
    });
    assert.equal(foreignFin.status, 401);
  });

  test('>5MiB or invalid signature upload returns 400', async () => {
    const sessRes = await ctx.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1 },
    });
    assert.equal(sessRes.status, 200);
    const { sessionId, token } = sessRes.data;

    // >5MiB upload (5.1 MiB)
    const oversizedBuffer = Buffer.alloc(5.1 * 1024 * 1024, 0xff);
    oversizedBuffer[0] = 0xff;
    oversizedBuffer[1] = 0xd8;
    oversizedBuffer[2] = 0xff; // valid JPEG header but > 5MiB

    const overRes = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': `applications/${sessionId}/large.jpg`,
      },
      body: oversizedBuffer,
    });
    assert.equal(overRes.status, 400);
    assert.ok(overRes.data.error.includes('exceeds max limit of 5MiB'));

    // Invalid signature (text claiming to be JPEG)
    const fakeBuffer = Buffer.from('NOT_AN_IMAGE_FILE_RANDOM_TEXT_BYTES');
    const fakeRes = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': `applications/${sessionId}/fake.jpg`,
      },
      body: fakeBuffer,
    });
    assert.equal(fakeRes.status, 400);
    assert.match(fakeRes.data.error, /JPEG.*PNG.*WebP/i);
  });

  test('throwing stub mailer: persists application+photos with status failed, retry idempotent, admin retry succeeds', async () => {
    // 1. Create fresh session
    const sessRes = await ctx.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1 },
    });
    assert.equal(sessRes.status, 200);
    const { sessionId, token } = sessRes.data;

    const pathname = `applications/${sessionId}/model.jpg`;
    const upRes = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': pathname,
      },
      body: VALID_JPEG,
    });
    assert.equal(upRes.status, 200);

    const payload = {
      sessionId,
      token,
      name: 'Elena Rostova',
      email: 'elena@example.com',
      phone: '+91 98765 43210',
      city: 'Delhi',
      age: 24,
      experience: 'Editorial and runway fashion modeling',
      consent: true,
      photos: [{ pathname }],
    };

    // 2. Configure mailer to throw simulated SMTP timeout
    mailer.shouldFail = true;

    // Initial submission
    const initRes = await ctx.request('/api/applications', {
      method: 'POST',
      body: payload,
    });

    assert.equal(initRes.status, 201);
    const ref = initRes.data.ref;
    assert.ok(ref.startsWith('APP-'));
    assert.equal(initRes.data.receiptStatus, 'failed', 'Receipt status must truthfully report failed');

    // Verify application and photo are persisted in database
    const [appRow] = await sql.query('SELECT * FROM applications WHERE ref = $1', [ref]);
    assert.ok(appRow, 'Application must be persisted despite mailer failure');
    assert.equal(appRow.receipt_status, 'failed');

    const photos = await sql.query('SELECT * FROM application_photos WHERE application_id = $1', [appRow.id]);
    assert.equal(photos.length, 1, 'Photo row must be persisted');

    // 3. Subsequent retry with same payload returns stable ref and no duplicates
    const retryRes = await ctx.request('/api/applications', {
      method: 'POST',
      body: payload,
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.data.ref, ref, 'Must return identical ref on retry');
    assert.equal(retryRes.data.receiptStatus, 'failed');

    const totalApps = await sql.query('SELECT COUNT(*)::int AS count FROM applications WHERE session_id = $1', [sessionId]);
    assert.equal(totalApps[0].count, 1, 'No duplicate application rows on retry');

    // 4. Restore mailer and retry via admin endpoint
    mailer.shouldFail = false;

    const adminRetry = await ctx.request(`/api/admin/applications/${appRow.id}/receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${validAdminToken}` },
    });

    assert.equal(adminRetry.status, 200);
    assert.equal(adminRetry.data.ok, true);
    assert.equal(adminRetry.data.receiptStatus, 'sent');

    const [updatedApp] = await sql.query('SELECT receipt_status FROM applications WHERE id = $1', [appRow.id]);
    assert.equal(updatedApp.receipt_status, 'sent', 'Receipt status must update to sent in DB');
  });
});
