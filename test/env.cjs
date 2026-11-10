// test/env.cjs
// Ensures test environments NEVER read local secret files or connect to live services.
process.env.NODE_ENV = 'test';
process.env.NO_LOAD_ENV = '1';
process.env.PORT = '0';
process.env.ADMIN_PASSWORD = 'test-admin-password';
process.env.SMTP_USER = 'roojool.talekar@gmail.com';
process.env.CRON_SECRET = 'test-cron-secret-12345';

// Explicitly clear all inherited live provider, messaging, storage and payment credentials
delete process.env.DATABASE_URL;
delete process.env.SMTP_HOST;
delete process.env.SMTP_PASS;
delete process.env.NOTIFY_EMAIL;
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.DEPOSIT_RUPEES;
