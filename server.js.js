require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('.')); // Serve static files (images)

const db = new sqlite3.Database('trademind.db');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key';

// ============ DATABASE SETUP ============
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, tier TEXT DEFAULT 'free', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, strategy TEXT, status TEXT DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS brokers (
    id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, api_key TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, currency TEXT, method TEXT, status TEXT, tier TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ============ AUTH HELPERS ============
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ============ AUTH ROUTES ============
app.post('/api/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash], function(err) {
    if (err) return res.status(400).json({ error: 'User exists' });
    const token = jwt.sign({ user_id: this.lastID, username }, JWT_SECRET);
    res.json({ token, user_id: this.lastID });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ user_id: user.id, username }, JWT_SECRET);
    res.json({ token, user_id: user.id, tier: user.tier });
  });
});

// ============ USER ROUTES ============
app.get('/api/user/profile', authMiddleware, (req, res) => {
  db.get('SELECT id, username, tier FROM users WHERE id = ?', [req.user.user_id], (err, user) => {
    res.json(user);
  });
});

// ============ BOT ROUTES ============
app.get('/api/bots', authMiddleware, (req, res) => {
  db.all('SELECT * FROM bots WHERE user_id = ?', [req.user.user_id], (err, bots) => {
    res.json(bots || []);
  });
});

app.post('/api/bots', authMiddleware, (req, res) => {
  const { name, strategy } = req.body;
  db.run('INSERT INTO bots (user_id, name, strategy) VALUES (?, ?, ?)', [req.user.user_id, name, strategy], function(err) {
    if (err) return res.status(400).json({ error: 'Error creating bot' });
    res.json({ id: this.lastID, name, strategy, status: 'inactive' });
  });
});

app.delete('/api/bots/:id', authMiddleware, (req, res) => {
  db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [req.params.id, req.user.user_id], (err) => {
    res.json({ success: true });
  });
});

// ============ BROKER ROUTES ============
app.get('/api/brokers', authMiddleware, (req, res) => {
  db.all('SELECT id, name FROM brokers WHERE user_id = ?', [req.user.user_id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post('/api/brokers', authMiddleware, (req, res) => {
  const { name, api_key } = req.body;
  db.run('INSERT INTO brokers (user_id, name, api_key) VALUES (?, ?, ?)', [req.user.user_id, name, api_key], function(err) {
    res.json({ id: this.lastID, name });
  });
});

// ============ PAYMENT ROUTES ============
app.post('/api/payments/paypal/create-order', authMiddleware, async (req, res) => {
  const { tier } = req.body;
  const prices = { starter: '29.00', premium: '99.00', unlimited: '199.00' };
  
  try {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    const response = await axios.post('https://api-sandbox.paypal.com/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [{ amount: { currency_code: 'USD', value: prices[tier] } }],
      return_url: 'http://localhost:5000',
      cancel_url: 'http://localhost:5000'
    }, { headers: { Authorization: `Basic ${auth}` } });
    res.json({ order_id: response.data.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/payments/paypal/capture-order', authMiddleware, async (req, res) => {
  const { order_id, tier } = req.body;
  const prices = { starter: 29, premium: 99, unlimited: 199 };
  
  try {
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    await axios.post(`https://api-sandbox.paypal.com/v2/checkout/orders/${order_id}/capture`, {}, 
      { headers: { Authorization: `Basic ${auth}` } });
    
    db.run('UPDATE users SET tier = ? WHERE id = ?', [tier, req.user.user_id]);
    db.run('INSERT INTO payments (user_id, amount, currency, method, status, tier) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.user_id, prices[tier], 'USD', 'paypal', 'completed', tier]);
    
    res.json({ success: true, tier });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/payments/paymongo/create-checkout', authMiddleware, async (req, res) => {
  const { tier } = req.body;
  const prices = { starter: 1500, premium: 4995, unlimited: 9995 };
  
  try {
    const response = await axios.post('https://api.paymongo.com/v1/checkout_sessions', {
      data: {
        attributes: {
          send_email_receipt: false,
          show_payment_details: true,
          line_items: [{ name: `${tier} Plan`, amount: prices[tier] * 100, currency: 'PHP', quantity: 1 }],
          success_url: 'http://localhost:5000',
          cancel_url: 'http://localhost:5000'
        }
      }
    }, { auth: { username: process.env.PAYMONGO_SECRET_KEY } });
    res.json({ checkout_url: response.data.data.attributes.checkout_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/payments/history', authMiddleware, (req, res) => {
  db.all('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC', [req.user.user_id], (err, payments) => {
    res.json(payments || []);
  });
});

// ============ BRANDED HTML WITH LOGOS ============
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TradeMind Pro - Professional Forex Trading Bot</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%);
      min-height: 100vh;
      color: #fff;
    }
    
    .navbar {
      background: rgba(15, 20, 45, 0.95);
      border-bottom: 1px solid rgba(102, 126, 234, 0.3);
      padding: 12px 0;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    }
    
    .navbar-content {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .logo-section {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .logo-img {
      height: 50px;
      width: auto;
      object-fit: contain;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2));
    }
    
    .brand-info h2 {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
      margin: 0;
    }
    
    .brand-info p {
      font-size: 11px;
      color: #888;
      margin: 2px 0 0 0;
    }
    
    .user-info {
      font-size: 12px;
      color: #aaa;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 0 20px;
    }
    
    .hero-section {
      text-align: center;
      padding: 40px 20px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(0, 212, 255, 0.05) 100%);
      border-radius: 15px;
      margin: 30px 0;
      border: 1px solid rgba(102, 126, 234, 0.2);
    }
    
    .hero-logo {
      max-width: 400px;
      height: auto;
      margin: 0 auto 30px;
      filter: drop-shadow(0 4px 12px rgba(0, 212, 255, 0.3));
    }
    
    .hero-title {
      font-size: 36px;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #00d4ff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
    }
    
    .hero-subtitle {
      color: #aaa;
      font-size: 14px;
      margin-bottom: 20px;
    }
    
    .card {
      background: rgba(102, 126, 234, 0.05);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 15px;
      padding: 40px;
      backdrop-filter: blur(10px);
      margin-bottom: 40px;
    }
    
    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 30px;
      border-bottom: 1px solid rgba(102, 126, 234, 0.2);
      flex-wrap: wrap;
    }
    
    .tab-btn {
      padding: 12px 25px;
      border: none;
      background: transparent;
      color: #aaa;
      cursor: pointer;
      font-weight: 600;
      border-bottom: 2px solid transparent;
      transition: all 0.3s;
    }
    
    .tab-btn:hover {
      color: #667eea;
    }
    
    .tab-btn.active {
      color: #00d4ff;
      border-bottom-color: #00d4ff;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
      animation: fadeIn 0.3s;
    }
    
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    
    h3 {
      color: #00d4ff;
      margin-bottom: 20px;
      font-size: 18px;
    }
    
    input {
      width: 100%;
      padding: 12px;
      margin: 10px 0;
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 8px;
      background: rgba(102, 126, 234, 0.05);
      color: #fff;
      font-size: 14px;
    }
    
    input::placeholder {
      color: #666;
    }
    
    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    
    button {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      margin-top: 10px;
      transition: all 0.3s;
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
    }
    
    .price-card {
      border: 1px solid rgba(102, 126, 234, 0.3);
      padding: 25px;
      margin: 15px 0;
      border-radius: 10px;
      background: rgba(102, 126, 234, 0.05);
    }
    
    .price-card h3 {
      color: #00d4ff;
      margin-bottom: 10px;
    }
    
    .price-card p {
      color: #aaa;
      margin: 5px 0;
      font-size: 13px;
    }
    
    .success { color: #00d4ff; margin: 10px 0; font-weight: 600; }
    .error { color: #ff6b6b; margin: 10px 0; font-weight: 600; }
    
    .profile-info {
      background: rgba(0, 212, 255, 0.05);
      padding: 15px;
      border-radius: 8px;
      border-left: 3px solid #00d4ff;
      margin-bottom: 20px;
    }
    
    .profile-info p {
      color: #aaa;
      margin: 5px 0;
    }
    
    .bots-list {
      margin-top: 20px;
    }
    
    .bot-item {
      background: rgba(102, 126, 234, 0.1);
      padding: 12px;
      margin: 10px 0;
      border-radius: 6px;
      border-left: 3px solid #667eea;
      color: #ccc;
      font-size: 13px;
    }
    
    .tier-badge {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      margin-left: 10px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="navbar">
    <div class="navbar-content">
      <div class="logo-section">
        <img src="logo-clean.png" alt="TradeMind Pro" class="logo-img" onerror="this.style.display='none'">
        <div class="brand-info">
          <h2>TradeMind Pro</h2>
          <p>Forex Trading Bot Platform</p>
        </div>
      </div>
      <div id="navUserInfo" style="text-align: right; display: none;">
        <div class="user-info" id="navUsername">Loading...</div>
        <div class="tier-badge" id="navTier">free</div>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="hero-section" id="heroSection">
      <img src="logo-community.png" alt="TradeMind Pro Community" class="hero-logo" onerror="this.style.display='none'">
      <h1 class="hero-title">Welcome to TradeMind Pro</h1>
      <p class="hero-subtitle">Professional Forex Trading Bot Platform</p>
      <p style="color: #888; font-size: 12px;">Automate your trading with advanced bots and multiple broker connections</p>
    </div>

    <div class="card">
      <div class="tabs">
        <button class="tab-btn active" onclick="showTab(this, 'auth')">Authentication</button>
        <button class="tab-btn" onclick="showTab(this, 'dashboard')">Dashboard</button>
        <button class="tab-btn" onclick="showTab(this, 'payments')">Subscription</button>
      </div>

      <!-- AUTH TAB -->
      <div id="auth" class="tab-content active">
        <h3>Login / Sign Up</h3>
        <input type="text" id="username" placeholder="Username">
        <input type="password" id="password" placeholder="Password">
        <button onclick="signup()">Create Account</button>
        <button onclick="login()">Login</button>
        <p id="authMsg"></p>
      </div>

      <!-- DASHBOARD TAB -->
      <div id="dashboard" class="tab-content">
        <h3>Your Account</h3>
        <div class="profile-info">
          <p id="profileMsg">👤 Login to view your profile</p>
        </div>
        
        <h3>Trading Bots</h3>
        <input type="text" id="botName" placeholder="Bot name (e.g., TrendBot)">
        <input type="text" id="botStrategy" placeholder="Strategy (e.g., MovingAverage)">
        <button onclick="createBot()">Create Bot</button>
        <div class="bots-list" id="botsList"></div>
      </div>

      <!-- PAYMENTS TAB -->
      <div id="payments" class="tab-content">
        <h3>Subscription Plans</h3>
        <div class="price-card">
          <h3>Starter - \$29/month</h3>
          <p>✓ 3 Trading Bots</p>
          <p>✓ 2 Broker Connections</p>
          <p>✓ Basic Support</p>
          <button onclick="buyPayPal('starter')">Pay with PayPal/Card</button>
          <button onclick="buyPayMongo('starter')">Pay with GCash/PayMaya</button>
        </div>
        
        <div class="price-card">
          <h3>Premium - \$99/month</h3>
          <p>✓ 10 Trading Bots</p>
          <p>✓ Unlimited Brokers</p>
          <p>✓ Priority Support</p>
          <button onclick="buyPayPal('premium')">Pay with PayPal/Card</button>
          <button onclick="buyPayMongo('premium')">Pay with GCash/PayMaya</button>
        </div>
        
        <div class="price-card">
          <h3>Unlimited - \$199/month</h3>
          <p>✓ Unlimited Bots</p>
          <p>✓ Unlimited Brokers</p>
          <p>✓ 24/7 Premium Support</p>
          <button onclick="buyPayPal('unlimited')">Pay with PayPal/Card</button>
          <button onclick="buyPayMongo('unlimited')">Pay with GCash/PayMaya</button>
        </div>
        <p id="paymentMsg"></p>
      </div>
    </div>
  </div>

  <script>
    const API = window.location.origin;
    let token = localStorage.getItem('token');

    if (token) {
      document.getElementById('heroSection').style.display = 'none';
      loadProfile();
    }

    function showTab(btn, tab) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById(tab).classList.add('active');
      btn.classList.add('active');
    }

    async function signup() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      if (!username || !password) return alert('Enter username and password');
      
      const res = await fetch(API + '/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (data.token) {
        localStorage.setItem('token', data.token);
        token = data.token;
        document.getElementById('authMsg').innerHTML = '<p class="success">✓ Account created! Redirecting...</p>';
        setTimeout(() => location.reload(), 1500);
      } else {
        document.getElementById('authMsg').innerHTML = '<p class="error">✗ ' + (data.error || 'Error') + '</p>';
      }
    }

    async function login() {
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      if (!username || !password) return alert('Enter username and password');
      
      const res = await fetch(API + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (data.token) {
        localStorage.setItem('token', data.token);
        token = data.token;
        document.getElementById('authMsg').innerHTML = '<p class="success">✓ Login successful! Redirecting...</p>';
        setTimeout(() => location.reload(), 1500);
      } else {
        document.getElementById('authMsg').innerHTML = '<p class="error">✗ Invalid credentials</p>';
      }
    }

    async function loadProfile() {
      const res = await fetch(API + '/api/user/profile', { headers: { Authorization: 'Bearer ' + token } });
      const user = await res.json();
      document.getElementById('profileMsg').innerHTML = '<p>👤 <strong>' + user.username + '</strong><span class="tier-badge">' + user.tier + '</span></p>';
      document.getElementById('navUserInfo').style.display = 'block';
      document.getElementById('navUsername').innerHTML = '👤 ' + user.username;
      document.getElementById('navTier').innerHTML = user.tier.toUpperCase();
      loadBots();
    }

    async function createBot() {
      if (!token) return alert('Login first');
      const name = document.getElementById('botName').value;
      const strategy = document.getElementById('botStrategy').value;
      if (!name || !strategy) return alert('Enter bot name and strategy');
      
      const res = await fetch(API + '/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ name, strategy })
      });
      const bot = await res.json();
      document.getElementById('botName').value = '';
      document.getElementById('botStrategy').value = '';
      loadBots();
    }

    async function loadBots() {
      const res = await fetch(API + '/api/bots', { headers: { Authorization: 'Bearer ' + token } });
      const bots = await res.json();
      document.getElementById('botsList').innerHTML = bots.length ? 
        bots.map(b => '<div class="bot-item">🤖 ' + b.name + ' <em>(' + b.strategy + ')</em></div>').join('') :
        '<p style="color:#666; margin-top:10px;">No bots yet. Create one above!</p>';
    }

    async function buyPayPal(tier) {
      if (!token) return document.getElementById('paymentMsg').innerHTML = '<p class="error">✗ Login first</p>';
      const res = await fetch(API + '/api/payments/paypal/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ tier })
      });
      const data = await res.json();
      if (data.order_id) {
        window.location.href = 'https://www.sandbox.paypal.com/checkoutnow?token=' + data.order_id;
      } else {
        document.getElementById('paymentMsg').innerHTML = '<p class="error">✗ Error creating order</p>';
      }
    }

    async function buyPayMongo(tier) {
      if (!token) return document.getElementById('paymentMsg').innerHTML = '<p class="error">✗ Login first</p>';
      const res = await fetch(API + '/api/payments/paymongo/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ tier })
      });
      const data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        document.getElementById('paymentMsg').innerHTML = '<p class="error">✗ Error creating checkout</p>';
      }
    }
  </script>
</body>
</html>`);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ TradeMind Pro running on http://localhost:${PORT}`));
