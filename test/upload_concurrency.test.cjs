require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const appA = require('../server.js');
// Create distinct app instance B for cross-instance concurrency
delete require.cache[require.resolve('../server.js')];
const appB = require('../server.js');

const { createTestServer, createPgLiteSql, VALID_JPEG, VALID_PNG, VALID_WEBP } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Upload Concurrency, Capacity & Idempotency Across Instances', () => {
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

  test('concurrent requests across instances cannot exceed photo_count capacity', async () => {
    // Session allows max 2 photos
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 2, website: '' },
    });
    assert.equal(sessRes.status, 200);
    const { sessionId, token } = sessRes.data;

    const path1 = `applications/${sessionId}/photo-1.jpg`;
    const path2 = `applications/${sessionId}/photo-2.jpg`;
    const path3 = `applications/${sessionId}/photo-3.jpg`;

    // Fire 3 concurrent uploads across both instances for 3 distinct pathnames
    const [res1, res2, res3] = await Promise.all([
      ctxA.request('/api/applications/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${token}`,
          'X-Upload-Session': sessionId,
          'X-Upload-Pathname': path1,
        },
        body: VALID_JPEG,
      }),
      ctxB.request('/api/applications/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${token}`,
          'X-Upload-Session': sessionId,
          'X-Upload-Pathname': path2,
        },
        body: VALID_JPEG,
      }),
      ctxA.request('/api/applications/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${token}`,
          'X-Upload-Session': sessionId,
          'X-Upload-Pathname': path3,
        },
        body: VALID_JPEG,
      }),
    ]);

    const statuses = [res1.status, res2.status, res3.status].sort();
    // Exactly 2 must succeed (200) and 1 must be rejected with 400 (capacity reached)
    assert.deepEqual(statuses, [200, 200, 400]);

    // Check DB row count: exactly 2
    const rows = await sharedSql.query('SELECT * FROM application_uploads WHERE session_id = $1', [sessionId]);
    assert.equal(rows.length, 2);
  });

  test('idempotent retry with same content hash succeeds without spending capacity', async () => {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1, website: '' },
    });
    const { sessionId, token } = sessRes.data;
    const path = `applications/${sessionId}/single.jpg`;

    // First upload on Instance A
    const resA = await ctxA.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: VALID_JPEG,
    });
    assert.equal(resA.status, 200);

    // Retry same path and same content on Instance B
    const resB = await ctxB.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: VALID_JPEG,
    });
    assert.equal(resB.status, 200);
    assert.equal(resB.data.pathname, path);
  });

  test('re-uploading same pathname with different content returns 409 Conflict', async () => {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 2, website: '' },
    });
    const { sessionId, token } = sessRes.data;
    const path = `applications/${sessionId}/conflict.jpg`;

    // Upload content 1
    const res1 = await ctxA.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: VALID_JPEG,
    });
    assert.equal(res1.status, 200);

    // Upload content 2 (different valid JPEG bytes) under same pathname
    const differentJpeg = Buffer.concat([VALID_JPEG, Buffer.from([0x00, 0x01, 0x02])]);
    const res2 = await ctxB.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: differentJpeg,
    });
    assert.equal(res2.status, 409);
    assert.match(res2.data.error, /different content/i);
  });

  test('failed storage write preserves DB reservation with status reserved for retry', async () => {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 2, website: '' },
    });
    const { sessionId, token } = sessRes.data;
    const path = `applications/${sessionId}/fail-retry.jpg`;

    // Make storage fail on next put
    const origPut = sharedStorage.put;
    sharedStorage.put = async () => {
      throw new Error('Simulated R2 network drop');
    };

    try {
      const res = await ctxA.request('/api/applications/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${token}`,
          'X-Upload-Session': sessionId,
          'X-Upload-Pathname': path,
        },
        body: VALID_JPEG,
      });
      assert.equal(res.status, 502);

      // Verify DB row exists with status = 'reserved'
      const [row] = await sharedSql.query('SELECT * FROM application_uploads WHERE pathname = $1', [path]);
      assert.ok(row, 'Reservation row must exist in DB despite storage failure');
      assert.equal(row.status, 'reserved');

      // Now restore storage and retry upload: should succeed!
      sharedStorage.put = origPut;
      const retryRes = await ctxB.request('/api/applications/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          Authorization: `Bearer ${token}`,
          'X-Upload-Session': sessionId,
          'X-Upload-Pathname': path,
        },
        body: VALID_JPEG,
      });
      assert.equal(retryRes.status, 200);

      // Verify row status updated to 'uploaded'
      const [updatedRow] = await sharedSql.query('SELECT * FROM application_uploads WHERE pathname = $1', [path]);
      assert.equal(updatedRow.status, 'uploaded');
    } finally {
      sharedStorage.put = origPut;
    }
  });

  test('finalized session cannot mutate or add uploads (409 Conflict)', async () => {
    const sessRes = await ctxA.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 1, website: '' },
    });
    const { sessionId, token } = sessRes.data;
    const path = `applications/${sessionId}/finalize-lock.jpg`;

    await ctxA.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: VALID_JPEG,
    });

    // Finalize the application
    const finalizeRes = await ctxA.request('/api/applications', {
      method: 'POST',
      body: {
        sessionId,
        token,
        name: 'Finalized Candidate',
        email: 'final@example.com',
        phone: '+91 98765 43210',
        city: 'Bangalore',
        age: 26,
        experience: 'Seasoned host and companion.',
        consent: true,
        photos: [{ pathname: path }],
      },
    });
    assert.equal(finalizeRes.status, 201);

    // Attempting to upload to finalized session must return 409
    const afterRes = await ctxB.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': path,
      },
      body: VALID_JPEG,
    });
    assert.equal(afterRes.status, 409);
    assert.match(afterRes.data.error, /already finalized/i);
  });
});
