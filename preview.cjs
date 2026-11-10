// preview.cjs — Safe local preview using isolated PGlite DB, memory storage & stub mailer
const requestedPort = (process.env.PORT && process.env.PORT !== '0') ? process.env.PORT : null;
require('./test/env.cjs');

const http = require('node:http');
const { createPgLiteSql } = require('./test/pglite_db.cjs');
const { MemoryStorage } = require('./lib/storage.cjs');
const { createMockMailer, VALID_PNG } = require('./test/helper.cjs');

const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || requestedPort || 3000);
const PREVIEW_ADMIN_PASS = 'presence-preview-123';
process.env.ADMIN_PASSWORD = PREVIEW_ADMIN_PASS;

async function startPreview() {
  const sql = await createPgLiteSql();
  const storage = new MemoryStorage();
  const mailer = createMockMailer();

  // Pre-seed an admin session
  const crypto = require('node:crypto');
  const token = 'preview_admin_session_token';
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await sql.query(
    'INSERT INTO admin_sessions (token_hash, expires_at) VALUES ($1, $2)',
    [tokenHash, Date.now() + 86400000]
  );

  // Pre-seed sample application for testing admin review UI with real renderable PNG
  const samplePath = 'applications/app_sess_demo/portrait-1.png';
  await storage.put(samplePath, VALID_PNG, 'image/png');

  const [sampleApp] = await sql.query(`
    INSERT INTO applications (ref, session_id, name, email, phone, city, age, experience, portfolio, social, consent, status, receipt_status)
    VALUES ('APP-PREVIEW1', 'app_sess_demo', 'Julian Vance', 'julian@example.com', '+91 98765 43210', 'Bangalore', 28,
            'Editorial fashion and luxury commercial brand modeling.',
            'https://julian.example.com', 'https://instagram.com/julian_presence', true, 'new', 'sent')
    RETURNING id
  `);

  await sql.query(`
    INSERT INTO application_photos (application_id, pathname, mime_type, size_bytes)
    VALUES ($1, $2, 'image/png', $3)
  `, [sampleApp.id, samplePath, VALID_PNG.length]);

  const app = require('./server.js');
  app.locals.sql = sql;
  app.locals.storage = storage;
  app.locals.mailer = mailer;

  const server = http.createServer(app);

  server.listen(PREVIEW_PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  ==============================================================');
    console.log('  ✨ PRESENCE — SAFE LOCAL ISOLATED PREVIEW');
    console.log('  ==============================================================');
    console.log(`  🌐 Website   : http://localhost:${PREVIEW_PORT}`);
    console.log(`  🔑 Admin     : http://localhost:${PREVIEW_PORT}/admin`);
    console.log(`  🔐 Password  : ${PREVIEW_ADMIN_PASS}`);
    console.log(`  📸 Apply UI  : http://localhost:${PREVIEW_PORT}/apply (or /apply.html)`);
    console.log('');
    console.log('  [ISOLATION GUARANTEES]');
    console.log('  - Database : In-memory PostgreSQL engine (PGlite WebAssembly)');
    console.log('  - Storage  : In-memory R2 mock (zero cloud bucket calls)');
    console.log('  - Email    : In-memory stub mailer (zero external SMTP calls)');
    console.log('  - Real Env : Disconnected (NO_LOAD_ENV=1)');
    console.log('  ==============================================================');
    console.log('');
  });
}

startPreview().catch((err) => {
  console.error('Failed to start preview:', err);
  process.exit(1);
});
