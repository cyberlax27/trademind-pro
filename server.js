require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const axios = require("axios");
const cron = require("node-cron");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-2024";

app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("trademind.db", (err) => {
  if (err) console.error("DB Error:", err);
  else console.log("✓ SQLite connected");
});

// Initialize DB
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
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(bot_id) REFERENCES bots(id)
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
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(bot_id) REFERENCES bots(id)
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
    last_signal_time TIMESTAMP,
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

// Mock price data
const MOCK_PRICES = {
  EURUSD: 1.0850, GBPUSD: 1.2750, USDJPY: 149.50, AUDUSD: 0.6750, NZDUSD: 0.6250, USDCAD: 1.3650,
  BTCUSD: 65000, ETHUSD: 3500, XRPUSD: 2.50, ADAUSD: 0.98, DOGEUSD: 0.45,
  XAUUSD: 2550, XAGUUSD: 31.50, WTIUSD: 78.50, NGAS: 3.25, CORN: 410.50
};

let PRICES = { ...MOCK_PRICES };

// Simulate price changes (random walk)
setInterval(() => {
  for (let symbol in PRICES) {
    const change = (Math.random() - 0.5) * PRICES[symbol] * 0.001;
    PRICES[symbol] = Math.max(PRICES[symbol] + change, PRICES[symbol] * 0.9);
  }
}, 5000);

// ===== STRATEGY ENGINES =====

function calculateMA(prices, period) {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[prices.length - i] - prices[prices.length - i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / (avgLoss || 1);
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
  const ema12 = calculateMA(prices, 12);
  const ema26 = calculateMA(prices, 26);
  if (!ema12 || !ema26) return { macd: 0, signal: 0, histogram: 0 };
  return { macd: ema12 - ema26, signal: (ema12 - ema26) * 0.3, histogram: 0 };
}

function calculateBollinger(prices, period = 20, stdDev = 2) {
  const ma = calculateMA(prices, period);
  if (!ma) return { upper: 0, middle: ma || 0, lower: 0 };
  const variance = prices.slice(-period).reduce((sum, p) => sum + Math.pow(p - ma, 2), 0) / period;
  const sd = Math.sqrt(variance) * stdDev;
  return { upper: ma + sd, middle: ma, lower: ma - sd };
}

function calculateFibonacci(high, low) {
  const range = high - low;
  return {
    level_0: low,
    level_236: low + range * 0.236,
    level_382: low + range * 0.382,
    level_500: low + range * 0.5,
    level_618: low + range * 0.618,
    level_786: low + range * 0.786,
    level_1: high
  };
}

// ===== BOT TRADING ENGINE =====

async function runBotAutomation() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM bots WHERE status = 'active'", async (err, bots) => {
      if (err || !bots) return resolve();

      for (let bot of bots) {
        try {
          // Get bot's user
          db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [bot.user_id], async (err, account) => {
            if (err || !account) return;

            // Get mock price history (simulate with random walk)
            const prices = generatePriceHistory(MOCK_PRICES[bot.symbol] || MOCK_PRICES.EURUSD, 100);
            const currentPrice = PRICES[bot.symbol] || MOCK_PRICES[bot.symbol] || 1;

            let signal = null;
            let signalType = null;
            const params = { tp: bot.take_profit, sl: bot.stop_loss };

            if (bot.strategy === "moving_average") {
              const ma10 = calculateMA(prices, 10);
              const ma20 = calculateMA(prices, 20);
              if (ma10 && ma20) {
                if (ma10 > ma20 && prices[prices.length - 2] <= prices[prices.length - 1]) {
                  signal = "BUY";
                  signalType = "MA Crossover";
                }
                if (ma10 < ma20 && prices[prices.length - 2] >= prices[prices.length - 1]) {
                  signal = "SELL";
                  signalType = "MA Crossover";
                }
              }
            }

            if (bot.strategy === "rsi") {
              const rsi = calculateRSI(prices, 14);
              if (rsi < 30) {
                signal = "BUY";
                signalType = "RSI Oversold";
              }
              if (rsi > 70) {
                signal = "SELL";
                signalType = "RSI Overbought";
              }
            }

            if (bot.strategy === "macd") {
              const macd = calculateMACD(prices);
              if (macd.macd > macd.signal && prices[prices.length - 2] <= prices[prices.length - 1]) {
                signal = "BUY";
                signalType = "MACD Crossover";
              }
              if (macd.macd < macd.signal && prices[prices.length - 2] >= prices[prices.length - 1]) {
                signal = "SELL";
                signalType = "MACD Crossover";
              }
            }

            if (bot.strategy === "bollinger") {
              const bb = calculateBollinger(prices, 20);
              if (currentPrice < bb.lower) {
                signal = "BUY";
                signalType = "Bollinger Lower Band";
              }
              if (currentPrice > bb.upper) {
                signal = "SELL";
                signalType = "Bollinger Upper Band";
              }
            }

            // Execute trade if signal
            if (signal && Math.random() > 0.5) {
              const lot_size = 0.1;
              const entry_price = currentPrice;
              
              db.run(
                "INSERT INTO demo_positions (user_id, bot_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
                [bot.user_id, bot.id, bot.symbol, signal, lot_size, entry_price, currentPrice],
                function() {
                  console.log(`✓ Bot ${bot.name}: AUTO-EXECUTED ${signal} ${lot_size} ${bot.symbol} @ $${entry_price.toFixed(2)}`);
                  db.run("UPDATE bots SET last_signal = ?, last_signal_time = CURRENT_TIMESTAMP WHERE id = ?", [signalType, bot.id]);
                }
              );
            }

            // Update open positions (move towards take profit / stop loss)
            db.all("SELECT * FROM demo_positions WHERE bot_id = ? AND status = 'open'", [bot.id], (err, positions) => {
              if (positions) {
                positions.forEach(pos => {
                  const priceMove = (Math.random() - 0.5) * pos.entry_price * 0.002;
                  const newPrice = pos.current_price + priceMove;
                  const pnl = (newPrice - pos.entry_price) * pos.lot_size * (pos.type === "BUY" ? 1 : -1);

                  // Check take profit or stop loss
                  const tpPrice = pos.entry_price + (pos.type === "BUY" ? bot.take_profit : -bot.take_profit);
                  const slPrice = pos.entry_price - (pos.type === "BUY" ? bot.stop_loss : -bot.stop_loss);

                  let shouldClose = false;
                  let closeReason = "";

                  if (pos.type === "BUY" && newPrice >= tpPrice) {
                    shouldClose = true;
                    closeReason = "Take Profit Hit";
                  }
                  if (pos.type === "BUY" && newPrice <= slPrice) {
                    shouldClose = true;
                    closeReason = "Stop Loss Hit";
                  }
                  if (pos.type === "SELL" && newPrice <= tpPrice) {
                    shouldClose = true;
                    closeReason = "Take Profit Hit";
                  }
                  if (pos.type === "SELL" && newPrice >= slPrice) {
                    shouldClose = true;
                    closeReason = "Stop Loss Hit";
                  }

                  if (shouldClose) {
                    db.run(
                      "INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed')",
                      [pos.user_id, pos.bot_id, pos.symbol, pos.type, pos.lot_size, pos.entry_price, newPrice, pnl]
                    );
                    db.run("DELETE FROM demo_positions WHERE id = ?", [pos.id]);
                    db.run("UPDATE bots SET bot_profit = bot_profit + ?, trade_count = trade_count + 1 WHERE id = ?", [pnl, bot.id]);
                    console.log(`✓ Position closed: ${closeReason} | P&L: $${pnl.toFixed(2)}`);
                  } else {
                    db.run("UPDATE demo_positions SET current_price = ?, pnl = ? WHERE id = ?", [newPrice, pnl, pos.id]);
                  }
                });
              }
            });
          });
        } catch (e) {
          console.error(`Bot ${bot.id} error:`, e.message);
        }
      }

      resolve();
    });
  });
}

function generatePriceHistory(startPrice, length) {
  const prices = [startPrice];
  for (let i = 1; i < length; i++) {
    const change = (Math.random() - 0.5) * startPrice * 0.002;
    prices.push(Math.max(prices[i - 1] + change, startPrice * 0.95));
  }
  return prices;
}

// ===== AUTOMATION SCHEDULER =====
cron.schedule("*/2 * * * *", () => {
  console.log("🤖 Running bot automation...");
  runBotAutomation().catch(e => console.error("Automation error:", e));
});

// ===== API ENDPOINTS =====

app.get("/", (req, res) => res.sendFile(__dirname + "/index.html"));

app.post("/api/auth/signup", (req, res) => {
  const { username, email, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  db.run("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", [username, email, hash], function(err) {
    if (err) return res.json({ error: err.message });
    db.run("INSERT INTO demo_accounts (user_id) VALUES (?)", [this.lastID]);
    const token = jwt.sign({ id: this.lastID, username, tier: "free" }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user: { id: this.lastID, username, email, tier: "free" } });
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (!user) return res.json({ error: "User not found" });
    if (!bcrypt.compareSync(password, user.password)) return res.json({ error: "Invalid password" });
    const token = jwt.sign({ id: user.id, username: user.username, tier: user.tier }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ token, user });
  });
});

app.get("/api/user/profile", authenticate, (req, res) => {
  db.get("SELECT * FROM users WHERE id = ?", [req.user.id], (err, user) => {
    res.json({ id: user.id, username: user.username, email: user.email, tier: user.tier });
  });
});

app.put("/api/user/profile", authenticate, (req, res) => {
  const { email, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.run("UPDATE users SET email = ?, password = ? WHERE id = ?", [email, hash, req.user.id], () => {
      res.json({ success: true });
    });
  } else {
    db.run("UPDATE users SET email = ? WHERE id = ?", [email, req.user.id], () => {
      res.json({ success: true });
    });
  }
});

app.delete("/api/user/account", authenticate, (req, res) => {
  db.run("DELETE FROM users WHERE id = ?", [req.user.id], () => {
    res.json({ success: true });
  });
});

app.get("/api/strategies", (req, res) => {
  res.json({
    moving_average: { name: "Moving Average Crossover", desc: "Best for beginners" },
    rsi: { name: "RSI Momentum", desc: "Detects overbought/oversold" },
    macd: { name: "MACD Trend", desc: "Combines momentum and trend analysis" },
    bollinger: { name: "Bollinger Bands", desc: "Support/resistance levels" },
    fibonacci: { name: "Fibonacci Retracement", desc: "Level-based trading" }
  });
});

app.get("/api/assets", (req, res) => {
  res.json({
    forex: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD"],
    crypto: ["BTCUSD", "ETHUSD", "XRPUSD", "ADAUSD", "DOGEUSD"],
    commodities: ["XAUUSD", "XAGUUSD", "WTIUSD", "NGAS", "CORN"]
  });
});

app.get("/api/brokers-list", (req, res) => {
  res.json({
    xm: { name: "XM", guide: "1. Create XM account\n2. Enable API\n3. Copy API Key\n4. Paste here", docs: "https://xm.com/docs" },
    exness: { name: "Exness", guide: "1. Create Exness account\n2. Go to Settings → API\n3. Generate key\n4. Paste here", docs: "https://exness.com/docs" },
    doto: { name: "Doto", guide: "1. Create Doto account\n2. Dashboard → Integrations\n3. Copy API Key\n4. Paste here", docs: "https://doto.com/docs" },
    demo: { name: "Demo Account", guide: "No API key needed. Use our $10,000 virtual account to practice trading.", docs: "#" }
  });
});

app.get("/api/market-price/:symbol", (req, res) => {
  const price = PRICES[req.params.symbol] || MOCK_PRICES[req.params.symbol] || 1;
  res.json({ symbol: req.params.symbol, price, change: (Math.random() - 0.5) * 2 });
});

app.get("/api/chart-data/:symbol", (req, res) => {
  const basePrice = MOCK_PRICES[req.params.symbol] || 1;
  const data = [];
  let time = Math.floor(Date.now() / 1000) - 50 * 3600;
  for (let i = 0; i < 50; i++) {
    const open = basePrice + (Math.random() - 0.5) * basePrice * 0.01;
    const close = open + (Math.random() - 0.5) * basePrice * 0.01;
    data.push({
      time,
      open: Math.round(open * 100) / 100,
      high: Math.max(open, close) + (Math.random() * basePrice * 0.005),
      low: Math.min(open, close) - (Math.random() * basePrice * 0.005),
      close: Math.round(close * 100) / 100
    });
    time += 3600;
  }
  res.json(data);
});

app.get("/api/demo/account", authenticate, (req, res) => {
  db.get("SELECT * FROM demo_accounts WHERE user_id = ?", [req.user.id], (err, account) => {
    res.json(account || { balance: 10000, equity: 10000, used_margin: 0, free_margin: 10000 });
  });
});

app.get("/api/demo/positions", authenticate, (req, res) => {
  db.all("SELECT * FROM demo_positions WHERE user_id = ? AND status = 'open'", [req.user.id], (err, positions) => {
    res.json(positions || []);
  });
});

app.get("/api/demo/pending", authenticate, (req, res) => {
  db.all("SELECT * FROM demo_positions WHERE user_id = ? AND status = 'pending'", [req.user.id], (err, positions) => {
    res.json(positions || []);
  });
});

app.get("/api/demo/closed", authenticate, (req, res) => {
  db.all("SELECT * FROM demo_trades WHERE user_id = ? ORDER BY closed_at DESC LIMIT 50", [req.user.id], (err, trades) => {
    res.json(trades || []);
  });
});

app.post("/api/demo/trade", authenticate, (req, res) => {
  const { symbol, type, lot_size, bot_id } = req.body;
  const price = PRICES[symbol] || MOCK_PRICES[symbol] || 1;
  db.run(
    "INSERT INTO demo_positions (user_id, bot_id, symbol, type, lot_size, entry_price, current_price, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')",
    [req.user.id, bot_id || null, symbol, type, lot_size, price, price],
    function() {
      res.json({ success: true, entry_price: price, position_id: this.lastID });
    }
  );
});

app.post("/api/demo/close-position/:id", authenticate, (req, res) => {
  db.get("SELECT * FROM demo_positions WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err, pos) => {
    if (!pos) return res.json({ error: "Position not found" });
    const exitPrice = PRICES[pos.symbol] || MOCK_PRICES[pos.symbol] || pos.current_price;
    const pnl = (exitPrice - pos.entry_price) * pos.lot_size * (pos.type === "BUY" ? 1 : -1);
    db.run(
      "INSERT INTO demo_trades (user_id, bot_id, symbol, type, lot_size, entry_price, exit_price, pnl, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed')",
      [pos.user_id, pos.bot_id, pos.symbol, pos.type, pos.lot_size, pos.entry_price, exitPrice, pnl]
    );
    db.run("DELETE FROM demo_positions WHERE id = ?", [req.params.id]);
    if (pos.bot_id) {
      db.run("UPDATE bots SET bot_profit = bot_profit + ?, trade_count = trade_count + 1 WHERE id = ?", [pnl, pos.bot_id]);
    }
    res.json({ success: true, exit_price: exitPrice, pnl });
  });
});

app.get("/api/bots", authenticate, (req, res) => {
  db.all("SELECT * FROM bots WHERE user_id = ?", [req.user.id], (err, bots) => {
    res.json(bots || []);
  });
});

app.get("/api/bots/:id/stats", authenticate, (req, res) => {
  db.get("SELECT bot_profit, trade_count FROM bots WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err, bot) => {
    if (!bot) return res.json({ bot_profit: 0, trade_count: 0, current_pnl: 0 });
    db.get("SELECT COALESCE(SUM(pnl), 0) as current_pnl FROM demo_positions WHERE bot_id = ? AND status = 'open'", [req.params.id], (err, pnl) => {
      res.json({ bot_profit: bot.bot_profit, trade_count: bot.trade_count, current_pnl: pnl?.current_pnl || 0 });
    });
  });
});

app.post("/api/bots", authenticate, (req, res) => {
  const { name, strategy, bot_type } = req.body;
  db.run(
    "INSERT INTO bots (user_id, name, strategy, bot_type) VALUES (?, ?, ?, ?)",
    [req.user.id, name, strategy, bot_type],
    function() {
      res.json({ id: this.lastID, name, strategy, bot_type, status: "active" });
    }
  );
});

app.put("/api/bots/:id/status", authenticate, (req, res) => {
  db.run("UPDATE bots SET status = ? WHERE id = ? AND user_id = ?", [req.body.status, req.params.id, req.user.id], () => {
    res.json({ success: true });
  });
});

app.delete("/api/bots/:id", authenticate, (req, res) => {
  db.run("DELETE FROM bots WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], () => {
    res.json({ success: true });
  });
});

app.get("/api/brokers", authenticate, (req, res) => {
  db.all("SELECT * FROM brokers WHERE user_id = ?", [req.user.id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post("/api/brokers", authenticate, (req, res) => {
  const { name, api_key, account_type } = req.body;
  db.run(
    "INSERT INTO brokers (user_id, name, api_key, account_type) VALUES (?, ?, ?, ?)",
    [req.user.id, name, api_key, account_type],
    function() {
      res.json({ id: this.lastID, name, api_key, account_type });
    }
  );
});

app.post("/api/payments/paypal/create-order", authenticate, (req, res) => {
  const { tier } = req.body;
  const prices = { starter: 29, premium: 99, unlimited: 199 };
  const order_id = Math.random().toString(36).substr(2, 9).toUpperCase();
  res.json({ order_id, tier, amount: prices[tier] });
});

app.get("/api/payments/history", authenticate, (req, res) => {
  db.all("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", [req.user.id], (err, payments) => {
    res.json(payments || []);
  });
});

app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date() }));

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
