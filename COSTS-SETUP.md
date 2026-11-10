# Presence. — Official Hosting, Domain & Launch Cost Guide

This guide details official service allowances, domain renewal costs, and the step-by-step launch checklist as verified on **27 October 2026**.

---

## 1. Cost Overview & Real-World Pricing

| Item | Year 1 Cost | Year 2+ Renewal | Provider / Official Source |
|---|---|---|---|
| **Domain (`.me`)** | **$0.00** *(via Student Pack)* | **US$23.98/yr** *(+tax/FX)* | [GitHub Student Pack](https://education.github.com/pack) / [Namecheap nc.me](https://nc.me/landing/github) / [Namecheap .me Rates](https://www.namecheap.com/domains/registration/cctld/me/) |
| **DNS & SSL/TLS** | **$0.00** | **$0.00** | [Cloudflare Universal SSL](https://developers.cloudflare.com/ssl/) (included free) |
| **Edge Compute** | **$0.00** *(100k req/day)* | **$0.00** | [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) (Paid starts at $5/mo min) |
| **Database** | **$0.00** *(1 GB / 100 CU-hrs)* | **$0.00** | [Neon Serverless Postgres](https://neon.com/pricing) (Free tier) |
| **Photo Storage** | **$0.00** *(10 GB standard)* | **$0.00** *(within tier)* | [Cloudflare R2 Free Allowance](https://developers.cloudflare.com/r2/pricing/) (card may be needed; see overages below) |
| **Email (Outbound)** | **$0.00** *(low volume)* | **$0.00** | [Gmail App Password](https://support.google.com/mail/answer/185833) (via Google 2FA; see [Sending Limits](https://support.google.com/mail/answer/22839)) |
| **Email (Inbound)** | **$0.00** | **$0.00** | [Cloudflare Email Routing](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/) (forwarding only, no outbound SMTP) |
| **Company Page** | **$0.00** | **$0.00** | [LinkedIn Company Pages](https://www.linkedin.com/help/linkedin/answer/a543852) (Basic company page is free; no ads/premium needed) |
| **Profile QR Codes**| **$0.00** | **$0.00** | Static client-side QR generation (zero ongoing fee) |
| **Cloud Setup Fees**| **$0.00** | **$0.00** | No initial platform activation fees |
| **TOTAL** | **$0.00** *(conditional)* | **~$23.98/yr** | *Excludes domain overages/premium acquisitions* |

> [!IMPORTANT]
> **Domain Note on `presence.me`**: According to [Namecheap registrar lookup](https://www.namecheap.com/domains/registration/results/?domain=presence.me), `presence.me` is currently listed as **PREMIUM / "Make offer"** with an unquoted acquisition price. It is **not** eligible for the free standard `.me` student benefit. You must select an available standard alternative (e.g., `presence-studio.me`, `presenceapp.me`) to utilize the $0 first-year student coupon, or budget separately for custom premium acquisition.

---

## 2. Service Allowances & Quota Limits

- **Cloudflare Workers (Free Plan)**: 100,000 requests/day and 10ms CPU time/request. If higher limits are required, the Workers Paid tier begins at $5.00/month plus usage.
- **Neon Serverless PostgreSQL (Free Tier)**: 1 GB data storage per project and 100 Compute Unit (CU) hours monthly per project.
- **Cloudflare R2 Object Storage (Standard Free Tier)**: 10 GB-month storage, 1,000,000 Class A (write) operations, and 10,000,000 Class B (read) operations per month with **$0 egress fees**. Overages are billed at $0.015/GB-month, $4.50/M Class A, and $0.36/M Class B. Cloudflare may require billing activation / credit card on file to create R2 buckets.
- **Gmail SMTP (`roojool.talekar@gmail.com`)**: Free for standard transactional notifications and receipts. Requires 2-Step Verification and a generated 16-character App Password stored in environment secrets (never in git or chat). Google enforces anti-abuse sending limits (often capped around 500 emails/day; not guaranteed in all situations). Note that Cloudflare Email Routing forwards inbound addresses but does not send outbound mail.
- **LinkedIn Company Page**: Free standard business page. No paid LinkedIn Premium, recruiter seats, or marketing campaigns are required.

---

## 3. Step-by-Step Setup & Launch Checklist

1. **Domain Selection & Redemption**:
   - Check eligibility at [education.github.com/pack](https://education.github.com/pack) and redeem standard `.me` 1-year registration at [nc.me/landing/github](https://nc.me/landing/github).
   - Verify the chosen domain is standard (non-premium). If targeting a premium domain like `presence.me`, negotiate an acquisition price separately.
2. **DNS & HTTPS Setup**:
   - Add your domain to Cloudflare (Free plan). Point registrar nameservers to Cloudflare.
   - Cloudflare Universal SSL automatically provides free HTTPS certificates.
   - Configure Cloudflare Email Routing for inbound address forwarding (e.g., `contact@yourdomain.me` -> personal inbox) if desired.
3. **Database & Migrations**:
   - Status: Additive schema migration verified on Neon; all 4 application tables ready with existing data intact.
   - For new setups, run additive database migrations via `node init-db.cjs` in a staging environment prior to production.
4. **Cloudflare R2 Storage**:
   - In Cloudflare Dashboard, navigate to R2 -> Create private bucket (`presence-applications`).
   - With native Workers binding (`APPLICATIONS_BUCKET` in `wrangler.jsonc`), S3 API keys are optional (needed only for external Node.js scripts); the Worker accesses the bucket directly without credentials. Keep the bucket strictly private.
5. **Gmail SMTP Credentials**:
   - Log into `roojool.talekar@gmail.com`, enable 2-Step Verification, and generate an App Password for "Presence".
   - Store as `SMTP_USER=roojool.talekar@gmail.com` and `SMTP_PASS=<16-char-token>` in deployment secrets.
6. **LinkedIn Company Page Setup**:
   - Using your personal LinkedIn account, select **For Business -> Create a Company Page** (free).
   - Enter your company name, verified industry, city, and upload the official brand logo and bio copy.
   - The creator is automatically Super Admin; invite co-founders under **Settings -> Manage Admins**. Copy the page URL to link in the website footer.
7. **Production Deployment**:
   - Add all environment secrets to Cloudflare Workers via `npx wrangler secret put <NAME>`.
   - Deploy edge worker with `npx wrangler deploy`.
