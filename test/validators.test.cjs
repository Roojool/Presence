require('./env.cjs');
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server.js');
const { createTestServer, createPgLiteSql, VALID_JPEG } = require('./helper.cjs');
const { MemoryStorage } = require('../lib/storage.cjs');

describe('Candidate Application Validators', () => {
  let ctx;
  let sql;
  let storage;

  before(async () => {
    sql = await createPgLiteSql();
    storage = new MemoryStorage();
    ctx = await createTestServer(app, { sql, storage });
  });

  after(async () => {
    await ctx.close();
  });

  async function createValidSession(photoCount = 2) {
    const res = await ctx.request('/api/applications/session', {
      method: 'POST',
      body: { photoCount, website: '' },
    });
    assert.equal(res.status, 200);
    return res.data;
  }

  async function uploadPhoto(sessionId, token, filename = 'uuid-1.jpg', data = VALID_JPEG) {
    const pathname = `applications/${sessionId}/${filename}`;
    const res = await ctx.request('/api/applications/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: `Bearer ${token}`,
        'X-Upload-Session': sessionId,
        'X-Upload-Pathname': pathname,
      },
      body: data,
    });
    assert.equal(res.status, 200);
    return pathname;
  }

  test('validates minimum name length (>= 2 chars)', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: ' ',
      email: 'applicant@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 25,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      photos: [{ pathname: photo }],
    };

    const res = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(res.status, 400);
    assert.equal(res.data.field, 'a-name');
  });

  test('validates email format', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: 'Valid Name',
      email: 'not-an-email',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 25,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      photos: [{ pathname: photo }],
    };

    const res = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(res.status, 400);
    assert.equal(res.data.field, 'a-email');
  });

  test('validates phone number digit count (7-15 digits)', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: 'Valid Name',
      email: 'valid@example.com',
      phone: '12345',
      city: 'Bangalore',
      age: 25,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      photos: [{ pathname: photo }],
    };

    const res = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(res.status, 400);
    assert.equal(res.data.field, 'a-phone');
  });

  test('validates integer age between 18 and 120 (rejects <18 and non-integers)', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: 'Young Candidate',
      email: 'young@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 17, // Under 18
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      photos: [{ pathname: photo }],
    };

    const resUnder18 = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(resUnder18.status, 400);
    assert.equal(resUnder18.data.field, 'a-age');

    // Float age
    const resFloat = await ctx.request('/api/applications', {
      method: 'POST',
      body: { ...base, age: 25.5 },
    });
    assert.equal(resFloat.status, 400);
    assert.equal(resFloat.data.field, 'a-age');
  });

  test('validates required consent (must be true)', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: 'Candidate Without Consent',
      email: 'valid@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 28,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: false,
      photos: [{ pathname: photo }],
    };

    const res = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(res.status, 400);
    assert.equal(res.data.field, 'a-consent');
    assert.equal(res.data.error, 'consent is required');
  });

  test('validates BOTH portfolio and social URLs must be HTTPS if provided', async () => {
    const { sessionId, token } = await createValidSession();
    const photo = await uploadPhoto(sessionId, token);

    const base = {
      sessionId,
      token,
      name: 'Candidate Insecure Portfolio',
      email: 'valid@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 28,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      portfolio: 'http://insecure-portfolio.com',
      photos: [{ pathname: photo }],
    };

    // Insecure HTTP portfolio
    const resPortfolio = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(resPortfolio.status, 400);
    assert.equal(resPortfolio.data.field, 'a-portfolio');

    // Insecure HTTP social
    const resSocial = await ctx.request('/api/applications', {
      method: 'POST',
      body: {
        ...base,
        portfolio: 'https://secure.com',
        social: 'http://insecure-social.com',
      },
    });
    assert.equal(resSocial.status, 400);
    assert.equal(resSocial.data.field, 'a-social');
  });

  test('malformed or null photo entries return 400 not 500', async () => {
    const { sessionId, token } = await createValidSession();

    const base = {
      sessionId,
      token,
      name: 'Malformed Photos Candidate',
      email: 'valid@example.com',
      phone: '+91 98765 43210',
      city: 'Bangalore',
      age: 28,
      experience: 'Ten years of bespoke luxury hospitality experience.',
      consent: true,
      photos: [null, { pathname: '' }],
    };

    const res = await ctx.request('/api/applications', { method: 'POST', body: base });
    assert.equal(res.status, 400);
    assert.equal(res.data.field, 'a-photos');
  });
});
