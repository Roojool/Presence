const http = require('node:http');
const crypto = require('node:crypto');
const { MemoryStorage } = require('../lib/storage.cjs');
const { createPgLiteSql } = require('./pglite_db.cjs');

/**
 * Creates a mock mailer that records sent messages in an array.
 * Can be configured to simulate network errors or timeouts.
 */
function createMockMailer({ shouldFail = false } = {}) {
  const sent = [];
  return {
    sent,
    shouldFail,
    async sendMail(opts) {
      if (this.shouldFail) {
        throw new Error('Simulated SMTP connection timeout');
      }
      sent.push({ ...opts, timestamp: Date.now() });
      return { messageId: 'msg_' + crypto.randomUUID() };
    },
  };
}

/**
 * Helper to launch an ephemeral test server wrapping express app with isolated fixtures
 */
async function createTestServer(app, { sql, storage, mailer } = {}) {
  const effectiveSql = sql || (await createPgLiteSql());
  const effectiveStorage = storage || new MemoryStorage();
  const effectiveMailer = mailer || createMockMailer();

  app.locals.sql = effectiveSql;
  app.locals.storage = effectiveStorage;
  app.locals.mailer = effectiveMailer;

  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;

      async function request(path, options = {}) {
        const url = `${baseUrl}${path}`;
        const headers = {
          ...options.headers,
        };
        const fetchOpts = {
          method: options.method || 'GET',
          headers,
        };

        if (options.body) {
          if (Buffer.isBuffer(options.body) || typeof options.body === 'string') {
            fetchOpts.body = options.body;
          } else {
            fetchOpts.body = JSON.stringify(options.body);
            if (!headers['Content-Type']) {
              headers['Content-Type'] = 'application/json';
            }
          }
        }

        const res = await fetch(url, fetchOpts);
        let data = null;
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = text;
        }

        return {
          status: res.status,
          headers: res.headers,
          data,
          raw: text,
        };
      }

      resolve({
        server,
        baseUrl,
        request,
        app,
        sql: effectiveSql,
        storage: effectiveStorage,
        mailer: effectiveMailer,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

// Real renderable 1x1 sample images
const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const VALID_WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // 'RIFF'
  0x18, 0x00, 0x00, 0x00, // size
  0x57, 0x45, 0x42, 0x50, // 'WEBP'
  0x56, 0x50, 0x38, 0x20, // 'VP8 '
]);

module.exports = {
  createPgLiteSql,
  createMockMailer,
  createTestServer,
  VALID_JPEG,
  VALID_PNG,
  VALID_WEBP,
};
