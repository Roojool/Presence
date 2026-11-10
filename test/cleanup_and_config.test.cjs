require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server.js');
const { createTestServer, createPgLiteSql } = require('./helper.cjs');
const { MemoryStorage, DisabledStorage } = require('../lib/storage.cjs');

describe('Configuration Endpoint & Route Protections', () => {
  let ctx;
  let sql;
  let storage;

  before(async () => {
    process.env.CRON_SECRET = 'test_cron_secret_12345';
    sql = await createPgLiteSql();
    storage = new MemoryStorage();
    ctx = await createTestServer(app, { sql, storage });
  });

  after(async () => {
    await ctx.close();
  });

  test('/api/config exposes practices, slots, and applications config when storage enabled', async () => {
    const res = await ctx.request('/api/config');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.data.practices));
    assert.equal(res.data.practices.length, 7);
    assert.ok(Array.isArray(res.data.slots));
    assert.equal(res.data.slots.length, 24);
    assert.equal(res.data.applications.enabled, true);
    assert.equal(res.data.applications.maxPhotos, 5);
    assert.equal(res.data.applications.maxPhotoBytes, 5242880);
  });

  test('applications remain enabled without photo storage', async () => {
    app.locals.storage = new DisabledStorage();
    const res = await ctx.request('/api/config');
    assert.equal(res.status, 200);
    assert.equal(res.data.applications.enabled, true);

    // Attempting session returns 503
    const sessionRes = await ctx.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount: 2, website: '' },
    });
    assert.equal(sessionRes.status, 503);

    // Restore storage
    app.locals.storage = storage;
  });

  test('secure /api/cron/cleanup rejects unauthenticated requests with 401', async () => {
    const res = await ctx.request('/api/cron/cleanup', { method: 'POST' });
    assert.equal(res.status, 401);
  });
});
