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
  db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, tier TEXT DEFAULT 'free', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, strategy TEXT, status TEXT DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS brokers (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, api_key TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  db.run("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, currency TEXT, method TEXT, status TEXT, tier TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
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

app.post("/api/auth/signup", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], function(err) {
    if (err) return res.status(400).json({ error: "User exists" });
    const token = jwt.sign({ user_id: this.lastID, username }, JWT_SECRET);
    res.json({ token, user_id: this.lastID });
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
  db.get("SELECT id, username, tier FROM users WHERE id = ?", [req.user.user_id], (err, user) => {
    res.json(user);
  });
});

app.get("/api/strategies", (req, res) => {
  res.json(STRATEGIES);
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
  db.all("SELECT id, name FROM brokers WHERE user_id = ?", [req.user.user_id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post("/api/brokers", authMiddleware, (req, res) => {
  const { name, api_key } = req.body;
  db.run("INSERT INTO brokers (user_id, name, api_key) VALUES (?, ?, ?)", [req.user.user_id, name, api_key], function(err) {
    res.json({ id: this.lastID, name });
  });
});

app.post("/api/payments/paypal/create-order", authMiddleware, async (req, res) => {
  const { tier } = req.body;
  const prices = { starter: "29.00", premium: "99.00", unlimited: "199.00" };
  console.log("💳 PayPal Order - Tier:", tier);
  try {
    const auth = Buffer.from(process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET).toString("base64");
    const response = await axios.post("https://api.paypal.com/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: prices[tier] } }],
      return_url: "https://trademind-pro.onrender.com",
      cancel_url: "https://trademind-pro.onrender.com"
    }, { headers: { Authorization: "Basic " + auth } });
    console.log("✅ PayPal Order Created");
    res.json({ order_id: response.data.id });
  } catch (e) {
    console.error("❌ PayPal Error:", e.message);
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
    console.error("❌ PayPal Capture Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/payments/paymongo/create-checkout", authMiddleware, async (req, res) => {
  const { tier } = req.body;
  const prices = { starter: 1500, premium: 4995, unlimited: 9995 };
  console.log("💳 Paymongo Checkout - Tier:", tier);
  try {
    const auth = Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64");
    const response = await axios.post("https://api.paymongo.com/v1/checkout_sessions", {
      data: {
        attributes: {
          payment_method_types: ["card", "gcash", "paymaya"],
          redirect: { success: "https://trademind-pro.onrender.com", failed: "https://trademind-pro.onrender.com" },
          line_items: [{ name: tier + " Plan", amount: prices[tier] * 100, currency: "PHP", quantity: 1 }]
        }
      }
    }, { headers: { Authorization: "Basic " + auth } });
    console.log("✅ Paymongo Checkout Created");
    res.json({ checkout_url: response.data.data.attributes.checkout_url });
  } catch (e) {
    console.error("❌ Paymongo Error:", e.response?.data || e.message);
    res.status(500).json({ error: "Paymongo coming soon in 14 days!" });
  }
});

app.get("/api/payments/history", authMiddleware, (req, res) => {
  db.all("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC", [req.user.user_id], (err, payments) => {
    res.json(payments || []);
  });
});

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>TradeMind Pro</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Tahoma,Geneva,sans-serif;background:linear-gradient(135deg,#0a0e27,#1a1f3a);min-height:100vh;color:#fff}.navbar{background:rgba(15,20,45,0.95);border-bottom:1px solid rgba(102,126,234,0.3);padding:12px 0;position:sticky;top:0;z-index:100}.navbar-content{max-width:1200px;margin:0 auto;padding:0 20px;display:flex;align-items:center;justify-content:space-between}.logo-section{display:flex;align-items:center;gap:15px}.logo-img{height:50px;width:auto;object-fit:contain}.brand-info h2{font-size:18px;font-weight:700;margin:0}.brand-info p{font-size:11px;color:#888}.container{max-width:1000px;margin:0 auto;padding:0 20px}.hero-section{text-align:center;padding:40px 20px;background:linear-gradient(135deg,rgba(102,126,234,0.1),rgba(0,212,255,0.05));border-radius:15px;margin:30px 0;border:1px solid rgba(102,126,234,0.2)}.hero-logo{max-width:400px;height:auto;margin:0 auto 30px}.hero-title{font-size:36px;font-weight:700;background:linear-gradient(135deg,#667eea,#00d4ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}.card{background:rgba(102,126,234,0.05);border:1px solid rgba(102,126,234,0.3);border-radius:15px;padding:40px;margin-bottom:40px}.tabs{display:flex;gap:10px;margin-bottom:30px;border-bottom:1px solid rgba(102,126,234,0.2);flex-wrap:wrap}.tab-btn{padding:12px 25px;border:none;background:transparent;color:#aaa;cursor:pointer;font-weight:600;border-bottom:2px solid transparent;transition:all 0.3s}.tab-btn.active{color:#00d4ff;border-bottom-color:#00d4ff}.tab-content{display:none}.tab-content.active{display:block}h3{color:#00d4ff;margin-bottom:20px}input,select{width:100%;padding:12px;margin:10px 0;border:1px solid rgba(102,126,234,0.3);border-radius:8px;background:rgba(102,126,234,0.05);color:#fff}button{width:100%;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin-top:10px}.price-card{border:1px solid rgba(102,126,234,0.3);padding:25px;margin:15px 0;border-radius:10px}.tier-badge{display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);padding:4px 12px;border-radius:20px;font-size:12px;text-transform:uppercase}.success{color:#00d4ff;margin:10px 0;font-weight:600}.error{color:#ff6b6b;margin:10px 0}.strategy-hint{font-size:12px;color:#888;margin-top:5px;padding:8px;background:rgba(102,126,234,0.1);border-radius:6px}.bot-item{background:rgba(102,126,234,0.1);padding:12px;margin:10px 0;border-radius:6px;display:flex;justify-content:space-between;align-items:center}</style></head><body><div class='navbar'><div class='navbar-content'><div class='logo-section'><img src='logo-clean.png' class='logo-img' onerror='this.style.display="none"'><div class='brand-info'><h2>TradeMind Pro</h2><p>Forex Trading Bot Platform</p></div></div><div id='navUserInfo' style='text-align:right;display:none'><div style='font-size:12px;color:#aaa' id='navUsername'>Loading...</div><div class='tier-badge' id='navTier'>free</div></div></div></div><div class='container'><div class='hero-section' id='heroSection'><img src='logo-community.png' class='hero-logo' onerror='this.style.display="none"'><h1 class='hero-title'>Welcome to TradeMind Pro</h1><p style='color:#aaa;font-size:14px'>Professional Forex Trading Bot Platform</p></div><div class='card'><div class='tabs'><button class='tab-btn active' onclick='showTab(this,"auth")'>Authentication</button><button class='tab-btn' onclick='showTab(this,"dashboard")'>Dashboard</button><button class='tab-btn' onclick='showTab(this,"payments")'>Subscription</button></div><div id='auth' class='tab-content active'><h3>Login / Sign Up</h3><input type='text' id='username' placeholder='Username'><input type='password' id='password' placeholder='Password'><button onclick='signup()'>Create Account</button><button onclick='login()'>Login</button><p id='authMsg'></p></div><div id='dashboard' class='tab-content'><h3>Your Account</h3><p id='profileMsg'>👤 Login to view your profile</p><h3>Create Trading Bot</h3><input type='text' id='botName' placeholder='Bot name (e.g., MyBot1)'><select id='botStrategy'><option value=''>Select Trading Strategy...</option><option value='moving_average'>📈 Moving Average Crossover - Best for beginners</option><option value='rsi'>📊 RSI Momentum - Detects overbought/oversold</option><option value='macd'>🎯 MACD Trend - Momentum + trend analysis</option><option value='bollinger'>🎪 Bollinger Bands - Support/resistance levels</option><option value='fibonacci'>🔢 Fibonacci Retracement - Level-based trading</option></select><div id='strategyHint' class='strategy-hint'></div><button onclick='createBot()'>Create Bot</button><div id='botsList' style='margin-top:20px'></div></div><div id='payments' class='tab-content'><h3>Subscription Plans</h3><div class='price-card'><h3>Starter - \$29/month</h3><p>✓ 3 Trading Bots<br>✓ 2 Broker Connections</p><button onclick='buyPayPal("starter")'>Pay with PayPal/Card</button></div><div class='price-card'><h3>Premium - \$99/month</h3><p>✓ 10 Trading Bots<br>✓ Unlimited Brokers</p><button onclick='buyPayPal("premium")'>Pay with PayPal/Card</button></div><div class='price-card'><h3>Unlimited - \$199/month</h3><p>✓ Unlimited Bots<br>✓ Unlimited Brokers</p><button onclick='buyPayPal("unlimited")'>Pay with PayPal/Card</button></div><p id='paymentMsg'></p></div></div></div><script>const API=window.location.origin;let token=localStorage.getItem('token');let strategies={};if(token){document.getElementById('heroSection').style.display='none';loadProfile()}async function loadStrategies(){const res=await fetch(API+'/api/strategies');strategies=await res.json()}function showTab(btn,tab){document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.getElementById(tab).classList.add('active');btn.classList.add('active')}document.getElementById('botStrategy').addEventListener('change',function(){const hint=document.getElementById('strategyHint');if(this.value && strategies[this.value]){hint.innerHTML='📝 '+strategies[this.value].desc}else{hint.innerHTML=''}});async function signup(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;if(!username||!password)return alert('Enter username and password');const res=await fetch(API+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await res.json();if(data.token){localStorage.setItem('token',data.token);token=data.token;document.getElementById('authMsg').innerHTML='<p class="success">✓ Account created! Redirecting...</p>';setTimeout(()=>location.reload(),1500)}else{document.getElementById('authMsg').innerHTML='<p class="error">✗ '+data.error+'</p>'}}async function login(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;if(!username||!password)return alert('Enter username and password');const res=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await res.json();if(data.token){localStorage.setItem('token',data.token);token=data.token;document.getElementById('authMsg').innerHTML='<p class="success">✓ Login successful! Redirecting...</p>';setTimeout(()=>location.reload(),1500)}else{document.getElementById('authMsg').innerHTML='<p class="error">✗ Invalid credentials</p>'}}async function loadProfile(){const res=await fetch(API+'/api/user/profile',{headers:{Authorization:'Bearer '+token}});const user=await res.json();document.getElementById('profileMsg').innerHTML='<p>👤 <strong>'+user.username+'</strong><span class="tier-badge">'+user.tier.toUpperCase()+'</span></p>';document.getElementById('navUserInfo').style.display='block';document.getElementById('navUsername').innerHTML='👤 '+user.username;document.getElementById('navTier').innerHTML=user.tier.toUpperCase();loadBots()}async function createBot(){if(!token)return alert('Login first');const name=document.getElementById('botName').value;const strategy=document.getElementById('botStrategy').value;if(!name||!strategy)return alert('Enter bot name and select strategy');const res=await fetch(API+'/api/bots',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name,strategy})});const bot=await res.json();if(bot.error){alert(bot.error)}else{document.getElementById('botName').value='';document.getElementById('botStrategy').value='';document.getElementById('strategyHint').innerHTML='';loadBots()}}async function loadBots(){const res=await fetch(API+'/api/bots',{headers:{Authorization:'Bearer '+token}});const bots=await res.json();await loadStrategies();document.getElementById('botsList').innerHTML=bots.length?'<h3>Your Bots</h3>'+bots.map(b=>'<div class="bot-item"><div>🤖 <strong>'+b.name+'</strong><br><small>'+strategies[b.strategy].name+'</small></div></div>').join(''):'<p style="color:#666">No bots yet. Create one above!</p>'}async function buyPayPal(tier){if(!token)return document.getElementById('paymentMsg').innerHTML='<p class="error">✗ Login first</p>';const res=await fetch(API+'/api/payments/paypal/create-order',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({tier})});const data=await res.json();if(data.order_id){window.location.href='https://www.paypal.com/pay?token='+data.order_id}else{document.getElementById('paymentMsg').innerHTML='<p class="error">✗ Error: '+(data.error||'Unknown')+'</p>'}}</script></body></html>`);
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log("✅ TradeMind Pro running on http://localhost:" + PORT));

