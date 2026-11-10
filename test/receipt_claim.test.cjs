require('./env.cjs');
process.env.APPLICANT_RECEIPTS = '1';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const appA = require('../server.js');
delete require.cache[require.resolve('../server.js')];
const appB = require('../server.js');

const { createTestServer, createPgLiteSql, createMockMailer, VALID_JPEG } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Applicant Receipt Delivery & Atomic Lease Claims Across Instances', () => {
  let ctxA;
  let ctxB;
  let sharedSql;
  let sharedMailer;
  let sharedStorage;
  const adminToken = 'receipt_claim_admin_token';

  before(async () => {
    sharedSql = await createPgLiteSql();
    sharedMailer = createMockMailer();
    sharedStorage = new MemoryStorage();

    ctxA = await createTestServer(appA, { sql: sharedSql, mailer: sharedMailer, storage: sharedStorage });
    ctxB = await createTestServer(appB, { sql: sharedSql, mailer: sharedMailer, storage: sharedStorage });

    // Seed admin session
    const tokenHash = crypto.createHash('sha256').update(adminToken).digest('hex');
    await sharedSql.query(
      'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
      [tokenHash, Date.now() + 3600000]
    );
  });

  after(async () => {
    await Promise.all([ctxA.close(), ctxB.close()]);
  });

  async function createApplicationWithMailer(shouldFail = false) {
    sharedMailer.shouldFail = shouldFail;

    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1, website: '' },
    });
    const { sessionId, token } = sessRes.data;

    const pathname = `applications/${sessionId}/receipt-test.jpg`;
    await ctxA.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': pathname,
      },
      body: VALID_JPEG,
    });

    const res = await ctxA.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId,
        token,
        name: 'Rowan Bennett',
        email: 'rowan@example.com',
        phone: '+91 98765 43210',
        city: 'Bangalore',
        age: 30,
        experience: 'Seasoned conversationalist and literary escort.',
        consent: true,
        photos: [{ pathname }],
      },
    });

    return res;
  }

  test('successful email dispatch marks receiptStatus as sent', async () => {
    const res = await createApplicationWithMailer(false);
    assert.equal(res.status, 201);
    assert.equal(res.data.receiptStatus, 'sent');

    const lastMail = sharedMailer.sent[sharedMailer.sent.length - 1];
    assert.ok(lastMail);
    assert.equal(lastMail.to, 'rowan@example.com');
    assert.ok(lastMail.subject.includes(res.data.ref));
    assert.equal(lastMail.attachments, undefined);
  });

  test('already sent receipt skips re-dispatch on admin retry', async () => {
    const res = await createApplicationWithMailer(false);
    assert.equal(res.data.receiptStatus, 'sent');

    const [appRow] = await sharedSql.query('SELECT * FROM applications WHERE ref = $1', [res.data.ref]);
    const mailCountBefore = sharedMailer.sent.length;

    // Retry sending receipt on Instance B
    const retryRes = await ctxB.request(`/api/admin/applications/${appRow.id}/receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(retryRes.status, 200);
    assert.equal(retryRes.data.receiptStatus, 'sent');
    // Ensure no additional email was dispatched
    assert.equal(sharedMailer.sent.length, mailCountBefore);
  });

  test('concurrent retry attempts trigger atomic lease protection', async () => {
    // Create an application with failed receipt status
    const res = await createApplicationWithMailer(true);
    const [appRow] = await sharedSql.query('SELECT * FROM applications WHERE ref = $1', [res.data.ref]);
    assert.equal(appRow.receipt_status, 'failed');

    sharedMailer.shouldFail = false;

    // Manually set an active lease to simulate in-flight send from another instance
    await sharedSql.query(`
      UPDATE applications
      SET receipt_claim = 'active-worker-claim',
          receipt_claimed_at = $1,
          receipt_claim_expires_at = $2
      WHERE id = $3
    `, [Date.now(), Date.now() + 20000, appRow.id]);

    // Admin retry while lease is active must return 409
    const retryRes = await ctxB.request(`/api/admin/applications/${appRow.id}/receipt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    assert.equal(retryRes.status, 409);
    assert.match(retryRes.data.error, /already in flight/i);
  });
});
