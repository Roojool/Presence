require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server.js');
const { createTestServer, createPgLiteSql, VALID_JPEG } = require('./helper.cjs');
const { MemoryStorage, R2Storage } = require('../lib/storage.cjs');

describe('Cleanup Safety, Storage Deletion Failure & Retention', () => {
  let ctx;
  let sql;
  let storage;
  const cronSecret = 'cleanup_safety_cron_secret';

  before(async () => {
    process.env.CRON_SECRET = cronSecret;
    sql = await createPgLiteSql();
    storage = new MemoryStorage();
    ctx = await createTestServer(app, { sql, storage });
  });

  after(async () => {
    await ctx.close();
  });

  test('failed storage deletion preserves tracking row and session for retry', async () => {
    const oldTime = Date.now() - 25 * 3600 * 1000;
    const sessId = 'app_sess_fail_clean';

    await sql.query(`
      INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
      VALUES ($1, 'dummy_hash', 1, false, $2, $2)
    `, [sessId, oldTime]);

    const oldPath = `applications/${sessId}/abandoned.jpg`;
    await storage.put(oldPath, VALID_JPEG, 'image/jpeg');

    await sql.query(`
      INSERT INTO application_uploads (session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at)
      VALUES ($1, $2, 'dummyhash', 'image/jpeg', 100, 'uploaded', $3, $3)
    `, [sessId, oldPath, oldTime]);

    // Force storage.delete to fail
    const origDelete = storage.delete;
    storage.delete = async () => {
      throw new Error('R2 delete unavailable');
    };

    try {
      const res = await ctx.request('/api/cron/cleanup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.results.deletedUploads, 0);
      assert.equal(res.data.results.failedDeletes, 1);

      // Verify row in application_uploads was preserved (NOT deleted)
      const uploadRows = await sql.query('SELECT * FROM application_uploads WHERE pathname = $1', [oldPath]);
      assert.equal(uploadRows.length, 1, 'Upload tracking row must be preserved when storage delete fails');

      // Verify parent session was also preserved
      const sessRows = await sql.query('SELECT * FROM application_sessions WHERE id = $1', [sessId]);
      assert.equal(sessRows.length, 1, 'Parent session must be preserved when storage delete fails');
    } finally {
      storage.delete = origDelete;
    }

    // Now rerun cleanup with working storage: should delete object, upload row, and session
    const retryRes = await ctx.request('/api/cron/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.data.results.deletedUploads, 1);
    assert.equal(retryRes.data.results.deletedSessions, 1);

    const uploadAfter = await sql.query('SELECT * FROM application_uploads WHERE pathname = $1', [oldPath]);
    assert.equal(uploadAfter.length, 0);
  });

  test('cleanup NEVER deletes submitted/finalized photos or sessions', async () => {
    const oldTime = Date.now() - 25 * 3600 * 1000;
    const finalSessId = 'app_sess_finalized_keep';

    // Seed finalized session
    await sql.query(`
      INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
      VALUES ($1, 'dummy_hash', 1, true, $2, $2)
    `, [finalSessId, oldTime]);

    const finalPath = `applications/${finalSessId}/kept.jpg`;
    await storage.put(finalPath, VALID_JPEG, 'image/jpeg');

    await sql.query(`
      INSERT INTO application_uploads (session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at)
      VALUES ($1, $2, 'dummyhash', 'image/jpeg', 100, 'uploaded', $3, $3)
    `, [finalSessId, finalPath, oldTime]);

    const [appRow] = await sql.query(`
      INSERT INTO applications (ref, session_id, name, email, phone, city, age, experience, portfolio, social, consent, status, receipt_status, created_at, updated_at)
      VALUES ('APP-KEEP1', $1, 'Permanent Candidate', 'perm@example.com', '+91 98765 43210', 'Bangalore', 28, 'Experience...', '', '', true, 'new', 'sent', '2026-10-24 00:00:00', '2026-10-24 00:00:00')
      RETURNING id
    `, [finalSessId]);

    await sql.query(`
      INSERT INTO application_photos (application_id, pathname, mime_type, size_bytes)
      VALUES ($1, $2, 'image/jpeg', 100)
    `, [appRow.id, finalPath]);

    // Run cleanup
    const res = await ctx.request('/api/cron/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    assert.equal(res.status, 200);

    // Verify finalized photo still exists in storage
    const file = await storage.get(finalPath);
    assert.ok(file, 'Finalized photo must remain in storage');

    // Verify application and photos rows still exist in DB
    const finalApp = await sql.query('SELECT * FROM applications WHERE ref = $1', ['APP-KEEP1']);
    assert.equal(finalApp.length, 1);
    const finalPhoto = await sql.query('SELECT * FROM application_photos WHERE pathname = $1', [finalPath]);
    assert.equal(finalPhoto.length, 1);
  });

  test('R2Storage.delete throws on HTTP failure and succeeds on 404 or 204', async () => {
    const r2 = new R2Storage({
      accountId: 'acc123',
      accessKeyId: 'key123',
      secretAccessKey: 'sec123',
      bucket: 'test-bucket',
    });

    // Mock client.fetch for 500 error: must throw so cleanup doesn't drop tracking row
    r2.client.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal R2 Server Error',
    });

    await assert.rejects(
      async () => r2.delete('applications/sess1/photo.jpg'),
      /R2 delete failed \(500\)/
    );

    // Mock client.fetch for 404: object already absent/deleted -> should succeed cleanly
    r2.client.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => 'NoSuchKey',
    });
    await assert.doesNotReject(async () => r2.delete('applications/sess1/photo.jpg'));

    // Mock client.fetch for 204 No Content -> should succeed cleanly
    r2.client.fetch = async () => ({
      ok: true,
      status: 204,
      text: async () => '',
    });
    await assert.doesNotReject(async () => r2.delete('applications/sess1/photo.jpg'));
  });

  test('finalize cannot win after cleanup claims expired session', async () => {
    const crypto = require('node:crypto');
    const oldTime = Date.now() - 25 * 3600 * 1000;
    const raceSessId = 'app_sess_race_finalize';
    const token = 'race_token_123';
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await sql.query(`
      INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
      VALUES ($1, $2, 1, false, $3, $3)
    `, [raceSessId, tokenHash, oldTime]);

    const racePath = `applications/${raceSessId}/candidate.jpg`;
    await storage.put(racePath, VALID_JPEG, 'image/jpeg');

    await sql.query(`
      INSERT INTO application_uploads (session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at)
      VALUES ($1, $2, 'hash123', 'image/jpeg', 100, 'uploaded', $3, $3)
    `, [raceSessId, racePath, oldTime]);

    // Run cleanup: claims expired sessions (expires_at = 0)
    await ctx.request('/api/cron/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    // Now attempt to finalize the claimed session
    const finRes = await ctx.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId: raceSessId,
        token,
        name: 'Late Applicant',
        email: 'late@example.com',
        phone: '+91 98765 43210',
        city: 'Mumbai',
        age: 25,
        experience: 'Modeling experience',
        consent: true,
        photos: [{ pathname: racePath }],
      },
    });

    assert.equal(finRes.status, 401);
    assert.ok(finRes.data.error.includes('expired'));

    // Ensure no application row was inserted for the late applicant
    const apps = await sql.query('SELECT * FROM applications WHERE session_id = $1', [raceSessId]);
    assert.equal(apps.length, 0);
  });

  test('cleanup cleans up unfinalized session created 25h ago (expired 1h ago)', async () => {
    const now = Date.now();
    const createdAt = now - 25 * 3600 * 1000;
    const expiresAt = createdAt + 24 * 3600 * 1000; // expired 1 hour ago
    const sess25Id = 'app_sess_25h_ago';

    await sql.query(`
      INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
      VALUES ($1, 'hash25', 1, false, $2, $3)
    `, [sess25Id, expiresAt, createdAt]);

    const path25 = `applications/${sess25Id}/stale.jpg`;
    await storage.put(path25, VALID_JPEG, 'image/jpeg');

    await sql.query(`
      INSERT INTO application_uploads (session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at)
      VALUES ($1, $2, 'hash25', 'image/jpeg', 100, 'uploaded', $3, $3)
    `, [sess25Id, path25, createdAt]);

    const res = await ctx.request('/api/cron/cleanup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    assert.equal(res.status, 200);
    assert.ok(res.data.results.deletedUploads >= 1);
    assert.ok(res.data.results.deletedSessions >= 1);

    const uploads = await sql.query('SELECT * FROM application_uploads WHERE pathname = $1', [path25]);
    assert.equal(uploads.length, 0, 'Upload must be cleaned up');
    const sessions = await sql.query('SELECT * FROM application_sessions WHERE id = $1', [sess25Id]);
    assert.equal(sessions.length, 0, 'Session created 25h ago must be cleaned up');
  });

  test('R2Storage initializes AwsClient with retries = 0 to prevent subrequest multiplication', () => {
    const r2 = new R2Storage({
      accountId: 'acc123',
      accessKeyId: 'key123',
      secretAccessKey: 'sec123',
      bucket: 'test-bucket',
    });
    assert.equal(r2.client.retries, 0, 'AwsClient must have retries: 0 to respect subrequest budget');
  });

  test('cleanup bounds batch to 20 uploads and total subrequests <= 50 for Cloudflare Workers Free', async () => {
    const now = Date.now();
    const oldTime = now - 26 * 3600 * 1000;
    const batchSessId = 'app_sess_batch_21';

    await sql.query(`
      INSERT INTO application_sessions (id, token_hash, photo_count, finalized, expires_at, created_at)
      VALUES ($1, 'hash_batch', 25, false, $2, $2)
    `, [batchSessId, oldTime]);

    for (let i = 1; i <= 21; i++) {
      const p = `applications/${batchSessId}/photo_${i}.jpg`;
      await storage.put(p, VALID_JPEG, 'image/jpeg');
      await sql.query(`
        INSERT INTO application_uploads (session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at)
        VALUES ($1, $2, 'hash', 'image/jpeg', 100, 'uploaded', $3, $3)
      `, [batchSessId, p, oldTime + i]);
    }

    let queryCount = 0;
    const origQuery = sql.query.bind(sql);
    sql.query = async (...args) => {
      queryCount++;
      return origQuery(...args);
    };

    let storageDeleteCount = 0;
    const origStorageDelete = storage.delete.bind(storage);
    storage.delete = async (...args) => {
      storageDeleteCount++;
      return origStorageDelete(...args);
    };

    try {
      const res = await ctx.request('/api/cron/cleanup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cronSecret}` },
      });

      assert.equal(res.status, 200);
      assert.equal(res.data.results.deletedUploads, 20, 'Exactly 20 uploads must be processed in one invocation');

      // Assert 1 of the 21 uploads was retained for next run
      const remaining = await sql.query('SELECT * FROM application_uploads WHERE session_id = $1', [batchSessId]);
      assert.equal(remaining.length, 1, '1 upload must remain retained for subsequent cleanup run');

      const totalSubrequests = queryCount + storageDeleteCount;
      assert.ok(totalSubrequests <= 50, `Total subrequests (${totalSubrequests}) must be <= 50 for Workers Free budget`);
    } finally {
      sql.query = origQuery;
      storage.delete = origStorageDelete;
    }
  });
});
