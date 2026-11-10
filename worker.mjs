import { createServer } from 'node:http';
import { handleAsNodeRequest, httpServerHandler } from 'cloudflare:node';
import app from './server.js';
import { cleanupAbandonedUploads } from './lib/cleanup.cjs';
import { createStorage } from './lib/storage.cjs';
import { neon } from '@neondatabase/serverless';

const PORT = 8080;
const server = createServer(app);
server.listen(PORT);

function resolveStorageFromEnv(env) {
  // Check if an actual R2 bucket binding object was provided
  for (const key of ['APPLICATIONS_BUCKET', 'R2_BUCKET', 'BUCKET']) {
    const candidate = env[key];
    if (candidate && typeof candidate === 'object' && typeof candidate.put === 'function') {
      return createStorage({ binding: candidate });
    }
  }

  // Check S3-compatible credentials
  const bucketName = typeof env.R2_BUCKET === 'string'
    ? env.R2_BUCKET
    : (typeof env.APPLICATIONS_BUCKET === 'string' ? env.APPLICATIONS_BUCKET : '');

  if (env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && bucketName) {
    return createStorage({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: bucketName,
    });
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    if (env.BOOKING_EMAIL) {
      app.locals.bookingNotifier = ({ subject, text }) => env.BOOKING_EMAIL.send({
        from: 'bookings@getpresence.me',
        to: 'hello@getpresence.me',
        subject,
        text,
      });
    }
    // Bind database if provided in Worker env
    if (env.DATABASE_URL && (!app.locals.sql || app.locals._cfSqlUrl !== env.DATABASE_URL)) {
      app.locals.sql = neon(env.DATABASE_URL);
      app.locals._cfSqlUrl = env.DATABASE_URL;
    }

    // Configure storage
    if (!app.locals.storage || app.locals._storageConfigured !== true) {
      const storage = resolveStorageFromEnv(env);
      if (storage) {
        app.locals.storage = storage;
        app.locals._storageConfigured = true;
      }
    }

    const url = new URL(request.url);

    // 1. Forward all API requests directly to Express
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return handleAsNodeRequest(PORT, request);
    }

    // 2. Serve static routes and assets via Cloudflare Workers Static ASSETS binding
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404) {
        return assetRes;
      }

      // Clean non-API routes (e.g. /, /book, /about, /apply, /admin direct and trailing routes)
      if (!url.pathname.includes('.')) {
        const cleanPath = url.pathname.replace(/\/+$/, '');
        const targetPath = cleanPath ? `${cleanPath}.html` : '/index.html';
        const htmlUrl = new URL(targetPath, request.url);
        const htmlReq = new Request(htmlUrl.toString(), request);
        const htmlRes = await env.ASSETS.fetch(htmlReq);
        if (htmlRes.status !== 404) {
          return htmlRes;
        }
      }
    }

    // 3. Fallback to Express handler
    return handleAsNodeRequest(PORT, request);
  },

  /**
   * Daily Cloudflare scheduled handler for cleaning up abandoned staged uploads (>24h)
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const sql = env.DATABASE_URL ? neon(env.DATABASE_URL) : app.locals.sql;
          const storage = resolveStorageFromEnv(env) || app.locals.storage;
          const results = await cleanupAbandonedUploads({ sql, storage });
          console.log('Daily staged uploads cleanup completed:', results);
        } catch (err) {
          console.error('Scheduled cleanup error:', err.message);
        }
      })()
    );
  },
};
