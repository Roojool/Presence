# Presence — Design & Architecture Contract (Frozen)

**Architecture:** Cloudflare Workers + Neon Postgres + Private Cloudflare R2 (operates within standard free allowances/quotas, zero Vercel dependencies; not unlimited/no-cost guarantees).  
**Ownership:** A: shared assets | B: backend + upload-client | C: home/about | D: book | E: apply | F: admin.

## 1. Shell & Asset Contract
* **Pages:** Load `/assets/site.css` and `defer /assets/site.js`. `body[data-page="home|book|about|apply|admin"]`.
* **Injection:** `site.js` injects skip link (`.skip-link`), header (`#site-header`) with `/`, `/book`, `/about`, `/apply`, and footer (`#site-footer`).
* **Vectors:** `/assets/lily-mark.svg` (64x64 mark), `/assets/lily-art.svg` (600x800 Lycoris radiata botanical illustration).
* **Typography:** Federant (`--font-serif`), Karla (`--font-sans`).
* **Tokens:** Grounds `--bg-ink` (`#070506`), `--bg-cherry` (`#13080b`), `--bg-surface` (`#1e0e13`). Text `--text-ivory` (`#faf6ee`), `--text-bone` (`#c0b9a6`), `--text-muted` (`#8a8270`). Accents `--crimson` (`#c9161d`), `--crimson-bright` (`#e5252d`), `--sage` (`#75835c`), `--amber` (`#c98a63`).
* **Classes:** `[hidden]`, `.hidden`, `.skip-link`, `.container`, `.container-narrow`, `.container-wide`, `.section`, `.section-sm`, `.section-lg`, `.grid-2`, `.grid-3`, `.grid-4`, `.grid-split`, `.eyebrow`, `h1`-`h4`, `.lede`, `.serif-quote`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-sm`, `.btn-lg`, `.btn-block`, `.field`, `.label`, `.req`, `.input`, `.select`, `.textarea`, `.checkbox-label`, `.field-hint`, `.field-error`, `.has-error`, `.dropzone`, `.photo-thumb`, `.card`, `.card-cherry`, `.card-editorial`, `.team-grid`, `.team-card`, `.team-frame`, `.team-placeholder`, `.notice`, `.notice-info`, `.notice-warn`, `.notice-error`, `.notice-success`, `.badge`, `.tag`.
* **Helpers:** `PresenceUI.toast(msg, type?, ms?)`, `PresenceUI.setFieldError(id, msg)`, `PresenceUI.clearFieldError(id)`, `PresenceUI.clearAllErrors(root?)`.
* **Accessibility:** `color-scheme: dark`, native controls readable, focus rings, reduced motion, main content visible by default.

## 2. Frozen API Contract

### Config & Slots
* `GET /api/config`: Returns `{ timezone, today, priceRupees, maxDaysAhead, payments, practices: [string], slots: [{time, name, note}], applications: { enabled: boolean, maxPhotos: 5, maxPhotoBytes: 5242880 } }`.
* `GET /api/slots?start=&days=`: Unchanged shape `{ today, days }`. Closed reasons must be generic.
* `POST /api/bookings`, `POST /api/bookings/:ref/payment`, `POST /api/waitlist`: Unchanged.

### Applications (Fashion & Brand Recruits)
* Input IDs: `a-name`, `a-email`, `a-phone`, `a-city`, `a-age`, `a-experience`, `a-photos`, `a-consent` (consent is for application review). Optional `portfolio`, `social` must be valid HTTPS URLs.
* Session: `POST /api/applications/session` body `{ photoCount, website: '' }` -> `{ sessionId, token }`.
* Upload Module: `/assets/upload-client.js` (Worker B) exports `upload(pathname, file, { clientPayload, onUploadProgress, signal? })` with `clientPayload` JSON `{ sessionId, token }`.
* Upload Endpoint: Raw single file `POST /api/applications/upload`.
  * Headers: `Authorization: Bearer <token>`, `X-Upload-Session: <sessionId>`, `X-Upload-Pathname: applications/<sessionId>/<uuid>.<ext>`, `Content-Type: image/jpeg|image/png|image/webp` (max 5242880 bytes).
  * Storage: Server streams to private Cloudflare R2 and returns `{ pathname }` after validating session ownership.
* Final Submit: `POST /api/applications` JSON `{ sessionId, token, name, email, phone, city, age, experience, portfolio?, social?, consent: true, photos: [{ pathname }] }` -> `201 { ref, receiptStatus: 'sent'|'failed'|'pending' }`. Idempotent retry on same session. Errors return `{ error, field? }`. No page assumes storage/email enabled.

### Admin Portal
* `GET /api/admin/applications?search=&status=&limit=50&offset=0` -> `{ applications: [...], total }`.
* `GET /api/admin/applications/:id` -> `{ application: { ...fields, photos: [{ id, mime_type, pathname }] } }`.
* `PATCH /api/admin/applications/:id` -> `{ status: 'new'|'reviewing'|'shortlisted'|'rejected' }`.
* `GET /api/admin/applications/:id/photos/:photoId` -> Authorization Bearer required, returns private bytes with `Cache-Control: no-store`. Frontend fetches blob to `URL.createObjectURL` (no direct unauthenticated `<img>`).
* `POST /api/admin/applications/:id/receipt` -> Retries acknowledgment email -> `{ ok: true, receiptStatus }`.
* `GET /api/admin/stats` -> `{ pending, confirmed, waitlist, applications }`. Existing admin APIs unchanged.
