require('./env.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server.js');
const { createTestServer, createMockMailer } = require('./helper.cjs');
const { DisabledStorage } = require('../lib/storage.cjs');

test('Instagram applications work without storage, survive email failure and retry safely', async () => {
  const ctx = await createTestServer(app, { storage: new DisabledStorage(), mailer: createMockMailer({ shouldFail: true }) });
  try {
    const session = await ctx.request('/api/applications/session', { method: 'POST', body: { photoCount: 0 } });
    assert.equal(session.status, 200);
    const body = { ...session.data, name: 'Test Applicant', email: 'candidate@example.test', phone: '+919876543210', city: 'Mumbai', age: 21, experience: 'Aspiring model with creative experience.', consent: true, social: '@test.model', photos: [] };
    const invalid = await ctx.request('/api/applications', { method: 'POST', body: { ...body, social: 'https://evil.example/' } });
    assert.equal(invalid.status, 400);
    const first = await ctx.request('/api/applications', { method: 'POST', body });
    assert.equal(first.status, 201);
    assert.equal(first.data.receiptStatus, 'pending');
    assert.equal(ctx.mailer.sent.length, 0);
    const retry = await ctx.request('/api/applications', { method: 'POST', body });
    assert.equal(retry.data.ref, first.data.ref);
    const rows = await ctx.sql.query('SELECT social FROM applications');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].social, 'https://www.instagram.com/test.model/');
  } finally { await ctx.close(); }
});
