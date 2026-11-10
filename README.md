# Presence. — Booking & Candidate Application Platform

A boutique companion booking and candidate application platform engineered with an Express backend, Neon PostgreSQL database, private Cloudflare R2 image storage, Gmail SMTP notification pipeline, and Cloudflare Workers runtime.

---

## Architecture & Free Commercial Tier Allowances

Engineered to operate within standard **free tier allowances**, with usage-based billing applying only if cloud storage quotas are exceeded. For complete breakdowns, domain pricing, and setup instructions, see [COSTS-SETUP.md](COSTS-SETUP.md):

1. **Edge Runtime & Static Delivery — Cloudflare Workers (Free Plan)**
   - **Allowance**: 100,000 requests/day, 10ms CPU time per request.
   - **Entry**: `worker.mjs` bridge importing the official runtime built-in `cloudflare:node` (`handleAsNodeRequest` / `httpServerHandler`), without requiring external compatibility package dependencies.
   - **Static Routing**: Direct `env.ASSETS` binding serves `/`, `/book`, `/about`, `/apply`, `/admin`, and client assets (`/assets/*`).
   - **API Forwarding**: Non-static requests dispatch directly to the Express application instance.
   - **Scheduled Crons**: Daily scheduled trigger at 03:00 UTC (`0 3 * * *`) executing staged upload cleanup. Cleanup operates in batches of 20 to strictly respect the Cloudflare Workers Free allowance of 50 subrequests per invocation (20 R2 deletes + 20 DB deletes + setup queries <= 50).

2. **Relational Database — Neon Serverless PostgreSQL (Free Tier)**
   - **Allowance**: 1 GB data storage/project, 100 CU-hours monthly/project (see [Neon Pricing](https://neon.com/pricing)).
   - **Schema & Migrations**: Additive migrations in `lib/schema.cjs` (applied via `init-db.cjs`), including atomic PostgreSQL PL/pgSQL primitives (`reserve_application_upload`, `finalize_application`).

3. **Private Object Storage — Cloudflare R2 (Standard Free Tier)**
   - **Allowance**: 10 GB storage/month, 1,000,000 Class A (write) operations/month, 10,000,000 Class B (read) operations/month, **$0 egress fees**. (Standard Cloudflare R2 pricing applies beyond these free allowances).
   - **Security**: Private bucket — zero public read endpoints. Candidate images stream exclusively via authenticated admin endpoints (`GET /api/admin/applications/:id/photos/:photoId`).
   - **Validation**: Magic header byte detection (JPEG, PNG, WebP) and single-image raw binary validation (<= 5MiB) occur directly within the upload endpoint (`POST /api/applications/upload`) before any storage write.
   - **Adapter**: Lightweight signed S3 HTTP client via `aws4fetch` supporting both Node.js and Workers runtimes.

4. **Notifications & Receipts — Gmail SMTP**
   - **Allowance**: Up to 500 emails/day on standard Google accounts.
   - **Setup**: Requires Google Account 2-Step Verification and a 16-character App Password (https://myaccount.google.com/apppasswords).
   - **Ports & Host**: Host `smtp.gmail.com`, Port `465` (SSL) or Port `587` (STARTTLS). Port 25 is never used.
   - **Sender**: Configured via `SMTP_USER` environment variable (never hardcoded in source).

---

## Safe Local Isolated Preview (Zero Credentials Required)

Run and inspect the entire application locally without any live database, cloud credentials, or internet connection using the isolated preview runner:

```bash
npm run preview:test
```

### Preview Isolation Guarantees:
- **Database**: In-memory PostgreSQL engine via `@electric-sql/pglite` (WebAssembly) with full PL/pgSQL function support.
- **Storage**: In-memory storage mock (`MemoryStorage`) serving in-memory image buffers.
- **Email**: In-memory stub mailer capturing receipts and booking notifications.
- **Admin Authentication**: Pre-seeded admin session with test password `presence-preview-123`.
- **Pre-seeded Profile**: Sample candidate profile featuring editorial fashion & luxury commercial brand modeling with renderable PNG portrait.
- **Environment**: Strict `NO_LOAD_ENV=1` isolation ensuring zero live credentials or `.env` files are accessed.

Access points:
- **Website**: http://localhost:3000
- **Apply UI**: http://localhost:3000/apply
- **Admin Dashboard**: http://localhost:3000/admin (Password: `presence-preview-123`)

*(Defaults to port 3000; override with `PREVIEW_PORT=3099 npm run preview:test`)*

---

## Local Development (With Real Services)

1. Copy `.env.example` to `.env` (or `.env.local` for local-only overrides):
   ```bash
   cp .env.example .env
   ```
2. Configure settings:
   - `ADMIN_PASSWORD`: Strong password (min 8 characters).
   - `DATABASE_URL`: Neon PostgreSQL connection string.
   - `SMTP_HOST`: `smtp.gmail.com`
   - `SMTP_PORT`: `465`
   - `SMTP_USER`: Your Gmail address (`roojool.talekar@gmail.com`).
   - `SMTP_PASS`: 16-character Gmail App Password.
   - `NOTIFY_EMAIL`: Notification destination address.
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: Private R2 credentials.
   - `TRUST_PROXY`: Set to `1` when hosted behind a reverse proxy (e.g. Cloudflare / Render).
3. Initialize the database schema:
   ```bash
   node init-db.cjs
   ```
4. Start the server:
   ```bash
   npm start
   ```

---

## Verification & Testing

The repository includes an extensive regression test suite covering concurrency, atomic primitives, server booking lifecycles, driver contracts, cleanup subrequest budgets, safety guarantees, and UI behavior:

```bash
# Run isolated test suite
npm test

# Run isolated check (alias for isolated test suite)
npm run check

# Verify Cloudflare Workers bundling and compatibility (dry-run)
npm run build
```

> [!NOTE]
> `npm run check` defaults to isolated in-memory test execution. The legacy `check:live` script targets live configured databases and requires explicit `ALLOW_LIVE_CHECK=1`; its presence never implies approval for live writes.

---

## Cloudflare Workers Production Deployment

### Status & Deployment Notes
- **Database Status**: Neon additive schema migration verified (all 4 application tables ready; existing bookings/waitlist/blocks counts preserved).
- **Storage**: Native private R2 binding (`APPLICATIONS_BUCKET` -> `presence-applications`) configured in `wrangler.jsonc`. With native binding, no S3 API credentials or public bucket URLs are required for Workers (S3 credential variables are optional and used only for Node.js scripts).
- **Pending Actions**: Cloudflare OAuth login (`npx wrangler login`), private bucket creation in user account, and Gmail App Password setup are pending human authentication.

1. Create private R2 bucket (once logged in):
   ```bash
   npx wrangler r2 bucket create presence-applications
   ```
2. Set production secrets in Cloudflare Workers:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put SMTP_HOST
   npx wrangler secret put SMTP_PORT
   npx wrangler secret put SMTP_USER
   npx wrangler secret put SMTP_PASS
   npx wrangler secret put NOTIFY_EMAIL
   npx wrangler secret put CRON_SECRET
   ```
3. Deploy to Cloudflare Workers:
   ```bash
   npx wrangler deploy
   ```
