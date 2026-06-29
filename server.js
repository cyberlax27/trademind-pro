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
  db.run("CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, strategy TEXT, status TEXT DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS brokers (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, api_key TEXT, account_type TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, currency TEXT, method TEXT, status TEXT, tier TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_accounts (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE, balance REAL DEFAULT 10000, equity REAL DEFAULT 10000, used_margin REAL DEFAULT 0, free_margin REAL DEFAULT 10000, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_positions (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, type TEXT, lot_size REAL, entry_price REAL, current_price REAL, pnl REAL DEFAULT 0, status TEXT DEFAULT 'open', opened_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS demo_trades (id INTEGER PRIMARY KEY, user_id INTEGER, symbol TEXT, type TEXT, lot_size REAL, entry_price REAL, exit_price REAL, pnl REAL, status TEXT DEFAULT 'closed', opened_at DATETIME, closed_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
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

app.get("/api/demo/trades", authMiddleware, (req, res) => {
  db.all("SELECT * FROM demo_trades WHERE user_id = ? ORDER BY closed_at DESC", [req.user.user_id], (err, trades) => {
    res.json(trades || []);
  });
});

app.post("/api/demo/trade", authMiddleware, (req, res) => {
  const { symbol, type, lot_size } = req.body;
  if (!["BUY", "SELL"].includes(type) || lot_size <= 0) return res.status(400).json({ error: "Invalid trade params" });
  
  const entry_price = MOCK_PRICES[symbol] || 100;
  
  db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [req.user.user_id], (err, account) => {
    if (!account) return res.status(400).json({ error: "Demo account not found" });
    
    const requiredMargin = entry_price * lot_size * 0.02;
    if (requiredMargin > account.free_margin) return res.status(400).json({ error: "Insufficient margin" });
    
    db.run("INSERT INTO demo_positions (user_id, symbol, type, lot_size, entry_price, current_price) VALUES (?, ?, ?, ?, ?, ?)",
      [req.user.user_id, symbol, type, lot_size, entry_price, entry_price], function(err) {
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
    db.run("INSERT INTO demo_trades (user_id, symbol, type, lot_size, entry_price, exit_price, pnl, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.user.user_id, position.symbol, position.type, position.lot_size, position.entry_price, exit_price, pnl, position.opened_at]);
    
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

app.post("/api/bots", authMiddleware, (req, res) => {
  const { name, strategy } = req.body;
  if (!STRATEGIES[strategy]) return res.status(400).json({ error: "Invalid strategy" });
  db.run("INSERT INTO bots (user_id, name, strategy) VALUES (?, ?, ?)", [req.user.user_id, name, strategy], function(err) {
    if (err) return res.status(400).json({ error: "Error creating bot" });
    res.json({ id: this.lastID, name, strategy, strategyName: STRATEGIES[strategy].name, status: "inactive" });
  });
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
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TradeMind Pro</title><script src="https://unpkg.com/lightweight-charts@4/dist/lightweight-charts.standalone.production.js"><\/script><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Segoe UI",Tahoma,Geneva,sans-serif;background:linear-gradient(135deg,#0a0e27,#1a1f3a);min-height:100vh;color:#fff}.navbar{background:rgba(15,20,45,0.95);border-bottom:1px solid rgba(102,126,234,0.3);padding:12px 0;position:sticky;top:0;z-index:100}.navbar-content{max-width:1200px;margin:0 auto;padding:0 20px;display:flex;align-items:center;justify-content:space-between}.logo-section{display:flex;align-items:center;gap:15px}.logo-img{height:50px;width:auto;object-fit:contain}.brand-info{flex:1}.brand-info h2{font-size:18px;font-weight:700;margin:0}.brand-info p{font-size:11px;color:#888}#navUserInfo{display:none;text-align:right;display:flex;align-items:center;gap:15px}.logout-btn{background:linear-gradient(135deg,#ff6b6b,#ee5a6f);padding:8px 16px;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;font-weight:600}.container{max-width:1200px;margin:0 auto;padding:0 20px}.hero-section{text-align:center;padding:40px 20px;background:linear-gradient(135deg,rgba(102,126,234,0.1),rgba(0,212,255,0.05));border-radius:15px;margin:30px 0;border:1px solid rgba(102,126,234,0.2)}.hero-logo{max-width:400px;height:auto;margin:0 auto 30px}.hero-title{font-size:36px;font-weight:700;background:linear-gradient(135deg,#667eea,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.card{background:rgba(102,126,234,0.05);border:1px solid rgba(102,126,234,0.3);border-radius:15px;padding:40px;margin-bottom:40px}.tabs{display:flex;gap:10px;margin-bottom:30px;border-bottom:1px solid rgba(102,126,234,0.2);flex-wrap:wrap}.tab-btn{padding:12px 25px;border:none;background:transparent;color:#aaa;cursor:pointer;font-weight:600;border-bottom:2px solid transparent}.tab-btn.active{color:#00d4ff;border-bottom-color:#00d4ff}.tab-content{display:none}.tab-content.active{display:block}h3{color:#00d4ff;margin-bottom:20px}input,select{width:100%;padding:12px;margin:10px 0;border:1px solid rgba(102,126,234,0.3);border-radius:8px;background:rgba(102,126,234,0.05);color:#fff}button{width:100%;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:10px}.row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}.chart-container{background:rgba(102,126,234,0.05);border:1px solid rgba(102,126,234,0.3);border-radius:15px;padding:20px;margin:20px 0;height:400px}#chart{width:100%;height:100%}.chart-title{color:#00d4ff;font-weight:700;margin-bottom:10px;font-size:14px}.price-card{border:1px solid rgba(102,126,234,0.3);padding:25px;margin:15px 0;border-radius:10px}.tier-badge{display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);padding:4px 12px;border-radius:20px;font-size:12px;text-transform:uppercase;margin:0 10px}.strategy-hint{font-size:12px;color:#888;margin-top:5px;padding:8px;background:rgba(102,126,234,0.1);border-radius:6px}.bot-item{background:rgba(102,126,234,0.1);padding:12px;margin:10px 0;border-radius:6px}.demo-stat{background:rgba(102,126,234,0.1);padding:15px;border-radius:8px;margin:10px 0;border-left:3px solid #00d4ff}.position-item{background:rgba(102,126,234,0.1);padding:15px;margin:10px 0;border-radius:8px}.pnl-positive{color:#00ff00;font-weight:700}.pnl-negative{color:#ff6b6b;font-weight:700}.small-btn{width:auto;padding:6px 12px;font-size:11px;margin:5px;display:inline-block}.broker-guide{background:rgba(102,126,234,0.1);border-left:3px solid #00d4ff;padding:15px;margin:15px 0;border-radius:6px;font-size:12px;line-height:1.8}.guide-link{color:#00d4ff;text-decoration:none;cursor:pointer;font-weight:600}</style></head><body><div class="navbar"><div class="navbar-content"><div class="logo-section"><img src="logo-clean.png" class="logo-img" onerror="this.style.display='none'"><div class="brand-info"><h2>TradeMind Pro</h2><p>Forex Trading Bot Platform</p></div></div><div id="navUserInfo"><div style="font-size:12px;color:#aaa" id="navUsername">Loading...</div><span class="tier-badge" id="navTier">free</span><button class="logout-btn" onclick="logout()">Logout</button></div></div></div><div class="container"><div class="hero-section" id="heroSection"><img src="logo-community.png" class="hero-logo" onerror="this.style.display='none'"><h1 class="hero-title">Welcome to TradeMind Pro</h1><p style="color:#aaa;font-size:14px">Professional Forex Trading Bot Platform with Paper Trading</p></div><div class="card" id="authCard"><div class="tabs"><button class="tab-btn active" onclick="showTab(this,'auth')">Authentication</button></div><div id="auth" class="tab-content active"><h3>Login / Sign Up</h3><div id="authToggle"><button onclick="showSignup()">Don't have account? Sign Up</button></div><div id="loginForm"><h3>Login</h3><input type="text" id="username" placeholder="Username"><input type="password" id="password" placeholder="Password"><button onclick="login()">Login</button><p id="authMsg"><\/p><button onclick="showSignup()" style="background:transparent;color:#00d4ff;margin-top:20px">Create new account</button></div><div id="signupForm" style="display:none"><h3>Sign Up</h3><input type="text" id="signupUsername" placeholder="Username"><input type="email" id="signupEmail" placeholder="Email address"><input type="password" id="signupPassword" placeholder="Password"><input type="password" id="signupPassword2" placeholder="Confirm Password"><button onclick="signup()">Create Account</button><p id="signupMsg"><\/p><button onclick="showLogin()" style="background:transparent;color:#00d4ff;margin-top:20px">Already have account? Login</button></div></div></div><div class="card" id="mainCard" style="display:none"><div class="tabs"><button class="tab-btn active" onclick="showTab(this,'dashboard')">Dashboard</button><button class="tab-btn" onclick="showTab(this,'demo')">Demo Trading</button><button class="tab-btn" onclick="showTab(this,'payments')">Subscription</button></div><div id="dashboard" class="tab-content active"><h3>Your Account</h3><p id="profileMsg">👤 Loading...</p><h3>Create Trading Bot</h3><input type="text" id="botName" placeholder="Bot name (e.g., MyBot1)"><select id="botStrategy"><option value="">Select Trading Strategy...</option><option value="moving_average">📈 Moving Average Crossover</option><option value="rsi">📊 RSI Momentum</option><option value="macd">🎯 MACD Trend</option><option value="bollinger">🎪 Bollinger Bands</option><option value="fibonacci">🔢 Fibonacci Retracement</option></select><div id="strategyHint" class="strategy-hint"><\/div><button onclick="createBot()">Create Bot</button><div id="botsList" style="margin-top:20px"><\/div><h3 style="margin-top:30px">🏦 Connect Broker</h3><select id="brokerSelect" onchange="showBrokerGuide()"><option value="">Select Broker...</option><option value="demo">Demo Account (Built-in)</option><option value="xm">XM (XEMarkets)</option><option value="exness">Exness</option><option value="doto">Doto Markets</option></select><div id="brokerGuideContainer"><\/div><input type="password" id="brokerApiKey" placeholder="Paste your API Key here" style="display:none"><select id="brokerAccountType" style="display:none"><option value="demo">Demo Account</option><option value="live">Live Account</option></select><button id="brokerConnectBtn" onclick="connectBroker()" style="display:none">Connect Broker</button><div id="brokersList" style="margin-top:20px"><\/div></div><div id="demo" class="tab-content"><h3>💰 Demo Trading Account - $10,000 Virtual Balance</h3><div class="row"><div class="demo-stat"><div style="color:#888;font-size:12px">Balance</div><div style="font-size:24px;font-weight:700">$<span id="demoBalance">10000</span></div></div><div class="demo-stat"><div style="color:#888;font-size:12px">Equity</div><div style="font-size:24px;font-weight:700">$<span id="demoEquity">10000</span></div></div><div class="demo-stat"><div style="color:#888;font-size:12px">Free Margin</div><div style="font-size:24px;font-weight:700">$<span id="demoFreeMargin">10000</span></div></div><div class="demo-stat"><div style="color:#888;font-size:12px">Used Margin</div><div style="font-size:24px;font-weight:700">$<span id="demoUsedMargin">0</span></div></div></div><h3>📊 Live Price Chart</h3><div class="chart-title" id="chartTitle">Select a symbol</div><div class="chart-container"><div id="chart"><\/div></div><h3>Open a Trade</h3><select id="assetClass"><option value="">Select Asset Class...</option><option value="forex">🌍 Forex</option><option value="crypto">₿ Crypto</option><option value="commodities">🛢️ Commodities</option></select><select id="assetSymbol"><option value="">Select Symbol...</option></select><select id="tradeType"><option value="BUY">BUY</option><option value="SELL">SELL</option></select><input type="number" id="lotSize" placeholder="Lot Size" min="0.01" step="0.01"><button onclick="executeTrade()">Execute Trade</button><p id="tradeMsg"><\/p><h3 style="margin-top:30px">Open Positions</h3><div id="openPositions"><\/div><h3 style="margin-top:30px">Closed Trades</h3><div id="closedTrades"><\/div></div><div id="payments" class="tab-content"><h3>Subscription Plans - PayPal Checkout</h3><div class="price-card"><h3>Starter - $29/month</h3><p>✓ 3 Trading Bots<br>✓ 2 Broker Connections</p><button onclick="buyPayPal('starter')">Pay with PayPal/Card</button></div><div class="price-card"><h3>Premium - $99/month</h3><p>✓ 10 Trading Bots<br>✓ Unlimited Brokers</p><button onclick="buyPayPal('premium')">Pay with PayPal/Card</button></div><div class="price-card"><h3>Unlimited - $199/month</h3><p>✓ Unlimited Bots<br>✓ Unlimited Brokers</p><button onclick="buyPayPal('unlimited')">Pay with PayPal/Card</button></div></div></div></div><script>const API=window.location.origin;let token=localStorage.getItem("token");let strategies={};let assets={};let brokersList={};let chart=null;let candleSeries=null;if(token){document.getElementById("heroSection").style.display="none";document.getElementById("authCard").style.display="none";document.getElementById("mainCard").style.display="block";loadProfile()}function showSignup(){document.getElementById("loginForm").style.display="none";document.getElementById("signupForm").style.display="block";document.getElementById("authToggle").style.display="none"}function showLogin(){document.getElementById("signupForm").style.display="none";document.getElementById("loginForm").style.display="block";document.getElementById("authToggle").style.display="none"}function logout(){localStorage.removeItem("token");token=null;document.getElementById("heroSection").style.display="block";document.getElementById("authCard").style.display="block";document.getElementById("mainCard").style.display="none";document.getElementById("loginForm").style.display="block";document.getElementById("signupForm").style.display="none";document.getElementById("authToggle").style.display="block"}function showTab(btn,tab){document.querySelectorAll(".tab-content").forEach(t=>t.classList.remove("active"));document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));document.getElementById(tab).classList.add("active");btn.classList.add("active");if(tab==="demo")refreshDemo()}document.getElementById("assetClass").addEventListener("change",async function(){const symbols=assets[this.value]||[];const symbolSelect=document.getElementById("assetSymbol");symbolSelect.innerHTML="<option value=''>Select Symbol...</option>"+symbols.map(s=>"<option value='"+s+"'>"+s+"</option>").join("")});document.getElementById("assetSymbol").addEventListener("change",async function(){if(this.value){loadChart(this.value)}});document.getElementById("botStrategy").addEventListener("change",function(){const hint=document.getElementById("strategyHint");if(this.value&&strategies[this.value]){hint.innerHTML="📝 "+strategies[this.value].desc}else{hint.innerHTML=""}});async function loadBrokersList(){const res=await fetch(API+"/api/brokers-list");brokersList=await res.json()}async function showBrokerGuide(){const brokerKey=document.getElementById("brokerSelect").value;const guideContainer=document.getElementById("brokerGuideContainer");const apiKeyInput=document.getElementById("brokerApiKey");const accountSelect=document.getElementById("brokerAccountType");const connectBtn=document.getElementById("brokerConnectBtn");if(!brokerKey){guideContainer.innerHTML="";apiKeyInput.style.display="none";accountSelect.style.display="none";connectBtn.style.display="none";return}const broker=brokersList[brokerKey];if(broker){const guide='<div class="broker-guide"><strong style="color:#00d4ff">'+broker.name+'</strong><br><br>'+broker.guide.split("\\n").join("<br>")+'<br><br><a href="'+broker.docs+'" target="_blank" class="guide-link">📖 View Official Docs →</a></div>';guideContainer.innerHTML=guide;if(brokerKey==="demo"){apiKeyInput.style.display="none";accountSelect.style.display="none";connectBtn.style.display="block";connectBtn.innerHTML="Use Demo Account"}else{apiKeyInput.style.display="block";accountSelect.style.display="block";connectBtn.style.display="block";connectBtn.innerHTML="Connect Broker"}}}async function signup(){const username=document.getElementById("signupUsername").value;const email=document.getElementById("signupEmail").value;const password=document.getElementById("signupPassword").value;const password2=document.getElementById("signupPassword2").value;if(!username||!email||!password||!password2)return alert("All fields required");if(password!==password2)return alert("Passwords don't match");const res=await fetch(API+"/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,email,password})});const data=await res.json();if(data.token){localStorage.setItem("token",data.token);token=data.token;document.getElementById("signupMsg").innerHTML="<p style='color:#00d4ff'>✓ Account created! Redirecting...</p>";setTimeout(()=>location.reload(),1500)}else{document.getElementById("signupMsg").innerHTML="<p style='color:#ff6b6b'>✗ "+data.error+"</p>"}}async function login(){const username=document.getElementById("username").value;const password=document.getElementById("password").value;if(!username||!password)return alert("Enter username and password");const res=await fetch(API+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});const data=await res.json();if(data.token){localStorage.setItem("token",data.token);token=data.token;document.getElementById("authMsg").innerHTML="<p style='color:#00d4ff'>✓ Login successful! Redirecting...</p>";setTimeout(()=>location.reload(),1500)}else{document.getElementById("authMsg").innerHTML="<p style='color:#ff6b6b'>✗ Invalid credentials</p>"}}async function loadProfile(){const res=await fetch(API+"/api/user/profile",{headers:{Authorization:"Bearer "+token}});const user=await res.json();document.getElementById("profileMsg").innerHTML="<p>👤 <strong>"+user.username+"</strong> ("+user.email+")<br><span class='tier-badge'>"+user.tier.toUpperCase()+"</span></p>";document.getElementById("navUserInfo").style.display="flex";document.getElementById("navUsername").innerHTML="👤 "+user.username;document.getElementById("navTier").innerHTML=user.tier.toUpperCase();loadBots();loadBrokers();await loadBrokersList()}async function loadAssets(){const res=await fetch(API+"/api/assets");assets=await res.json()}async function createBot(){if(!token)return alert("Login first");const name=document.getElementById("botName").value;const strategy=document.getElementById("botStrategy").value;if(!name||!strategy)return alert("Enter bot name and select strategy");const res=await fetch(API+"/api/bots",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({name,strategy})});const bot=await res.json();if(bot.error){alert(bot.error)}else{document.getElementById("botName").value="";document.getElementById("botStrategy").value="";document.getElementById("strategyHint").innerHTML="";loadBots()}}async function loadBots(){const res=await fetch(API+"/api/bots",{headers:{Authorization:"Bearer "+token}});const bots=await res.json();await loadStrategies();document.getElementById("botsList").innerHTML=bots.length?"<h3 style='margin-top:20px'>Your Bots</h3>"+bots.map(b=>"<div class='bot-item'>🤖 <strong>"+b.name+"</strong><br><small>"+strategies[b.strategy].name+"</small></div>").join(""):""}async function loadStrategies(){const res=await fetch(API+"/api/strategies");strategies=await res.json()}async function connectBroker(){if(!token)return alert("Login first");const brokerSelect=document.getElementById("brokerSelect").value;if(!brokerSelect)return alert("Select a broker");let name=brokersList[brokerSelect]?.name||brokerSelect;let api_key="";if(brokerSelect!=="demo"){api_key=document.getElementById("brokerApiKey").value;if(!api_key)return alert("Paste your API key")}const account_type=document.getElementById("brokerAccountType").value;const res=await fetch(API+"/api/brokers",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({name,api_key,account_type})});const broker=await res.json();document.getElementById("brokerSelect").value="";document.getElementById("brokerApiKey").value="";document.getElementById("brokerGuideContainer").innerHTML="";loadBrokers()}async function loadBrokers(){const res=await fetch(API+"/api/brokers",{headers:{Authorization:"Bearer "+token}});const brokers=await res.json();document.getElementById("brokersList").innerHTML=brokers.length?"<h3 style='margin-top:20px'>Connected Brokers</h3>"+brokers.map(b=>"<div class='bot-item'>🏦 <strong>"+b.name+"</strong> ("+b.account_type+")</div>").join(""):""}const ASSET_NAMES={"EURUSD":"EUR/USD - Euro vs Dollar","GBPUSD":"GBP/USD - British Pound vs Dollar","USDJPY":"USD/JPY - Dollar vs Yen","AUDUSD":"AUD/USD - Australian Dollar vs Dollar","NZDUSD":"NZD/USD - NZ Dollar vs Dollar","USDCAD":"USD/CAD - Dollar vs Canadian Dollar","BTCUSD":"BTC/USD - Bitcoin","ETHUSD":"ETH/USD - Ethereum","XRPUSD":"XRP/USD - Ripple","ADAUSD":"ADA/USD - Cardano","DOGEUSD":"DOGE/USD - Dogecoin","XAUUSD":"XAU/USD - Gold","XAGUUSD":"XAG/USD - Silver","WTIUSD":"WTI/USD - Crude Oil","NGAS":"NGAS/USD - Natural Gas","CORN":"CORN/USD - Corn"};async function loadChart(symbol){document.getElementById("chartTitle").innerHTML="📊 "+ASSET_NAMES[symbol];const res=await fetch(API+"/api/chart-data/"+symbol);const data=await res.json();const chartContainer=document.getElementById("chart");chartContainer.innerHTML="";chart=LightweightCharts.createChart(chartContainer,{layout:{background:{color:"#0a0e27"},textColor:"#888"},timeScale:{timeVisible:true}});candleSeries=chart.addCandlestickSeries({upColor:"#00ff00",downColor:"#ff0000",wickUpColor:"#00ff00",wickDownColor:"#ff0000",borderVisible:false});candleSeries.setData(data);chart.timeScale().fitContent()}async function refreshDemo(){const res=await fetch(API+"/api/demo/account",{headers:{Authorization:"Bearer "+token}});const account=await res.json();document.getElementById("demoBalance").innerHTML=account.balance.toFixed(2);document.getElementById("demoEquity").innerHTML=account.equity.toFixed(2);document.getElementById("demoFreeMargin").innerHTML=account.free_margin.toFixed(2);document.getElementById("demoUsedMargin").innerHTML=account.used_margin.toFixed(2);loadPositions();loadTrades();await loadAssets()}async function executeTrade(){if(!token)return alert("Login first");const symbol=document.getElementById("assetSymbol").value;const type=document.getElementById("tradeType").value;const lot_size=parseFloat(document.getElementById("lotSize").value);if(!symbol||!type||!lot_size)return alert("Select symbol, type, and lot size");const res=await fetch(API+"/api/demo/trade",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({symbol,type,lot_size})});const data=await res.json();if(data.success){document.getElementById("tradeMsg").innerHTML="<p style='color:#00d4ff'>✓ Trade opened at $"+data.entry_price.toFixed(2)+"</p>";document.getElementById("lotSize").value="";document.getElementById("assetSymbol").value="";refreshDemo()}else{document.getElementById("tradeMsg").innerHTML="<p style='color:#ff6b6b'>✗ "+data.error+"</p>"}}async function loadPositions(){const res=await fetch(API+"/api/demo/positions",{headers:{Authorization:"Bearer "+token}});const positions=await res.json();document.getElementById("openPositions").innerHTML=positions.length?positions.map(p=>"<div class='position-item'><div><strong>"+p.symbol+"</strong> ("+p.type+") x"+p.lot_size.toFixed(2)+"<br><small>Entry: $"+p.entry_price.toFixed(2)+" | Current: $"+p.current_price.toFixed(2)+"<br>P&L: <span class='"+(p.pnl>=0?"pnl-positive":"pnl-negative")+"'>$"+p.pnl.toFixed(2)+"</span></small></div><div><button class='small-btn' onclick='closePosition("+p.id+")'>Close</button></div></div>").join(""):"<p style='color:#666'>No open positions</p>"}async function closePosition(id){const res=await fetch(API+"/api/demo/close-position/"+id,{method:"POST",headers:{Authorization:"Bearer "+token}});const data=await res.json();if(data.success){const pnl_class=data.pnl>=0?"pnl-positive":"pnl-negative";document.getElementById("tradeMsg").innerHTML="<p style='color:#00d4ff'>✓ Position closed | P&L: <span class='"+pnl_class+"'>$"+data.pnl.toFixed(2)+"</span></p>";refreshDemo()}else{alert(data.error)}}async function loadTrades(){const res=await fetch(API+"/api/demo/trades",{headers:{Authorization:"Bearer "+token}});const trades=await res.json();document.getElementById("closedTrades").innerHTML=trades.length?"<table style='width:100%;font-size:12px'><tr style='border-bottom:1px solid rgba(102,126,234,0.3)'><td style='padding:8px'>Symbol</td><td style='padding:8px'>Type</td><td style='padding:8px'>Size</td><td style='padding:8px'>Entry</td><td style='padding:8px'>Exit</td><td style='padding:8px'>P&L</td></tr>"+trades.map(t=>"<tr style='border-bottom:1px solid rgba(102,126,234,0.1)'><td style='padding:8px'>"+t.symbol+"</td><td style='padding:8px'>"+t.type+"</td><td style='padding:8px'>"+t.lot_size.toFixed(2)+"</td><td style='padding:8px'>$"+t.entry_price.toFixed(2)+"</td><td style='padding:8px'>$"+t.exit_price.toFixed(2)+"</td><td style='padding:8px;color:"+(t.pnl>=0?"#00ff00":"#ff6b6b")+"'>$"+t.pnl.toFixed(2)+"</td></tr>").join("")+"</table>":"<p style='color:#666'>No closed trades</p>"}async function buyPayPal(tier){if(!token)return alert("Login first");const res=await fetch(API+"/api/payments/paypal/create-order",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({tier})});const data=await res.json();if(data.order_id){window.location.href="https://www.paypal.com/pay?token="+data.order_id}else{alert("Error: "+(data.error||"Unknown"))}}<\/script></body></html>`);
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("✅ TradeMind Pro running on http://localhost:" + PORT));
