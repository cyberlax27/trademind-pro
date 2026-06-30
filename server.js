require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");

const app = express();
app.use(express.json());
app.use(express.static("."));

const db = new sqlite3.Database("trademind.db");
const JWT_SECRET = process.env.JWT_SECRET || "secret-key-2024";

db.serialize(() => {
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, tier TEXT DEFAULT 'free', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, strategy TEXT, bot_type TEXT DEFAULT 'demo', status TEXT DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS brokers (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, api_key TEXT, account_type TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, currency TEXT, method TEXT, status TEXT, tier TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_accounts (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, balance REAL DEFAULT 10000, equity REAL DEFAULT 10000, used_margin REAL DEFAULT 0, free_margin REAL DEFAULT 10000, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_positions (id INTEGER PRIMARY KEY, user_id INTEGER, bot_id INTEGER, symbol TEXT, type TEXT, lot_size REAL, entry_price REAL, current_price REAL, pnl REAL DEFAULT 0, status TEXT DEFAULT 'open', opened_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_trades (id INTEGER PRIMARY KEY, user_id INTEGER, bot_id INTEGER, symbol TEXT, type TEXT, lot_size REAL, entry_price REAL, exit_price REAL, pnl REAL, status TEXT DEFAULT 'closed', opened_at DATETIME, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
};

const STRATEGIES = {
  moving_average: { name: "Moving Average Crossover", desc: "Best for beginners - tracks price trends" },
  rsi: { name: "RSI Momentum", desc: "Detects overbought/oversold conditions" },
  macd: { name: "MACD Trend", desc: "Combines momentum and trend analysis" },
  bollinger: { name: "Bollinger Bands", desc: "Uses support/resistance levels" },
  fibonacci: { name: "Fibonacci Retracement", desc: "Level-based trading strategy" }
};

const BROKERS = {
  xm: { name: "XM (XEMarkets)", docs: "https://www.xm.com/", guide: "1. Go to xm.com → Register account\n2. Login to client cabinet\n3. Go to Settings → API Keys\n4. Generate new API key\n5. Copy key and paste here" },
  exness: { name: "Exness", docs: "https://www.exness.com/", guide: "1. Go to exness.com → Open account\n2. Login to personal area\n3. Go to Tools → API Settings\n4. Click 'Create API Token'\n5. Copy token and paste here" },
  doto: { name: "Doto Markets", docs: "https://www.dotomarkets.com/", guide: "1. Go to dotomarkets.com → Sign up\n2. Complete verification\n3. Go to Settings → Developer\n4. Generate API credentials\n5. Copy and paste here" },
  demo: { name: "Demo Account", docs: "#", guide: "Using built-in $10,000 virtual demo account. No API key needed!" }
};

const ASSETS = {
  forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD"],
  crypto: ["BTCUSD", "ETHUSD", "XRPUSD", "ADAUSD", "DOGEUSD"],
  commodities: ["XAUUSD", "XAGUUSD", "WTIUSD", "NGAS", "CORN"]
};

const ASSET_NAMES = {
  "EURUSD": "EUR/USD - Euro vs Dollar", "GBPUSD": "GBP/USD - British Pound vs Dollar", "USDJPY": "USD/JPY - Dollar vs Yen", 
  "AUDUSD": "AUD/USD - Australian Dollar vs Dollar", "NZDUSD": "NZD/USD - NZ Dollar vs Dollar", "USDCAD": "USD/CAD - Dollar vs Canadian Dollar",
  "BTCUSD": "BTC/USD - Bitcoin", "ETHUSD": "ETH/USD - Ethereum", "XRPUSD": "XRP/USD - Ripple", "ADAUSD": "ADA/USD - Cardano", "DOGEUSD": "DOGE/USD - Dogecoin",
  "XAUUSD": "XAU/USD - Gold", "XAGUUSD": "XAG/USD - Silver", "WTIUSD": "WTI/USD - Crude Oil", "NGAS": "NGAS/USD - Natural Gas", "CORN": "CORN/USD - Corn"
};

const MOCK_PRICES = {
  "EURUSD": 1.0850, "GBPUSD": 1.2750, "USDJPY": 149.50, "AUDUSD": 0.6750, "NZDUSD": 0.6250, "USDCAD": 1.3650,
  "BTCUSD": 65000, "ETHUSD": 3500, "XRPUSD": 2.50, "ADAUSD": 0.98, "DOGEUSD": 0.45,
  "XAUUSD": 2550, "XAGUUSD": 31.50, "WTIUSD": 78.50, "NGAS": 3.25, "CORN": 410.50
};

function generateChartData(symbol, periods = 50) {
  const basePrice = MOCK_PRICES[symbol] || 100;
  const data = [];
  const now = Math.floor(Date.now() / 1000);
  
  for (let i = periods - 1; i >= 0; i--) {
    const time = now - (i * 3600);
    const volatility = basePrice * 0.01;
    const open = basePrice + (Math.random() - 0.5) * volatility;
    const close = open + (Math.random() - 0.5) * volatility;
    const high = Math.max(open, close) + Math.random() * (volatility / 2);
    const low = Math.min(open, close) - Math.random() * (volatility / 2);
    
    data.push({ time, open: parseFloat(open.toFixed(5)), high: parseFloat(high.toFixed(5)), low: parseFloat(low.toFixed(5)), close: parseFloat(close.toFixed(5)) });
  }
  return data;
}

app.post("/api/auth/signup", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "Username, email, and password required" });
  
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hash], function(err) {
    if (err) return res.status(400).json({ error: "Username or email already exists" });
    const userId = this.lastID;
    db.run("INSERT INTO demo_accounts (user_id, balance, equity, free_margin) VALUES (?, ?, ?, ?)", [userId, 10000, 10000, 10000]);
    const token = jwt.sign({ user_id: userId, username }, JWT_SECRET);
    res.json({ token, user_id: userId });
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ user_id: user.id, username }, JWT_SECRET);
    res.json({ token, user_id: user.id, tier: user.tier });
  });
});

app.get("/api/user/profile", authMiddleware, (req, res) => {
  db.get("SELECT id, username, email, tier FROM users WHERE id = ?", [req.user.user_id], (err, user) => {
    res.json(user);
  });
});

app.put("/api/user/profile", authMiddleware, async (req, res) => {
  const { email, password } = req.body;
  const userId = req.user.user_id;
  
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    db.run("UPDATE users SET password = ? WHERE id = ?", [hash, userId]);
  }
  if (email) {
    db.run("UPDATE users SET email = ? WHERE id = ?", [email, userId]);
  }
  
  res.json({ success: true });
});

app.delete("/api/user/account", authMiddleware, (req, res) => {
  const userId = req.user.user_id;
  db.run("DELETE FROM users WHERE id = ?", [userId]);
  db.run("DELETE FROM demo_accounts WHERE user_id = ?", [userId]);
  db.run("DELETE FROM demo_positions WHERE user_id = ?", [userId]);
  db.run("DELETE FROM demo_trades WHERE user_id = ?", [userId]);
  db.run("DELETE FROM bots WHERE user_id = ?", [userId]);
  db.run("DELETE FROM brokers WHERE user_id = ?", [userId]);
  res.json({ success: true });
});

app.get("/api/strategies", (req, res) => res.json(STRATEGIES));
app.get("/api/brokers-list", (req, res) => res.json(BROKERS));
app.get("/api/assets", (req, res) => res.json(ASSETS));

app.get("/api/market-price/:symbol", (req, res) => {
  const symbol = req.params.symbol;
  const price = MOCK_PRICES[symbol] || 100;
  res.json({ symbol, price, change: (Math.random() - 0.5) * 2 });
});

app.get("/api/chart-data/:symbol", (req, res) => {
  const symbol = req.params.symbol;
  res.json(generateChartData(symbol));
});

app.get("/api/demo/account", authMiddleware, (req, res) => {
  db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [req.user.user_id], (err, account) => {
    if (!account) return res.status(404).json({ error: "Demo account not found" });
    res.json(account);
  });
});

app.get("/api/demo/positions", authMiddleware, (req, res) => {
  db.all("SELECT * FROM demo_positions WHERE user_id = ? AND status = ?", [req.user.user_id, "open"], (err, positions) => {
    const positionsWithPnL = (positions || []).map(p => {
      const currentPrice = MOCK_PRICES[p.symbol] || p.entry_price;
      let pnl = 0;
      if (p.type === "BUY") pnl = (currentPrice - p.entry_price) * p.lot_size;
      else pnl = (p.entry_price - currentPrice) * p.lot_size;
      return { ...p, current_price: currentPrice, pnl: parseFloat(pnl.toFixed(2)) };
    });
    res.json(positionsWithPnL);
  });
});

app.get("/api/demo/pending", authMiddleware, (req, res) => {
  db.all("SELECT * FROM demo_positions WHERE user_id = ? AND status = ?", [req.user.user_id, "pending"], (err, positions) => {
    res.json(positions || []);
  });
});

app.get("/api/demo/closed", authMiddleware, (req, res) => {
  db.all("SELECT * FROM demo_trades WHERE user_id = ? ORDER BY closed_at DESC", [req.user.user_id], (err, trades) => {
    res.json(trades || []);
  });
});

app.post("/api/demo/trade", authMiddleware, (req, res) => {
  const { symbol, type, lot_size, bot_id } = req.body;
  if (!["BUY", "SELL"].includes(type) || lot_size <= 0) return res.status(400).json({ error: "Invalid trade params" });
  
  const entry_price = MOCK_PRICES[symbol] || 100;
  
  db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [req.user.user_id], (err, account) => {
    if (!account) return res.status(400).json({ error: "Demo account not found" });
    
    const requiredMargin = entry_price * lot_size * 0.02;
    if (requiredMargin > account.free_margin) return res.status(400).json({ error: "Insufficient margin" });
    
    db.run("INSERT INTO demo_positions (user_id, bot_id, symbol, type, lot_size, entry_price, current_price) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.user.user_id, bot_id || null, symbol, type, lot_size, entry_price, entry_price], function(err) {
        const new_used = account.used_margin + requiredMargin;
        const new_free = account.balance - new_used;
        db.run("UPDATE demo_accounts SET used_margin = ?, free_margin = ? WHERE user_id = ?", [new_used, new_free, req.user.user_id]);
        res.json({ success: true, position_id: this.lastID, entry_price });
      });
  });
});

app.post("/api/demo/close-position/:id", authMiddleware, (req, res) => {
  const positionId = req.params.id;
  
  db.get("SELECT * FROM demo_positions WHERE id = ? AND user_id = ?", [positionId, req.user.user_id], (err, position) => {
    if (!position) return res.status(404).json({ error: "Position not found" });
    
    const exit_price = MOCK_PRICES[position.symbol] || 100;
    
    let pnl = 0;
    if (position.type === "BUY") pnl = (exit_price - position.entry_price) * position.lot_size;
    else pnl = (position.entry_price - exit_price) * position.lot_size;
    
    db.run("UPDATE demo_positions SET status = ?, current_price = ?, pnl = ? WHERE id = ?", ["closed", exit_price, pnl, positionId]);
    db.run("INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [req.user.user_id, position.bot_id || null, position.symbol, position.type, position.lot_size, position.entry_price, exit_price, pnl, position.opened_at]);
    
    db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [req.user.user_id], (err, account) => {
      const new_balance = account.balance + pnl;
      const requiredMargin = exit_price * position.lot_size * 0.02;
      const new_used = Math.max(0, account.used_margin - requiredMargin);
      const new_free = new_balance - new_used;
      const new_equity = new_balance + new_used;
      db.run("UPDATE demo_accounts SET balance = ?, equity = ?, used_margin = ?, free_margin = ? WHERE user_id = ?",
        [new_balance, new_equity, new_used, new_free, req.user.user_id]);
      res.json({ success: true, pnl, new_balance });
    });
  });
});

app.get("/api/bots", authMiddleware, (req, res) => {
  db.all("SELECT * FROM bots WHERE user_id = ?", [req.user.user_id], (err, bots) => {
    res.json(bots || []);
  });
});

app.get("/api/bots/:id/stats", authMiddleware, (req, res) => {
  const botId = req.params.id;
  const userId = req.user.user_id;
  
  db.get("SELECT status FROM bots WHERE id = ? AND user_id = ?", [botId, userId], (err, bot) => {
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    
    db.all("SELECT pnl FROM demo_trades WHERE bot_id = ? AND user_id = ?", [botId, userId], (err, closedTrades) => {
      const totalProfit = (closedTrades || []).reduce((sum, t) => sum + (t.pnl || 0), 0);
      const tradeCount = closedTrades ? closedTrades.length : 0;
      
      db.all("SELECT pnl FROM demo_positions WHERE bot_id = ? AND user_id = ? AND status = ?", [botId, userId, "open"], (err, openPositions) => {
        const currentPnL = (openPositions || []).reduce((sum, p) => sum + (p.pnl || 0), 0);
        
        res.json({
          bot_profit: parseFloat(totalProfit.toFixed(2)),
          current_pnl: parseFloat(currentPnL.toFixed(2)),
          trade_count: tradeCount,
          status: bot.status
        });
      });
    });
  });
});

app.post("/api/bots", authMiddleware, (req, res) => {
  const { name, strategy, bot_type } = req.body;
  if (!STRATEGIES[strategy]) return res.status(400).json({ error: "Invalid strategy" });
  db.run("INSERT INTO bots (user_id, name, strategy, bot_type) VALUES (?, ?, ?, ?)", [req.user.user_id, name, strategy, bot_type || 'demo'], function(err) {
    if (err) return res.status(400).json({ error: "Error creating bot" });
    res.json({ id: this.lastID, name, strategy, bot_type: bot_type || 'demo', strategyName: STRATEGIES[strategy].name, status: "inactive" });
  });
});

app.put("/api/bots/:id/status", authMiddleware, (req, res) => {
  const { status } = req.body;
  db.run("UPDATE bots SET status = ? WHERE id = ? AND user_id = ?", [status, req.params.id, req.user.user_id]);
  res.json({ success: true });
});

app.delete("/api/bots/:id", authMiddleware, (req, res) => {
  db.run("DELETE FROM bots WHERE id = ? AND user_id = ?", [req.params.id, req.user.user_id]);
  res.json({ success: true });
});

app.get("/api/brokers", authMiddleware, (req, res) => {
  db.all("SELECT id, name, account_type FROM brokers WHERE user_id = ?", [req.user.user_id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post("/api/brokers", authMiddleware, (req, res) => {
  const { name, api_key, account_type } = req.body;
  db.run("INSERT INTO brokers (user_id, name, api_key, account_type) VALUES (?, ?, ?, ?)", [req.user.user_id, name, api_key, account_type], function(err) {
    res.json({ id: this.lastID, name, account_type });
  });
});

app.post("/api/payments/paypal/create-order", authMiddleware, async (req, res) => {
  const { tier } = req.body;
  const prices = { starter: "29.00", premium: "99.00", unlimited: "199.00" };
  try {
    const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET).toString("base64");
    const response = await axios.post("https://api.paypal.com/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: prices[tier] } }],
      return_url: "https://trademind-pro.onrender.com",
      cancel_url: "https://trademind-pro.onrender.com"
    }, { headers: { Authorization: "Basic " + auth } });
    res.json({ order_id: response.data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/payments/paypal/capture-order", authMiddleware, async (req, res) => {
  const { order_id, tier } = req.body;
  const prices = { starter: 29, premium: 99, unlimited: 199 };
  try {
    const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET).toString("base64");
    await axios.post("https://api.paypal.com/v2/checkout/orders/" + order_id + "/capture", {}, { headers: { Authorization: "Basic " + auth } });
    db.run("UPDATE users SET tier = ? WHERE id = ?", [tier, req.user.user_id]);
    db.run("INSERT INTO payments (user_id, amount, currency, method, status, tier) VALUES (?, ?, ?, ?, ?, ?)", [req.user.user_id, prices[tier], "USD", "paypal", "completed", tier]);
    res.json({ success: true, tier });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/payments/history", authMiddleware, (req, res) => {
  db.all("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", [req.user.user_id], (err, payments) => {
    res.json(payments || []);
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("✅ TradeMind Pro running on http://localhost:" + PORT));
