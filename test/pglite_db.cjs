// test/pglite_db.cjs — Faithful Neon HTTP driver emulator using in-memory PGlite
const { PGlite } = require('@electric-sql/pglite');
const { ALL_STATEMENTS } = require('../lib/schema.cjs');

class QueryDescriptor {
  constructor(db, queryText, params = []) {
    this._db = db;
    this.queryText = queryText;
    this.params = params;
    this._promise = null;
  }

  _exec(client) {
    const target = client || this._db;
    return target.query(this.queryText, this.params).then(res => res.rows);
  }

  then(onFulfilled, onRejected) {
    if (!this._promise) {
      this._promise = this._exec();
    }
    return this._promise.then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    if (!this._promise) {
      this._promise = this._exec();
    }
    return this._promise.catch(onRejected);
  }

  finally(onFinally) {
    if (!this._promise) {
      this._promise = this._exec();
    }
    return this._promise.finally(onFinally);
  }
}

async function createPgLiteSql() {
  const db = new PGlite();

  // Load shared schema (tables, indexes, functions)
  for (const stmt of ALL_STATEMENTS) {
    await db.query(stmt);
  }

  function createSql(client) {
    function sql(strings, ...values) {
      let queryText = '';
      const params = [];
      for (let i = 0; i < strings.length; i++) {
        queryText += strings[i];
        if (i < values.length) {
          params.push(values[i]);
          queryText += `$${params.length}`;
        }
      }
      return new QueryDescriptor(client, queryText, params);
    }

    sql.query = (queryText, params = []) => {
      return new QueryDescriptor(client, queryText, params);
    };

    sql.transaction = async (queriesOrFn) => {
      let queryList = queriesOrFn;

      if (typeof queriesOrFn === 'function') {
        const returned = queriesOrFn(sql);
        // Neon HTTP throws synchronously if function returns Promise or non-array
        if (returned && typeof returned.then === 'function') {
          throw new Error('transaction() expects an array of queries, or a function returning an array of queries');
        }
        if (!Array.isArray(returned)) {
          throw new Error('transaction() expects an array of queries, or a function returning an array of queries');
        }
        queryList = returned;
      }

      if (!Array.isArray(queryList)) {
        throw new Error('transaction() expects an array of queries, or a function returning an array of queries');
      }

      // Execute queries inside a true PGlite transaction
      const results = [];
      await client.transaction(async (tx) => {
        for (const q of queryList) {
          if (q instanceof QueryDescriptor) {
            const res = await q._exec(tx);
            results.push(res);
          } else if (typeof q === 'string') {
            const res = await tx.query(q);
            results.push(res.rows);
          } else {
            throw new Error('transaction() expects an array of queries, or a function returning an array of queries');
          }
        }
      });

      return results;
    };

    sql.raw = (str) => str;
    sql._db = client;
    return sql;
  }

  return createSql(db);
}

module.exports = {
  createPgLiteSql,
  QueryDescriptor,
};
