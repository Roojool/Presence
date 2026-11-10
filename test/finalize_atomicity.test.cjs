require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const appA = require('../server.js');
delete require.cache[require.resolve('../server.js')];
const appB = require('../server.js');

const { createTestServer, createPgLiteSql, VALID_JPEG } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Finalize Atomicity & Concurrent Competing Calls Across Instances', () => {
  let ctxA;
  let ctxB;
  let sharedSql;
  let sharedStorage;

  before(async () => {
    sharedSql = await createPgLiteSql();
    sharedStorage = new MemoryStorage();

    ctxA = await createTestServer(appA, { sql: sharedSql, storage: sharedStorage });
    ctxB = await createTestServer(appB, { sql: sharedSql, storage: sharedStorage });
  });

  after(async () => {
    await Promise.all([ctxA.close(), ctxB.close()]);
  });

  async function setupReadySession() {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 2, website: '' },
    });
    const { sessionId, token } = sessRes.data;

    const path1 = `applications/${sessionId}/p1.jpg`;
    const path2 = `applications/${sessionId}/p2.jpg`;

    await ctxA.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path1,
      },
      body: VALID_JPEG,
    });

    await ctxB.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path2,
      },
      body: VALID_JPEG,
    });

    const payload = {
      sessionId,
      token,
      name: 'Julian Vance',
      email: 'julian@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 28,
      experience: 'Bespoke conversationalist and hospitality specialist.',
      consent: true,
      photos: [{ pathname: path1 }, { pathname: path2 }],
    };

    return { sessionId, token, payload, path1, path2 };
  }

  test('finalization persists application and photos atomically in one function call', async () => {
    const { payload } = await setupReadySession();
    const res = await ctxA.request('/api/applications', {
      method: 'POST',
      body: payload,
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.ref.startsWith('APP-'));
    assert.ok(['sent', 'failed', 'pending'].includes(res.data.receiptStatus));

    // Verify DB records
    const apps = await sharedSql.query('SELECT * FROM applications WHERE ref = $1', [res.data.ref]);
    assert.equal(apps.length, 1);
    const photos = await sharedSql.query('SELECT * FROM application_photos WHERE application_id = $1', [apps[0].id]);
    assert.equal(photos.length, 2);
  });

  test('retrying finalization returns the exact same ref and receipt status', async () => {
    const { payload } = await setupReadySession();
    const firstRes = await ctxA.request('/api/applications', {
      method: 'POST',
      body: payload,
    });
    assert.equal(firstRes.status, 201);

    const secondRes = await ctxB.request('/api/applications', {
      method: 'POST',
      body: payload,
    });
    assert.equal(secondRes.status, 200);
    assert.equal(secondRes.data.ref, firstRes.data.ref);
    assert.equal(secondRes.data.receiptStatus, firstRes.data.receiptStatus);
  });

  test('concurrent competing finalize calls across instances yield identical ref and zero duplicate rows', async () => {
    const { payload } = await setupReadySession();

    // Fire competing calls across Instance A and Instance B
    const [resA, resB] = await Promise.all([
      ctxA.request('/api/applications', { method: 'POST', body: payload }),
      ctxB.request('/api/applications', { method: 'POST', body: payload }),
    ]);

    assert.ok([200, 201].includes(resA.status));
    assert.ok([200, 201].includes(resB.status));
    assert.equal(resA.data.ref, resB.data.ref);

    // Verify exactly 1 application in DB
    const matching = await sharedSql.query('SELECT * FROM applications WHERE ref = $1', [resA.data.ref]);
    assert.equal(matching.length, 1);
  });

  test('finalization fails if photo was not uploaded or is unverified', async () => {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1, website: '' },
    });
    const { sessionId, token } = sessRes.data;

    const unuploadedPath = `applications/${sessionId}/never-uploaded.jpg`;

    const res = await ctxA.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId,
        token,
        name: 'Ghost Candidate',
        email: 'ghost@example.com',
        phone: '+91 98765 43210',
        city: 'Bangalore',
        age: 28,
        experience: 'Testing ghost photo submission.',
        consent: true,
        photos: [{ pathname: unuploadedPath }],
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.data.error, /missing or unverified/i);
  });
});
