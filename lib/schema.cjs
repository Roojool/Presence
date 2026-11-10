// lib/schema.cjs — Shared database schema and additive PL/pgSQL functions
// Used by both init-db.cjs (Neon migration) and test fixtures (PGlite).

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    practice TEXT NOT NULL,
    request TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    payment_status TEXT NOT NULL DEFAULT 'none',
    payment_order TEXT,
    payment_id TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_person_per_hour ON bookings(date, time)
    WHERE status IN ('pending', 'confirmed') AND time <> 'flexible'`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE TABLE IF NOT EXISTS blocks (
    id SERIAL PRIMARY KEY,
    date TEXT NOT NULL,
    time TEXT,
    reason TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    hits BIGINT[] NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS application_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    photo_count INTEGER NOT NULL DEFAULT 5,
    finalized BOOLEAN NOT NULL DEFAULT false,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS application_uploads (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES application_sessions(id) ON DELETE RESTRICT,
    pathname TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS applications (
    id SERIAL PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    age INTEGER NOT NULL,
    experience TEXT NOT NULL,
    portfolio TEXT DEFAULT '',
    social TEXT DEFAULT '',
    consent BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'new',
    receipt_status TEXT NOT NULL DEFAULT 'pending',
    receipt_claim TEXT,
    receipt_claimed_at BIGINT,
    receipt_claim_expires_at BIGINT,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status)`,
  `CREATE INDEX IF NOT EXISTS idx_applications_created_at ON applications(created_at)`,
  `CREATE TABLE IF NOT EXISTS application_photos (
    id SERIAL PRIMARY KEY,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    pathname TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
  )`,
  `CREATE INDEX IF NOT EXISTS idx_application_photos_app_id ON application_photos(application_id)`
];

const FUNCTION_STATEMENTS = [
  `CREATE OR REPLACE FUNCTION reserve_application_upload(
    p_session_id TEXT,
    p_token_hash TEXT,
    p_pathname TEXT,
    p_content_hash TEXT,
    p_mime_type TEXT,
    p_size_bytes INT,
    p_now BIGINT
  )
  RETURNS TABLE (
    result_status TEXT,
    existing_uploaded BOOLEAN
  ) AS $$
  DECLARE
    v_session RECORD;
    v_upload RECORD;
    v_count INT;
  BEGIN
    SELECT id, token_hash, photo_count, finalized, expires_at
    INTO v_session
    FROM application_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'INVALID_SESSION'::TEXT, FALSE;
      RETURN;
    END IF;

    IF v_session.expires_at < p_now THEN
      RETURN QUERY SELECT 'EXPIRED_SESSION'::TEXT, FALSE;
      RETURN;
    END IF;

    IF v_session.token_hash <> p_token_hash THEN
      RETURN QUERY SELECT 'INVALID_TOKEN'::TEXT, FALSE;
      RETURN;
    END IF;

    IF v_session.finalized THEN
      RETURN QUERY SELECT 'FINALIZED'::TEXT, FALSE;
      RETURN;
    END IF;

    SELECT id, content_hash, status
    INTO v_upload
    FROM application_uploads
    WHERE pathname = p_pathname
    FOR UPDATE;

    IF FOUND THEN
      IF v_upload.content_hash <> p_content_hash THEN
        RETURN QUERY SELECT 'CONTENT_MISMATCH'::TEXT, FALSE;
        RETURN;
      END IF;
      RETURN QUERY SELECT 'OK'::TEXT, (v_upload.status = 'uploaded');
      RETURN;
    END IF;

    SELECT COUNT(*)::INT
    INTO v_count
    FROM application_uploads
    WHERE session_id = p_session_id;

    IF v_count >= v_session.photo_count THEN
      RETURN QUERY SELECT 'CAPACITY_REACHED'::TEXT, FALSE;
      RETURN;
    END IF;

    INSERT INTO application_uploads (
      session_id, pathname, content_hash, mime_type, size_bytes, status, created_at, updated_at
    ) VALUES (
      p_session_id, p_pathname, p_content_hash, p_mime_type, p_size_bytes, 'reserved', p_now, p_now
    );

    RETURN QUERY SELECT 'OK'::TEXT, FALSE;
    RETURN;
  END;
  $$ LANGUAGE plpgsql;`,

  `CREATE OR REPLACE FUNCTION finalize_application(
    p_session_id TEXT,
    p_token_hash TEXT,
    p_ref TEXT,
    p_name TEXT,
    p_email TEXT,
    p_phone TEXT,
    p_city TEXT,
    p_age INT,
    p_experience TEXT,
    p_portfolio TEXT,
    p_social TEXT,
    p_consent BOOLEAN,
    p_pathnames TEXT[],
    p_now BIGINT
  )
  RETURNS TABLE (
    result_status TEXT,
    app_id INT,
    app_ref TEXT,
    receipt_status TEXT
  ) AS $$
  DECLARE
    v_session RECORD;
    v_existing_app RECORD;
    v_app_id INT;
    v_verified_count INT;
  BEGIN
    SELECT id, token_hash, photo_count, finalized, expires_at
    INTO v_session
    FROM application_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'INVALID_SESSION'::TEXT, NULL::INT, NULL::TEXT, NULL::TEXT;
      RETURN;
    END IF;

    IF v_session.expires_at < p_now THEN
      RETURN QUERY SELECT 'EXPIRED_SESSION'::TEXT, NULL::INT, NULL::TEXT, NULL::TEXT;
      RETURN;
    END IF;

    IF v_session.token_hash <> p_token_hash THEN
      RETURN QUERY SELECT 'INVALID_TOKEN'::TEXT, NULL::INT, NULL::TEXT, NULL::TEXT;
      RETURN;
    END IF;

    IF v_session.finalized THEN
      SELECT a.id, a.ref, a.receipt_status
      INTO v_existing_app
      FROM applications a
      WHERE a.session_id = p_session_id;

      IF FOUND THEN
        RETURN QUERY SELECT 'ALREADY_FINALIZED'::TEXT, v_existing_app.id, v_existing_app.ref, v_existing_app.receipt_status;
        RETURN;
      END IF;
    END IF;

    SELECT COUNT(*)::INT
    INTO v_verified_count
    FROM application_uploads
    WHERE session_id = p_session_id
      AND pathname = ANY(p_pathnames)
      AND status = 'uploaded';

    IF (COALESCE(array_length(p_pathnames, 1), 0) = 0 AND v_session.photo_count <> 0)
       OR v_verified_count <> COALESCE(array_length(p_pathnames, 1), 0) THEN
      RETURN QUERY SELECT 'UPLOAD_MISSING'::TEXT, NULL::INT, NULL::TEXT, NULL::TEXT;
      RETURN;
    END IF;

    INSERT INTO applications (
      ref, session_id, name, email, phone, city, age, experience,
      portfolio, social, consent, status, receipt_status,
      created_at, updated_at
    ) VALUES (
      p_ref, p_session_id, p_name, p_email, p_phone, p_city, p_age, p_experience,
      p_portfolio, p_social, p_consent, 'new', 'pending',
      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )
    RETURNING id INTO v_app_id;

    INSERT INTO application_photos (application_id, pathname, mime_type, size_bytes)
    SELECT v_app_id, u.pathname, u.mime_type, u.size_bytes
    FROM application_uploads u
    WHERE u.session_id = p_session_id
      AND u.pathname = ANY(p_pathnames);

    UPDATE application_sessions
    SET finalized = TRUE
    WHERE id = p_session_id;

    RETURN QUERY SELECT 'OK'::TEXT, v_app_id, p_ref, 'pending'::TEXT;
    RETURN;
  END;
  $$ LANGUAGE plpgsql;`
];

const ALL_STATEMENTS = [...TABLE_STATEMENTS, ...FUNCTION_STATEMENTS];

async function initSchema(sql) {
  for (const stmt of ALL_STATEMENTS) {
    await sql.query(stmt);
  }
}

module.exports = {
  TABLE_STATEMENTS,
  FUNCTION_STATEMENTS,
  ALL_STATEMENTS,
  initSchema,
};
