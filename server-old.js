require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const app = express();
app.use(express.json());

const db = new sqlite3.Database('trademind.db');
const JWT_SECRET = process.env.JWT_SECRET || 'secret-key';

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, tier TEXT DEFAULT 'free', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, strategy TEXT, status TEXT DEFAULT 'inactive', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS brokers (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, api_key TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL, currency TEXT, method TEXT, status TEXT, tier TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

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

app.get('/api/user/profile', authMiddleware, (req, res) => {
  db.get('SELECT id, username, tier FROM users WHERE id = ?', [req.user.user_id], (err, user) => {
    res.json(user);
  });
});

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

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TradeMind Pro</title><style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;}.container{background:white;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,0.3);width:90%;max-width:500px;padding:40px;}h1{color:#333;margin-bottom:30px;text-align:center;}h3{color:#667eea;margin-top:20px;margin-bottom:10px;}.tabs{display:flex;gap:10px;margin-bottom:20px;}.tab-btn{flex:1;padding:10px;border:none;background:#eee;cursor:pointer;border-radius:5px;font-weight:600;}.tab-btn.active{background:#667eea;color:white;}.tab-content{display:none;}.tab-content.active{display:block;}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ddd;border-radius:5px;}button{width:100%;padding:10px;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:600;margin-top:10px;}button:hover{background:#764ba2;}.price-card{border:1px solid #ddd;padding:15px;margin:10px 0;border-radius:5px;}.price-card h3{color:#667eea;margin-bottom:10px;}.price-card p{color:#666;margin:5px 0;font-size:14px;}.success{color:green;margin:10px 0;font-weight:600;}.error{color:red;margin:10px 0;font-weight:600;}</style></head><body><div class="container"><h1>🚀 TradeMind Pro</h1><div class="tabs"><button class="tab-btn active" onclick="showTab(this, 'auth')">Auth</button><button class="tab-btn" onclick="showTab(this, 'dashboard')">Dashboard</button><button class="tab-btn" onclick="showTab(this, 'payments')">Payments</button></div><div id="auth" class="tab-content active"><h3>Signup / Login</h3><input type="text" id="username" placeholder="Username"><input type="password" id="password" placeholder="Password"><button onclick="signup()">Signup</button><button onclick="login()">Login</button><p id="authMsg"></p></div><div id="dashboard" class="tab-content"><h3>Your Profile</h3><p id="profileMsg">Login to see profile</p><h3>Your Bots</h3><input type="text" id="botName" placeholder="Bot name"><input type="text" id="botStrategy" placeholder="Strategy"><button onclick="createBot()">Create Bot</button><div id="botsList"></div></div><div id="payments" class="tab-content"><h3>Subscription Plans</h3><div class="price-card"><h3>Starter - $29/mo</h3><p>3 bots, 2 brokers</p><button onclick="buyPayPal('starter')">Buy with PayPal</button><button onclick="buyPayMongo('starter')">Buy with GCash</button></div><div class="price-card"><h3>Premium - $99/mo</h3><p>10 bots, unlimited brokers</p><button onclick="buyPayPal('premium')">Buy with PayPal</button><button onclick="buyPayMongo('premium')">Buy with GCash</button></div><div class="price-card"><h3>Unlimited - $199/mo</h3><p>Unlimited bots, unlimited brokers</p><button onclick="buyPayPal('unlimited')">Buy with PayPal</button><button onclick="buyPayMongo('unlimited')">Buy with GCash</button></div><p id="paymentMsg"></p></div></div><script>const API=window.location.origin;let token=localStorage.getItem('token');function showTab(btn, tab){document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.getElementById(tab).classList.add('active');btn.classList.add('active');}async function signup(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;const res=await fetch(API+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await res.json();if(data.token){localStorage.setItem('token',data.token);token=data.token;document.getElementById('authMsg').innerHTML='<p class="success">Signup successful!</p>';}else{document.getElementById('authMsg').innerHTML='<p class="error">'+data.error+'</p>';}}async function login(){const username=document.getElementById('username').value;const password=document.getElementById('password').value;const res=await fetch(API+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const data=await res.json();if(data.token){localStorage.setItem('token',data.token);token=data.token;loadProfile();document.getElementById('authMsg').innerHTML='<p class="success">Login successful!</p>';}else{document.getElementById('authMsg').innerHTML='<p class="error">'+data.error+'</p>';}}async function loadProfile(){const res=await fetch(API+'/api/user/profile',{headers:{Authorization:'Bearer '+token}});const user=await res.json();document.getElementById('profileMsg').innerHTML='<p>Username: '+user.username+'<br>Tier: '+user.tier+'</p>';}async function createBot(){const name=document.getElementById('botName').value;const strategy=document.getElementById('botStrategy').value;const res=await fetch(API+'/api/bots',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name,strategy})});const bot=await res.json();document.getElementById('botName').value='';document.getElementById('botStrategy').value='';loadBots();}async function loadBots(){const res=await fetch(API+'/api/bots',{headers:{Authorization:'Bearer '+token}});const bots=await res.json();document.getElementById('botsList').innerHTML=bots.map(b=>'<p>'+b.name+' ('+b.strategy+')</p>').join('');}async function buyPayPal(tier){if(!token)return document.getElementById('paymentMsg').innerHTML='<p class="error">Login first</p>';const res=await fetch(API+'/api/payments/paypal/create-order',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({tier})});const data=await res.json();window.location.href='https://www.sandbox.paypal.com/checkoutnow?token='+data.order_id;}async function buyPayMongo(tier){if(!token)return document.getElementById('paymentMsg').innerHTML='<p class="error">Login first</p>';const res=await fetch(API+'/api/payments/paymongo/create-checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({tier})});const data=await res.json();window.location.href=data.checkout_url;}</script></body></html>`);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
