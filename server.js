require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-2024';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const PAYPAL_MODE = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
const PAYPAL_BASE = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database('trademind.db', (err) => {
  if (err) console.error('DB Error:', err);
  else console.log('✓ Database connected');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    tier TEXT DEFAULT 'free',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS demo_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    balance REAL DEFAULT 10000,
    equity REAL DEFAULT 10000,
    used_margin REAL DEFAULT 0,
    free_margin REAL DEFAULT 10000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS demo_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bot_id INTEGER,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    lot_size REAL NOT NULL,
    entry_price REAL NOT NULL,
    current_price REAL NOT NULL,
    pnl REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS demo_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bot_id INTEGER,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL,
    lot_size REAL NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    pnl REAL DEFAULT 0,
    status TEXT DEFAULT 'closed',
    opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    bot_type TEXT DEFAULT 'demo',
    status TEXT DEFAULT 'active',
    bot_profit REAL DEFAULT 0,
    trade_count INTEGER DEFAULT 0,
    take_profit REAL DEFAULT 2,
    stop_loss REAL DEFAULT 1,
    last_signal TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS brokers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    api_key TEXT,
    account_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    method TEXT,
    status TEXT DEFAULT 'pending',
    tier TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

const MOCK_PRICES = {
  EURUSD: 1.0850, GBPUSD: 1.2750, USDJPY: 149.50, AUDUSD: 0.6750, NZDUSD: 0.6250, USDCAD: 1.3650,
  BTCUSD: 65000, ETHUSD: 3500, XRPUSD: 2.50, ADAUSD: 0.98, DOGEUSD: 0.45,
  XAUUSD: 2550, XAGUUSD: 31.50, WTIUSD: 78.50, NGAS: 3.25, CORN: 410.50
};

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

app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.json({ error: 'All fields required' });

  const hash = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, hash], function(err) {
    if (err) return res.json({ error: 'User already exists' });
    db.run('INSERT INTO demo_accounts (user_id) VALUES (?)', [this.lastID]);
    const token = jwt.sign({ id: this.lastID, username, tier: 'free' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: this.lastID, username, email, tier: 'free' } });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'Username and password required' });

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (!user) return res.json({ error: 'User not found' });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user.id, username: user.username, tier: user.tier }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, tier: user.tier } });
  });
});

app.get('/api/user/profile', authenticate, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    res.json({ id: user.id, username: user.username, email: user.email, tier: user.tier });
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
    xm: { name: 'XM', guide: '1. Create XM account\n2. Enable API\n3. Copy API Key\n4. Paste here', docs: 'https://xm.com/docs' },
    exness: { name: 'Exness', guide: '1. Create Exness account\n2. Go to Settings > API\n3. Generate key\n4. Paste here', docs: 'https://exness.com/docs' },
    doto: { name: 'Doto', guide: '1. Create Doto account\n2. Dashboard > Integrations\n3. Copy API Key\n4. Paste here', docs: 'https://doto.com/docs' },
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
  db.all('SELECT * FROM demo_positions WHERE user_id = ? AND status = "open"', [req.user.id], (err, positions) => {
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
  const price = PRICES[symbol] || MOCK_PRICES[symbol] || 1;
  db.run('INSERT INTO demo_positions (user_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, "open")',
    [req.user.id, symbol, type, lot_size, price, price],
    function() {
      res.json({ success: true, entry_price: price, position_id: this.lastID });
    }
  );
});

app.post('/api/demo/close-position/:id', authenticate, (req, res) => {
  db.get('SELECT * FROM demo_positions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, pos) => {
    if (!pos) return res.json({ error: 'Position not found' });
    const exitPrice = PRICES[pos.symbol] || MOCK_PRICES[pos.symbol] || pos.current_price;
    const pnl = (exitPrice - pos.entry_price) * pos.lot_size * (pos.type === 'BUY' ? 1 : -1);
    db.run('INSERT INTO demo_trades (user_id, symbol, type, lot_size, entry_price, exit_price, pnl, status) VALUES (?, ?, ?, ?, ?, ?, ?, "closed")',
      [pos.user_id, pos.symbol, pos.type, pos.lot_size, pos.entry_price, exitPrice, pnl]
    );
    db.run('DELETE FROM demo_positions WHERE id = ?', [req.params.id]);
    res.json({ success: true, exit_price: exitPrice, pnl });
  });
});

app.get('/api/bots', authenticate, (req, res) => {
  db.all('SELECT * FROM bots WHERE user_id = ?', [req.user.id], (err, bots) => {
    res.json(bots || []);
  });
});

app.get('/api/bots/:id/stats', authenticate, (req, res) => {
  db.get('SELECT bot_profit, trade_count FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.json({ bot_profit: 0, trade_count: 0, current_pnl: 0 });
    db.get('SELECT COALESCE(SUM(pnl), 0) as current_pnl FROM demo_positions WHERE bot_id = ? AND status = "open"', [req.params.id], (err, pnl) => {
      res.json({ bot_profit: bot.bot_profit, trade_count: bot.trade_count, current_pnl: pnl?.current_pnl || 0 });
    });
  });
});

app.post('/api/bots', authenticate, (req, res) => {
  const { name, strategy, bot_type } = req.body;
  db.run('INSERT INTO bots (user_id, name, strategy, bot_type) VALUES (?, ?, ?, ?)',
    [req.user.id, name, strategy, bot_type],
    function() {
      res.json({ id: this.lastID, name, strategy, bot_type, status: 'active' });
    }
  );
});

app.put('/api/bots/:id/status', authenticate, (req, res) => {
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
  db.all('SELECT * FROM brokers WHERE user_id = ?', [req.user.id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post('/api/brokers', authenticate, (req, res) => {
  const { name, api_key, account_type } = req.body;
  db.run('INSERT INTO brokers (user_id, name, api_key, account_type) VALUES (?, ?, ?, ?)',
    [req.user.id, name, api_key, account_type],
    function() {
      res.json({ id: this.lastID, name, api_key, account_type });
    }
  );
});

// ============ PAYPAL (real Orders v2 flow) ============
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
  const prices = { starter: '29.00', premium: '99.00', unlimited: '199.00' };
  if (!prices[tier]) return res.status(400).json({ error: 'Invalid tier' });

  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const orderRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: 'USD', value: prices[tier] },
          description: `TradeMind Pro - ${tier} plan`
        }],
        application_context: {
          return_url: `${baseUrl}/?paypal_return=1&tier=${tier}`,
          cancel_url: `${baseUrl}/?paypal_cancel=1`,
          user_action: 'PAY_NOW'
        }
      },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    const approveLink = orderRes.data.links.find(l => l.rel === 'approve');
    res.json({ order_id: orderRes.data.id, approve_url: approveLink ? approveLink.href : null, tier, amount: prices[tier] });
  } catch (e) {
    console.error('PayPal create-order error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Failed to create PayPal order' });
  }
});

app.post('/api/payments/paypal/capture-order', authenticate, async (req, res) => {
  const { order_id, tier } = req.body;
  const prices = { starter: 29, premium: 99, unlimited: 199 };
  if (!order_id || !prices[tier]) return res.status(400).json({ error: 'Missing order_id or invalid tier' });

  try {
    const accessToken = await getPayPalAccessToken();
    const captureRes = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${order_id}/capture`,
      {},
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    if (captureRes.data.status !== 'COMPLETED') {
      return res.status(400).json({ error: `Payment not completed (status: ${captureRes.data.status})` });
    }

    db.run('UPDATE users SET tier = ? WHERE id = ?', [tier, req.user.id]);
    db.run(
      'INSERT INTO payments (user_id, amount, currency, method, status, tier) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, prices[tier], 'USD', 'paypal', 'completed', tier]
    );

    res.json({ success: true, tier });
  } catch (e) {
    console.error('PayPal capture-order error:', e.response?.data || e.message);
    res.status(500).json({ error: 'Failed to capture PayPal order' });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

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

function runBotAutomation() {
  db.all('SELECT * FROM bots WHERE status = "active" AND bot_type = "demo"', [], (err, bots) => {
    if (err || !bots) return;

    bots.forEach((bot) => {
      const symbols = Object.keys(PRICES);
      const symbol = symbols[bot.id % symbols.length];
      const currentPrice = PRICES[symbol];
      const prevPrice = botLastPrice[bot.id];
      botLastPrice[bot.id] = currentPrice;

      db.get('SELECT * FROM demo_positions WHERE bot_id = ? AND status = "open"', [bot.id], (err, openPos) => {
        if (openPos) {
          const pnl = (currentPrice - openPos.entry_price) * openPos.lot_size * (openPos.type === 'BUY' ? 1 : -1);
          const pnlPct = ((currentPrice - openPos.entry_price) / openPos.entry_price) * (openPos.type === 'BUY' ? 1 : -1) * 100;

          if (pnlPct >= bot.take_profit || pnlPct <= -bot.stop_loss) {
            db.run(
              'INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, status, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "closed", CURRENT_TIMESTAMP)',
              [openPos.user_id, bot.id, openPos.symbol, openPos.type, openPos.lot_size, openPos.entry_price, currentPrice, pnl]
            );
            db.run('DELETE FROM demo_positions WHERE id = ?', [openPos.id]);
            db.run(
              'UPDATE bots SET bot_profit = bot_profit + ?, trade_count = trade_count + 1, last_signal = ? WHERE id = ?',
              [pnl, `CLOSED ${openPos.type} @ ${currentPrice.toFixed(4)}`, bot.id]
            );
          } else {
            db.run('UPDATE demo_positions SET current_price = ?, pnl = ? WHERE id = ?', [currentPrice, pnl, openPos.id]);
          }
          return;
        }

        const signal = generateSignal(bot.strategy, prevPrice, currentPrice);
        if (!signal) return;

        db.run(
          'INSERT INTO demo_positions (user_id, bot_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, "open")',
          [bot.user_id, bot.id, symbol, signal, 0.1, currentPrice, currentPrice],
          function() {
            db.run('UPDATE bots SET last_signal = ? WHERE id = ?', [`OPENED ${signal} @ ${currentPrice.toFixed(4)}`, bot.id]);
          }
        );
      });
    });
  });
}

cron.schedule('*/1 * * * *', () => {
  console.log('⚙️  Running bot automation cycle...');
  runBotAutomation();
});

app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
