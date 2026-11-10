// Run once: node init-db.cjs --import-sqlite
const fs = require('node:fs');
const { neon } = require('@neondatabase/serverless');
const { ALL_STATEMENTS } = require('./lib/schema.cjs');

if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  await sql.transaction(ALL_STATEMENTS.map(query => sql.query(query)));

  if (process.argv.includes('--import-sqlite')) {
    const { DatabaseSync } = require('node:sqlite');
    const source = new DatabaseSync('data/presence.db', { readOnly: true });
    const queries = [];
    for (const table of ['bookings', 'waitlist', 'blocks']) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        queries.push(sql.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row)));
      }
      queries.push(sql.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`));
      console.log(`${table}: importing ${rows.length} rows`);
    }
    await sql.transaction(queries);
    source.close();
  }
  console.log('Neon database ready.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
