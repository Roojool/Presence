require('./env.cjs');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createPgLiteSql } = require('./pglite_db.cjs');

describe('Neon HTTP Driver Contract Regression', () => {
  test('sql.query and tagged template return results when awaited', async () => {
    const sql = await createPgLiteSql();
    const rows1 = await sql.query('SELECT 42 as val');
    assert.deepEqual(rows1, [{ val: 42 }]);

    const val = 100;
    const rows2 = await sql`SELECT ${val}::int as val`;
    assert.deepEqual(rows2, [{ val: 100 }]);
  });

  test('sql.transaction accepts an array of query descriptors', async () => {
    const sql = await createPgLiteSql();
    const results = await sql.transaction([
      sql.query('SELECT 1 as num'),
      sql`SELECT 2 as num`,
    ]);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], [{ num: 1 }]);
    assert.deepEqual(results[1], [{ num: 2 }]);
  });

  test('sql.transaction accepts synchronous callback returning an array', async () => {
    const sql = await createPgLiteSql();
    const results = await sql.transaction(tx => [
      tx.query('SELECT 10 as num'),
      tx`SELECT 20 as num`,
    ]);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], [{ num: 10 }]);
    assert.deepEqual(results[1], [{ num: 20 }]);
  });

  test('sql.transaction REJECTS async callback with official Neon HTTP driver error', async () => {
    const sql = await createPgLiteSql();
    let caught = null;
    try {
      await sql.transaction(async (tx) => {
        return [tx.query('SELECT 99')];
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught, 'Expected sql.transaction to reject async callback');
    assert.match(
      caught.message,
      /transaction\(\) expects an array of queries, or a function returning an array of queries/i
    );
  });
});
