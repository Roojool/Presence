/**
 * Staged uploads cleanup routine:
 * - Identifies expired unfinalized application sessions (>24 hours).
 * - Identifies unfinalized uploads associated with expired sessions (bounded work: max 50).
 * - Safely deletes objects from R2 storage.
 * - Deletes tracking rows ONLY after successful storage delete (preserving failed rows for retry).
 * - NEVER deletes finalized applications or photos.
 * - Cleans up expired sessions, admin sessions, and stale rate limits.
 */
async function cleanupAbandonedUploads({ sql, storage, maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const cutoff = now - maxAgeMs;

  const results = {
    deletedUploads: 0,
    failedDeletes: 0,
    deletedSessions: 0,
    deletedAdminSessions: 0,
    deletedRateLimits: 0,
    errors: [],
  };

  try {
    // 1. Atomically claim expired unfinalized sessions by setting expires_at = 0.
    // Sessions expire after 24h (expires_at <= now or created_at <= cutoff).
    // Under this update, any concurrent finalize_application call will immediately observe
    // expires_at = 0 (< now) and reject with EXPIRED_SESSION, preventing finalization races.
    // Finalized sessions (finalized = true) are never touched.
    try {
      await sql.query(`
        UPDATE application_sessions
        SET expires_at = 0
        WHERE finalized = false
          AND (expires_at <= $1 OR created_at <= $2)
      `, [now, cutoff]);
    } catch (err) {
      results.errors.push('Claim expired sessions: ' + err.message);
    }

    // 2. Find unfinalized uploads belonging to claimed unfinalized sessions
    // Bounded to 20 items to strictly respect Cloudflare Workers Free 50 subrequest limit
    // (20 R2 deletes + 20 DB deletes + ~5 setup queries <= 50 subrequests)
    let unfinalizedRows = [];
    try {
      unfinalizedRows = await sql.query(`
        SELECT u.id, u.pathname, u.session_id
        FROM application_uploads u
        JOIN application_sessions s ON s.id = u.session_id
        WHERE s.finalized = false
          AND s.expires_at = 0
          AND NOT EXISTS (
            SELECT 1 FROM application_photos ap WHERE ap.pathname = u.pathname
          )
        ORDER BY u.created_at ASC
        LIMIT 20
      `);
    } catch (err) {
      results.errors.push('Query unfinalized: ' + err.message);
    }

    if (Array.isArray(unfinalizedRows) && unfinalizedRows.length > 0) {
      for (const row of unfinalizedRows) {
        let storageSuccess = false;
        if (storage && storage.enabled && row.pathname) {
          try {
            await storage.delete(row.pathname);
            storageSuccess = true;
          } catch (delErr) {
            results.failedDeletes++;
            results.errors.push(`Storage delete failed for ${row.pathname}: ${delErr.message}`);
          }
        } else {
          // If storage is disabled, do not delete tracking row to avoid permanent orphan
          results.failedDeletes++;
          results.errors.push(`Storage unavailable for ${row.pathname}`);
        }

        // Delete tracking row ONLY if storage deletion succeeded
        if (storageSuccess) {
          try {
            await sql.query(`DELETE FROM application_uploads WHERE id = $1`, [row.id]);
            results.deletedUploads++;
          } catch (dbErr) {
            results.errors.push(`DB delete upload failed for ${row.id}: ${dbErr.message}`);
          }
        }
      }
    }

    // 3. Delete claimed sessions where finalized = false, expires_at = 0,
    // and no uploads or applications still reference the session
    try {
      const deleted = await sql.query(`
        DELETE FROM application_sessions s
        WHERE s.finalized = false
          AND s.expires_at = 0
          AND NOT EXISTS (SELECT 1 FROM application_uploads u WHERE u.session_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.session_id = s.id)
        RETURNING id
      `);
      results.deletedSessions = Array.isArray(deleted) ? deleted.length : 0;
    } catch (err) {
      results.errors.push('Delete sessions: ' + err.message);
    }

    // 3. Delete expired admin sessions
    try {
      const deletedAdmin = await sql.query(`
        DELETE FROM admin_sessions WHERE expires_at < $1 RETURNING token_hash
      `, [now]);
      results.deletedAdminSessions = Array.isArray(deletedAdmin) ? deletedAdmin.length : 0;
    } catch (err) {
      results.errors.push('Delete admin sessions: ' + err.message);
    }

    // 4. Delete stale rate limits (> 24h)
    try {
      await sql.query(`
        DELETE FROM rate_limits WHERE updated_at < $1
      `, [now - 86400000]);
      results.deletedRateLimits++;
    } catch (err) {
      results.errors.push('Delete rate limits: ' + err.message);
    }

  } catch (globalErr) {
    results.errors.push('Cleanup global: ' + globalErr.message);
  }

  return results;
}

module.exports = {
  cleanupAbandonedUploads,
};
