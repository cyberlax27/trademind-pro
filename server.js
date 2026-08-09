require('dotenv').config();
const express = require('express');
const { db, initDatabase } = require('./database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required. Set it in Render; never commit it.');
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
const PAYPAL_BASE = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
const PAYMONGO_MODE = process.env.PAYMONGO_MODE === 'live' ? 'live' : 'test';
const PAYMONGO_ENABLED = process.env.PAYMONGO_ENABLED === 'true';
const PAYMONGO_BASE = 'https://api.paymongo.com/v2';

const PLANS = Object.freeze({
  starter: { paypal: { amount: '9.00', currency: 'USD' }, paymongo: { amount: 55000, currency: 'PHP' } },
  premium: { paypal: { amount: '19.00', currency: 'USD' }, paymongo: { amount: 110000, currency: 'PHP' } },
  max: { paypal: { amount: '29.00', currency: 'USD' }, paymongo: { amount: 170000, currency: 'PHP' } }
});

// Loud startup diagnostics: a wrong/missing PAYPAL_MODE on Render is the
// single most common cause of "PayPal payments always fail" — it fails
// silently otherwise (every request just 500s), so surface it at boot.
if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  console.warn('⚠️  PAYPAL_CLIENT_ID or PAYPAL_SECRET is not set — PayPal checkout will fail.');
} else if (process.env.PAYPAL_MODE !== 'live' && process.env.PAYPAL_MODE !== 'sandbox') {
  console.warn(`⚠️  PAYPAL_MODE env var is not explicitly set to "live" or "sandbox" — defaulting to SANDBOX (${PAYPAL_BASE}). If you have live credentials configured, set PAYPAL_MODE=live in Render's environment variables or every checkout will fail against the live keys.`);
} else {
  console.log(`✓ PayPal configured in ${PAYPAL_MODE.toUpperCase()} mode (${PAYPAL_BASE})`);
}

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({
  limit: '100kb',
  verify: (req, _res, buffer) => { req.rawBody = buffer; }
}));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const paymentLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter);
app.use('/api/payments', paymentLimiter);
app.get('/app.js', (_req, res) => res.sendFile(path.join(__dirname, 'app.js')));
app.get('/logo-clean.png', (_req, res) => res.sendFile(path.join(__dirname, 'logo-clean.png')));
app.get('/logo-community.png', (_req, res) => res.sendFile(path.join(__dirname, 'logo-community.png')));

const MOCK_PRICES = {
  EURUSD: 1.0850, GBPUSD: 1.2750, USDJPY: 149.50, AUDUSD: 0.6750, NZDUSD: 0.6250, USDCAD: 1.3650,
  BTCUSD: 65000, ETHUSD: 3500, XRPUSD: 2.50, ADAUSD: 0.98, DOGEUSD: 0.45,
  XAUUSD: 2550, XAGUUSD: 31.50, WTIUSD: 78.50, NGAS: 3.25, CORN: 410.50
};

const TIER_LIMITS = Object.freeze({
  free: { bots: 1 },
  starter: { bots: 3 },
  premium: { bots: 10 },
  max: { bots: 25 }
});

let PRICES = JSON.parse(JSON.stringify(MOCK_PRICES));

setInterval(() => {
  for (let symbol in PRICES) {
    const change = (Math.random() - 0.5) * PRICES[symbol] * 0.001;
    PRICES[symbol] = Math.max(PRICES[symbol] + change, PRICES[symbol] * 0.9);
  }
}, 5000);

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(username || '')) return res.status(400).json({ error: 'Username must be 3–30 letters, numbers, underscores, or hyphens' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || email.length > 254) return res.status(400).json({ error: 'Valid email required' });
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Password must be 10–128 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const userId = await db.transaction(async tx => {
      const created = await tx.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email.toLowerCase(), hash]);
      await tx.run('INSERT INTO demo_accounts (user_id) VALUES (?)', [created.lastID]);
      return created.lastID;
    });
    const token = jwt.sign({ id: userId, username, tier: 'free' }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: userId, username, email: email.toLowerCase(), tier: 'free' } });
  } catch (error) {
    const duplicate = error.code === '23505';
    res.status(duplicate ? 409 : 500).json({ error: duplicate ? 'Username or email already exists' : 'Could not create account' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username], (err, user) => {
    if (!user) return res.json({ error: 'User not found' });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user.id, username: user.username, tier: user.tier }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, tier: user.tier } });
  });
});

app.get('/api/user/profile', authenticate, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    const expired = user.tier_expires_at && new Date(user.tier_expires_at) <= new Date();
    res.json({ id: user.id, username: user.username, email: user.email, tier: expired ? 'free' : user.tier, tier_expires_at: expired ? null : user.tier_expires_at });
  });
});

app.put('/api/user/profile', authenticate, (req, res) => {
  const { email, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.run('UPDATE users SET email = ?, password = ? WHERE id = ?', [email, hash, req.user.id], () => res.json({ success: true }));
  } else {
    db.run('UPDATE users SET email = ? WHERE id = ?', [email, req.user.id], () => res.json({ success: true }));
  }
});

app.delete('/api/user/account', authenticate, (req, res) => {
  db.run('DELETE FROM users WHERE id = ?', [req.user.id], () => res.json({ success: true }));
});

app.get('/api/strategies', (req, res) => {
  res.json({
    moving_average: { name: 'Moving Average Crossover', desc: 'Best for beginners' },
    rsi: { name: 'RSI Momentum', desc: 'Detects overbought/oversold' },
    macd: { name: 'MACD Trend', desc: 'Combines momentum and trend' },
    bollinger: { name: 'Bollinger Bands', desc: 'Support/resistance levels' },
    fibonacci: { name: 'Fibonacci Retracement', desc: 'Level-based trading' }
  });
});

app.get('/api/assets', (req, res) => {
  res.json({
    forex: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'NZDUSD', 'USDCAD'],
    crypto: ['BTCUSD', 'ETHUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD'],
    commodities: ['XAUUSD', 'XAGUUSD', 'WTIUSD', 'NGAS', 'CORN']
  });
});

app.get('/api/brokers-list', (req, res) => {
  res.json({
    demo: { name: 'Demo Account', guide: 'No API key needed. Use our 10000 virtual account to practice trading.', docs: '#' }
  });
});

app.get('/api/market-price/:symbol', (req, res) => {
  const price = PRICES[req.params.symbol] || MOCK_PRICES[req.params.symbol] || 1;
  res.json({ symbol: req.params.symbol, price, change: (Math.random() - 0.5) * 2 });
});

app.get('/api/chart-data/:symbol', (req, res) => {
  const basePrice = MOCK_PRICES[req.params.symbol] || 1;
  const data = [];
  let time = Math.floor(Date.now() / 1000) - 50 * 3600;
  for (let i = 0; i < 50; i++) {
    const open = basePrice + (Math.random() - 0.5) * basePrice * 0.01;
    const close = open + (Math.random() - 0.5) * basePrice * 0.01;
    data.push({
      time,
      open: parseFloat(open.toFixed(4)),
      high: Math.max(open, close) + (Math.random() * basePrice * 0.005),
      low: Math.min(open, close) - (Math.random() * basePrice * 0.005),
      close: parseFloat(close.toFixed(4))
    });
    time += 3600;
  }
  res.json(data);
});

app.get('/api/demo/account', authenticate, (req, res) => {
  db.get('SELECT * FROM demo_accounts WHERE user_id = ?', [req.user.id], (err, account) => {
    res.json(account || { balance: 10000, equity: 10000, used_margin: 0, free_margin: 10000 });
  });
});

app.get('/api/demo/positions', authenticate, (req, res) => {
  db.all("SELECT * FROM demo_positions WHERE user_id = ? AND status = 'open'", [req.user.id], (err, positions) => {
    res.json(positions || []);
  });
});

app.get('/api/demo/pending', authenticate, (req, res) => {
  res.json([]);
});

app.get('/api/demo/closed', authenticate, (req, res) => {
  db.all('SELECT * FROM demo_trades WHERE user_id = ? ORDER BY closed_at DESC LIMIT 50', [req.user.id], (err, trades) => {
    res.json(trades || []);
  });
});

app.post('/api/demo/trade', authenticate, (req, res) => {
  const { symbol, type, lot_size } = req.body;
  const size = Number(lot_size);
  if (!Object.hasOwn(MOCK_PRICES, symbol) || !['BUY', 'SELL'].includes(type) || !Number.isFinite(size) || size < 0.01 || size > 100) {
    return res.status(400).json({ error: 'Valid symbol, side, and lot size (0.01–100) required' });
  }
  const price = PRICES[symbol];
  db.run("INSERT INTO demo_positions (user_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, 'open')",
    [req.user.id, symbol, type, lot_size, price, price],
    function() {
      res.json({ success: true, entry_price: price, position_id: this.lastID });
    }
  );
});

app.post('/api/demo/close-position/:id', authenticate, async (req, res) => {
  try {
    const result = await db.transaction(async tx => {
      const pos = await tx.get('SELECT * FROM demo_positions WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
      if (!pos) return null;
    const exitPrice = PRICES[pos.symbol] || MOCK_PRICES[pos.symbol] || pos.current_price;
    const pnl = (exitPrice - pos.entry_price) * pos.lot_size * (pos.type === 'BUY' ? 1 : -1);
      await tx.run("INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, status, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?)",
        [pos.user_id, pos.bot_id, pos.symbol, pos.type, pos.lot_size, pos.entry_price, exitPrice, pnl, pos.opened_at]);
      await tx.run('DELETE FROM demo_positions WHERE id = ?', [pos.id]);
      return { success: true, exit_price: exitPrice, pnl };
    });
    if (!result) return res.status(404).json({ error: 'Position not found' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Could not close position' });
  }
});

app.get('/api/bots', authenticate, (req, res) => {
  db.all('SELECT * FROM bots WHERE user_id = ?', [req.user.id], (err, bots) => {
    res.json(bots || []);
  });
});

app.get('/api/bots/:id/stats', authenticate, (req, res) => {
  db.get('SELECT bot_profit, trade_count FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.json({ bot_profit: 0, trade_count: 0, current_pnl: 0 });
    db.get("SELECT COALESCE(SUM(pnl), 0) as current_pnl FROM demo_positions WHERE bot_id = ? AND status = 'open'", [req.params.id], (err, pnl) => {
      res.json({ bot_profit: bot.bot_profit, trade_count: bot.trade_count, current_pnl: pnl?.current_pnl || 0 });
    });
  });
});

app.get('/api/bots/:id/activity', authenticate, async (req, res) => {
  try {
    const bot = await dbGet(
      'SELECT id, name, strategy, bot_type, status, last_signal, created_at FROM bots WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!bot) return res.status(404).json({ error: 'Bot not found' });

    const openPositions = await dbAll(
      "SELECT id, symbol, type, lot_size, entry_price, current_price, pnl, opened_at FROM demo_positions WHERE bot_id = ? AND user_id = ? AND status = 'open' ORDER BY opened_at DESC",
      [bot.id, req.user.id]
    );
    const closedTrades = await dbAll(
      'SELECT id, symbol, type, lot_size, entry_price, exit_price, pnl, opened_at, closed_at FROM demo_trades WHERE bot_id = ? AND user_id = ? ORDER BY closed_at DESC LIMIT 100',
      [bot.id, req.user.id]
    );

    res.json({ bot, open_positions: openPositions, closed_trades: closedTrades });
  } catch (error) {
    console.error('Bot activity error:', error.message);
    res.status(500).json({ error: 'Could not load bot activity' });
  }
});

app.post('/api/bots', authenticate, (req, res) => {
  const { name, strategy } = req.body;
  if (!name || typeof name !== 'string' || name.length > 80) return res.status(400).json({ error: 'Valid bot name required' });
  if (!['moving_average', 'rsi', 'macd', 'bollinger', 'fibonacci'].includes(strategy)) return res.status(400).json({ error: 'Valid strategy required' });
  db.get("SELECT CASE WHEN tier_expires_at IS NOT NULL AND tier_expires_at <= CURRENT_TIMESTAMP THEN 'free' ELSE tier END AS tier FROM users WHERE id = ?", [req.user.id], (userErr, user) => {
    if (userErr || !user) return res.status(404).json({ error: 'User not found' });
    db.get('SELECT COUNT(*) AS count FROM bots WHERE user_id = ?', [req.user.id], (countErr, row) => {
      if (countErr) return res.status(500).json({ error: 'Could not verify plan limit' });
      const limit = (TIER_LIMITS[user.tier] || TIER_LIMITS.free).bots;
      if (row.count >= limit) return res.status(403).json({ error: `Your ${user.tier} plan allows ${limit} trading bot${limit === 1 ? '' : 's'}` });
      db.run("INSERT INTO bots (user_id, name, strategy, bot_type) VALUES (?, ?, ?, 'demo')", [req.user.id, name.trim(), strategy], function(err) {
        if (err) return res.status(500).json({ error: 'Could not create bot' });
        res.json({ id: this.lastID, name: name.trim(), strategy, bot_type: 'demo', status: 'active' });
      });
    });
  });
});

app.put('/api/bots/:id/status', authenticate, (req, res) => {
  if (!['active', 'inactive'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid bot status' });
  db.run('UPDATE bots SET status = ? WHERE id = ? AND user_id = ?', [req.body.status, req.params.id, req.user.id], () => {
    res.json({ success: true });
  });
});

app.delete('/api/bots/:id', authenticate, (req, res) => {
  db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], () => {
    res.json({ success: true });
  });
});

app.get('/api/brokers', authenticate, (req, res) => {
  res.json([]);
});

app.post('/api/brokers', authenticate, (req, res) => {
  res.status(410).json({ error: 'Broker connections are unavailable while TradeMind Pro is in paper-trading beta.' });
});

app.post('/api/support', authenticate, async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 10 || message.length > 2000) return res.status(400).json({ error: 'Message must be 10–2,000 characters' });
  try {
    const request = await dbRun('INSERT INTO support_requests (user_id, message) VALUES (?, ?)', [req.user.id, message]);
    res.status(201).json({ success: true, request_id: request.lastID });
  } catch (error) {
    res.status(500).json({ error: 'Could not save support request' });
  }
});

// ============ VERIFIED PAYMENTS ============
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || [])));
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this); }));

function paymentError(error, fallback) {
  const detail = error.response?.data?.errors?.[0]?.detail || error.response?.data?.message;
  console.error(fallback, error.response?.data || error.message);
  return detail || fallback;
}

async function fulfillPayment(payment, providerEventId = null) {
  if (payment.status === 'completed') return payment;
  return db.transaction(async tx => {
    const current = await tx.get('SELECT * FROM payments WHERE id = ? FOR UPDATE', [payment.id]);
    if (current.status !== 'completed') {
      await tx.run("UPDATE payments SET status = 'completed', provider_event_id = COALESCE(provider_event_id, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [providerEventId, payment.id]);
      await tx.run("UPDATE users SET tier = ?, tier_expires_at = GREATEST(COALESCE(tier_expires_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP) + INTERVAL '30 days' WHERE id = ?", [current.tier, current.user_id]);
    }
    return { ...current, status: 'completed' };
  });
}

function paypalCapture(order) {
  return order.purchase_units?.flatMap(unit => unit.payments?.captures || []).find(capture => capture.status === 'COMPLETED');
}

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

app.post('/api/payments/paypal/create-order', authenticate, async (req, res) => {
  const { tier } = req.body;
  const plan = PLANS[tier]?.paypal;
  if (!plan) return res.status(400).json({ error: 'Invalid tier' });
  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.status(503).json({ error: 'PayPal is not configured' });

  try {
    const pending = await dbRun(
      'INSERT INTO payments (user_id, amount, currency, method, status, tier) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, Number(plan.amount), plan.currency, 'paypal', 'pending', tier]
    );
    const accessToken = await getPayPalAccessToken();
    const orderRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: plan.currency, value: plan.amount },
          description: `TradeMind Pro - ${tier} plan`,
          custom_id: String(pending.lastID),
          invoice_id: `TMP-${pending.lastID}`
        }],
        application_context: {
          return_url: `${APP_BASE_URL}/?paypal_return=1`,
          cancel_url: `${APP_BASE_URL}/?paypal_cancel=1`,
          user_action: 'PAY_NOW'
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `create-${pending.lastID}` } }
    );

    const approveLink = orderRes.data.links.find(l => l.rel === 'approve');
    await dbRun('UPDATE payments SET provider_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [orderRes.data.id, pending.lastID]);
    res.json({ order_id: orderRes.data.id, approve_url: approveLink?.href || null });
  } catch (e) {
    res.status(502).json({ error: paymentError(e, 'Failed to create PayPal order') });
  }
});

app.post('/api/payments/paypal/capture-order', authenticate, async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'Missing order_id' });

  try {
    const payment = await dbGet('SELECT * FROM payments WHERE method = ? AND provider_id = ? AND user_id = ?', ['paypal', order_id, req.user.id]);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'completed') return res.json({ success: true, tier: payment.tier });
    const accessToken = await getPayPalAccessToken();
    const captureRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${order_id}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `capture-${payment.id}` } }
    );
    const capture = paypalCapture(captureRes.data);
    if (!capture) return res.status(409).json({ error: 'PayPal capture is not completed' });
    if (capture.amount?.currency_code !== payment.currency || capture.amount?.value !== Number(payment.amount).toFixed(2)) {
      return res.status(409).json({ error: 'PayPal amount verification failed' });
    }
    if (captureRes.data.purchase_units?.[0]?.custom_id !== String(payment.id)) return res.status(409).json({ error: 'PayPal reference verification failed' });
    await fulfillPayment(payment, capture.id);
    res.json({ success: true, tier: payment.tier });
  } catch (e) {
    res.status(502).json({ error: paymentError(e, 'Failed to capture PayPal order') });
  }
});

app.post('/api/webhooks/paypal', async (req, res) => {
  if (!PAYPAL_WEBHOOK_ID || !PAYPAL_CLIENT_ID || !PAYPAL_SECRET) return res.sendStatus(503);
  try {
    const accessToken = await getPayPalAccessToken();
    const verification = await axios.post(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
      auth_algo: req.get('paypal-auth-algo'), cert_url: req.get('paypal-cert-url'), transmission_id: req.get('paypal-transmission-id'),
      transmission_sig: req.get('paypal-transmission-sig'), transmission_time: req.get('paypal-transmission-time'),
      webhook_id: PAYPAL_WEBHOOK_ID, webhook_event: req.body
    }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
    if (verification.data.verification_status !== 'SUCCESS') return res.sendStatus(400);
    if (req.body.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = req.body.resource?.supplementary_data?.related_ids?.order_id;
      const payment = orderId && await dbGet('SELECT * FROM payments WHERE method = ? AND provider_id = ?', ['paypal', orderId]);
      if (payment && req.body.resource.amount?.currency_code === payment.currency && req.body.resource.amount?.value === Number(payment.amount).toFixed(2)) {
        await fulfillPayment(payment, req.body.id);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('PayPal webhook error:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

function verifyPayMongoSignature(req) {
  if (!PAYMONGO_WEBHOOK_SECRET || !req.rawBody) return false;
  const parts = Object.fromEntries((req.get('paymongo-signature') || '').split(',').map(part => part.trim().split('=')));
  const signature = PAYMONGO_MODE === 'live' ? parts.li : parts.te;
  if (!parts.t || !signature || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = crypto.createHmac('sha256', PAYMONGO_WEBHOOK_SECRET).update(`${parts.t}.${req.rawBody.toString('utf8')}`).digest('hex');
  const a = Buffer.from(signature, 'hex'); const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.post('/api/payments/paymongo/create-checkout', authenticate, async (req, res) => {
  if (!PAYMONGO_ENABLED) return res.status(404).json({ error: 'PayMongo checkout is temporarily unavailable' });
  const { tier } = req.body;
  const plan = PLANS[tier]?.paymongo;
  if (!plan || !Number.isInteger(plan.amount) || plan.amount < 10000) return res.status(503).json({ error: 'PayMongo pricing is not configured' });
  if (!PAYMONGO_SECRET_KEY) return res.status(503).json({ error: 'PayMongo is not configured' });
  try {
    const pending = await dbRun('INSERT INTO payments (user_id, amount, currency, method, status, tier) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, plan.amount / 100, plan.currency, 'paymongo', 'pending', tier]);
    const checkout = await axios.post(`${PAYMONGO_BASE}/checkout_sessions`, { data: { attributes: {
      billing: { name: req.user.username },
      cancel_url: `${APP_BASE_URL}/?paymongo_cancel=1`, success_url: `${APP_BASE_URL}/?paymongo_return=1&payment=${pending.lastID}`,
      description: `TradeMind Pro - ${tier} plan`, line_items: [{ amount: plan.amount, currency: plan.currency, name: `${tier[0].toUpperCase() + tier.slice(1)} plan`, quantity: 1 }],
      payment_method_types: ['qrph'], reference_number: `TMP-${pending.lastID}`, send_email_receipt: true, show_line_items: true
    } } }, { auth: { username: PAYMONGO_SECRET_KEY, password: '' }, headers: { 'Content-Type': 'application/json' } });
    const session = checkout.data.data;
    await dbRun('UPDATE payments SET provider_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [session.id, pending.lastID]);
    res.json({ checkout_url: session.attributes.checkout_url, payment_id: pending.lastID });
  } catch (error) {
    console.error('PayMongo checkout error:', error.response?.status, error.response?.data || error.message);
    res.status(502).json({ error: paymentError(error, 'Failed to create PayMongo checkout') });
  }
});

app.post('/api/webhooks/paymongo', async (req, res) => {
  if (!PAYMONGO_ENABLED) return res.sendStatus(404);
  if (!verifyPayMongoSignature(req)) return res.sendStatus(400);
  try {
    const event = req.body.data;
    if (event?.attributes?.type === 'checkout_session.payment.paid') {
      const session = event.attributes.data;
      const payment = await dbGet('SELECT * FROM payments WHERE method = ? AND provider_id = ?', ['paymongo', session.id]);
      const attributes = session.attributes || {};
      const intent = attributes.payment_intent?.attributes || {};
      const paidAmount = intent.amount ?? attributes.line_items?.reduce((sum, item) => sum + item.amount * item.quantity, 0);
      const currency = String(intent.currency || attributes.line_items?.[0]?.currency || '').toUpperCase();
      const modeMatches = Boolean(event.attributes.livemode) === (PAYMONGO_MODE === 'live');
      if (payment && modeMatches && attributes.reference_number === `TMP-${payment.id}` && paidAmount === Math.round(payment.amount * 100) && currency === payment.currency) {
        await fulfillPayment(payment, event.id);
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error('PayMongo webhook error:', error.message);
    res.sendStatus(500);
  }
});

app.get('/api/payments/:id/status', authenticate, async (req, res) => {
  const payment = await dbGet('SELECT id, status, tier, method FROM payments WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

app.get('/api/health', async (_req, res) => {
  try {
    await dbGet('SELECT 1 AS healthy');
    res.json({
      status: 'ok',
      database: true,
      product_mode: 'paper-trading',
      payments: {
        paypal: Boolean(PAYPAL_CLIENT_ID && PAYPAL_SECRET && PAYPAL_WEBHOOK_ID),
        paymongo: PAYMONGO_ENABLED && Boolean(PAYMONGO_SECRET_KEY && PAYMONGO_WEBHOOK_SECRET)
      }
    });
  } catch (error) {
    res.status(503).json({ status: 'error', database: false });
  }
});

// ============ BOT AUTOMATION (demo bots only) ============
const botLastPrice = {};

function generateSignal(strategy, prevPrice, currentPrice) {
  if (prevPrice == null) return null;
  const pctChange = (currentPrice - prevPrice) / prevPrice;

  switch (strategy) {
    case 'moving_average':
      return pctChange > 0.0003 ? 'BUY' : pctChange < -0.0003 ? 'SELL' : null;
    case 'rsi':
      return pctChange > 0.0006 ? 'SELL' : pctChange < -0.0006 ? 'BUY' : null;
    case 'macd':
      return pctChange > 0.0004 ? 'BUY' : pctChange < -0.0004 ? 'SELL' : null;
    case 'bollinger':
      return Math.abs(pctChange) > 0.0008 ? (pctChange > 0 ? 'SELL' : 'BUY') : null;
    case 'fibonacci':
      return pctChange > 0.0005 ? 'BUY' : pctChange < -0.0005 ? 'SELL' : null;
    default:
      return pctChange > 0.0005 ? 'BUY' : pctChange < -0.0005 ? 'SELL' : null;
  }
}

let automationRunning = false;

async function runBotAutomation() {
  if (automationRunning) return;
  automationRunning = true;
  try {
    const bots = await db.all("SELECT * FROM bots WHERE status = 'active' AND bot_type = 'demo'");
    await Promise.all(bots.map(async bot => {
      const symbols = Object.keys(PRICES);
      const symbol = symbols[bot.id % symbols.length];
      const currentPrice = PRICES[symbol];
      const prevPrice = botLastPrice[bot.id];
      botLastPrice[bot.id] = currentPrice;

      await db.transaction(async tx => {
        const currentBot = await tx.get("SELECT * FROM bots WHERE id = ? AND status = 'active' FOR UPDATE", [bot.id]);
        if (!currentBot) return;
        const openPos = await tx.get("SELECT * FROM demo_positions WHERE bot_id = ? AND status = 'open' FOR UPDATE", [bot.id]);
        if (openPos) {
          const pnl = (currentPrice - openPos.entry_price) * openPos.lot_size * (openPos.type === 'BUY' ? 1 : -1);
          const pnlPct = ((currentPrice - openPos.entry_price) / openPos.entry_price) * (openPos.type === 'BUY' ? 1 : -1) * 100;

          if (pnlPct >= currentBot.take_profit || pnlPct <= -currentBot.stop_loss) {
            await tx.run(
              "INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, status, opened_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, CURRENT_TIMESTAMP)",
              [openPos.user_id, bot.id, openPos.symbol, openPos.type, openPos.lot_size, openPos.entry_price, currentPrice, pnl, openPos.opened_at]
            );
            await tx.run('DELETE FROM demo_positions WHERE id = ?', [openPos.id]);
            await tx.run(
              'UPDATE bots SET bot_profit = bot_profit + ?, trade_count = trade_count + 1, last_signal = ? WHERE id = ?',
              [pnl, `CLOSED ${openPos.type} @ ${currentPrice.toFixed(4)}`, bot.id]
            );
          } else {
            await tx.run('UPDATE demo_positions SET current_price = ?, pnl = ? WHERE id = ?', [currentPrice, pnl, openPos.id]);
          }
          return;
        }

        const signal = generateSignal(currentBot.strategy, prevPrice, currentPrice);
        if (!signal) return;

        await tx.run(
          "INSERT INTO demo_positions (user_id, bot_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
          [bot.user_id, bot.id, symbol, signal, 0.1, currentPrice, currentPrice]
        );
        await tx.run('UPDATE bots SET last_signal = ? WHERE id = ?', [`OPENED ${signal} @ ${currentPrice.toFixed(4)}`, bot.id]);
      });
    }));
  } catch (error) {
    console.error('Bot automation cycle failed:', error.message);
  } finally {
    automationRunning = false;
  }
}

cron.schedule('*/1 * * * *', async () => {
  console.log('⚙️  Running bot automation cycle...');
  await runBotAutomation();
});

cron.schedule('17 * * * *', () => {
  db.run("UPDATE users SET tier = 'free', tier_expires_at = NULL WHERE tier_expires_at IS NOT NULL AND tier_expires_at <= CURRENT_TIMESTAMP");
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
}

start().catch(error => {
  console.error('Fatal startup error:', error.message);
  process.exit(1);
});
