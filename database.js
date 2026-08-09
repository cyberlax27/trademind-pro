const { Pool, types } = require('pg');

types.setTypeParser(20, value => Number(value));
types.setTypeParser(1700, value => Number(value));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Connect a persistent PostgreSQL database before starting TradeMind Pro.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

function parameterize(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function execute(client, sql, params = [], returnId = false) {
  let text = parameterize(sql);
  if (returnId && /^\s*INSERT\s+/i.test(text) && !/\sRETURNING\s+/i.test(text)) text += ' RETURNING id';
  return client.query(text, params);
}

function adapter(client) {
  return {
    run(sql, params = [], callback) {
      if (typeof params === 'function') { callback = params; params = []; }
      const promise = execute(client, sql, params, true).then(result => ({
        lastID: result.rows[0]?.id,
        changes: result.rowCount
      }));
      if (callback) promise.then(meta => callback.call(meta, null)).catch(error => callback.call({}, error));
      return promise;
    },
    get(sql, params = [], callback) {
      if (typeof params === 'function') { callback = params; params = []; }
      const promise = execute(client, sql, params).then(result => result.rows[0]);
      if (callback) promise.then(row => callback(null, row)).catch(error => callback(error));
      return promise;
    },
    all(sql, params = [], callback) {
      if (typeof params === 'function') { callback = params; params = []; }
      const promise = execute(client, sql, params).then(result => result.rows);
      if (callback) promise.then(rows => callback(null, rows)).catch(error => callback(error));
      return promise;
    }
  };
}

const db = adapter(pool);

db.transaction = async work => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(adapter(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','starter','premium','max')),
      tier_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS demo_accounts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance NUMERIC NOT NULL DEFAULT 10000,
      equity NUMERIC NOT NULL DEFAULT 10000,
      used_margin NUMERIC NOT NULL DEFAULT 0,
      free_margin NUMERIC NOT NULL DEFAULT 10000,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bots (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      strategy TEXT NOT NULL,
      bot_type TEXT NOT NULL DEFAULT 'demo' CHECK (bot_type = 'demo'),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
      bot_profit NUMERIC NOT NULL DEFAULT 0,
      trade_count INTEGER NOT NULL DEFAULT 0,
      take_profit NUMERIC NOT NULL DEFAULT 0.25,
      stop_loss NUMERIC NOT NULL DEFAULT 0.15,
      last_signal TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS demo_positions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id BIGINT REFERENCES bots(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUY','SELL')),
      lot_size NUMERIC NOT NULL CHECK (lot_size > 0),
      entry_price NUMERIC NOT NULL,
      current_price NUMERIC NOT NULL,
      pnl NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status = 'open'),
      opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_position_per_bot ON demo_positions(bot_id) WHERE bot_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS demo_trades (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      bot_id BIGINT REFERENCES bots(id) ON DELETE SET NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUY','SELL')),
      lot_size NUMERIC NOT NULL,
      entry_price NUMERIC NOT NULL,
      exit_price NUMERIC NOT NULL,
      pnl NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'closed' CHECK (status = 'closed'),
      opened_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
      tier TEXT NOT NULL CHECK (tier IN ('starter','premium','max')),
      provider_id TEXT,
      provider_event_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS support_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_id_unique ON payments(method, provider_id) WHERE provider_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS payments_event_id_unique ON payments(provider_event_id) WHERE provider_event_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS bots_user_id_idx ON bots(user_id);
    CREATE INDEX IF NOT EXISTS demo_trades_user_id_idx ON demo_trades(user_id, closed_at DESC);
    CREATE INDEX IF NOT EXISTS support_requests_status_idx ON support_requests(status, created_at DESC);
  `);
  await pool.query('SELECT 1');
  console.log('✓ PostgreSQL database connected and schema ready');
}

module.exports = { db, initDatabase, pool };
