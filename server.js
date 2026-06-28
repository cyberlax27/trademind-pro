const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(cors());
app.use(express.json());

let db = new sqlite3.Database("trademind.db", (err) => {
  if (err) console.log("DB: " + err.message);
  else {
    console.log("Database connected");
    db.serialize(() => {
      db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, password TEXT, name TEXT, subscription_tier TEXT DEFAULT 'free')");
      db.run("CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, symbol TEXT, strategy TEXT, broker TEXT, status TEXT DEFAULT 'paused')");
      db.run("CREATE TABLE IF NOT EXISTS brokers (id INTEGER PRIMARY KEY, user_id INTEGER, broker_name TEXT, account_id TEXT, account_type TEXT, balance REAL DEFAULT 0)");
    });
  }
});

const JWT_SECRET = "your-secret-key-2024";

function auth(req, res, next) {
  const token = req.headers.authorization && req.headers.authorization.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>TradeMind Pro</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial;background:#f5f5f5}.auth{display:flex;justify-content:center;align-items:center;min-height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}.auth-box{background:white;padding:40px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.2);width:100%;max-width:400px}.auth-box h1{color:#333;text-align:center;margin-bottom:5px}.auth-box p{color:#666;text-align:center;margin-bottom:30px}.form-group{margin-bottom:15px}.form-group label{display:block;color:#333;margin-bottom:5px;font-size:14px;font-weight:500}.form-group input{width:100%;padding:10px;border:1px solid #ddd;border-radius:5px;font-size:14px}.form-group input:focus{outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,0.1)}.btn{width:100%;padding:10px;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer;font-size:16px;font-weight:500}.btn:hover{background:#5568d3}.btn-secondary{background:#6c757d}.btn-secondary:hover{background:#5a6268}.btn-small{padding:8px 12px;font-size:14px}.btn-success{background:#28a745}.link-text{text-align:center;margin-top:15px;font-size:14px;color:#666}.link-text a{color:#667eea;cursor:pointer;text-decoration:underline}.dashboard{display:none;min-height:100vh;background:#f5f5f5;flex-direction:column}.dashboard.active{display:flex}.header{background:white;padding:20px 30px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 5px rgba(0,0,0,0.1)}.header h1{color:#333}.header-right{display:flex;gap:20px;align-items:center}.user-info{text-align:right}.user-info p{color:#666;font-size:14px}.user-info strong{color:#333}.nav-tabs{background:white;padding:0 30px;display:flex;gap:10px;border-bottom:1px solid #ddd}.nav-tabs button{padding:15px 20px;background:none;border:none;cursor:pointer;color:#666;border-bottom:3px solid transparent;transition:all 0.3s}.nav-tabs button.active{color:#667eea;border-bottom-color:#667eea}.main-content{padding:30px;flex:1;overflow-y:auto}.page{display:none}.page.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px;margin-bottom:30px}.card{background:white;padding:25px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}.card h3{color:#333;font-size:14px;margin-bottom:10px;text-transform:uppercase}.card .metric{font-size:32px;font-weight:bold;color:#667eea}.card .subtext{color:#999;font-size:12px;margin-top:5px}.section{background:white;padding:25px;border-radius:8px;box-shadow:0 2px 5px rgba(0,0,0,0.1);margin-bottom:20px}.section h2{color:#333;margin-bottom:20px}.table{width:100%;border-collapse:collapse}.table thead{background:#f5f5f5}.table th{padding:12px;text-align:left;color:#333;font-weight:500;border-bottom:1px solid #ddd}.table td{padding:12px;border-bottom:1px solid #ddd}.table tbody tr:hover{background:#f9f9f9}.badge{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:500}.badge-active{background:#d4edda;color:#155724}.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:20px}.pricing-card{background:white;padding:20px;border-radius:8px;border:2px solid #ddd;text-align:center}.pricing-card h3{color:#333;margin-bottom:10px}.pricing-card .price{font-size:28px;color:#667eea;font-weight:bold;margin:10px 0}.pricing-card .features{text-align:left;color:#666;font-size:14px;margin:15px 0}.pricing-card .features li{margin:5px 0}.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;justify-content:center;align-items:center}.modal.active{display:flex}.modal-content{background:white;padding:30px;border-radius:10px;max-width:500px;width:90%}.modal-content h2{margin-bottom:20px}.modal-close{float:right;cursor:pointer;font-size:20px;color:#999}</style></head><body><div class="auth" id="authPage"><div class="auth-box"><h1>TradeMind Pro</h1><p>Forex Trading Bot SaaS</p><div id="loginForm"><div class="form-group"><label>Email</label><input type="email" id="loginEmail" placeholder="your@email.com"></div><div class="form-group"><label>Password</label><input type="password" id="loginPassword" placeholder="Password"></div><button class="btn" onclick="handleLogin()">Login</button><div class="link-text">No account? <a onclick="showSignup()">Sign Up</a></div></div><div id="signupForm" style="display:none"><div class="form-group"><label>Full Name</label><input type="text" id="signupName" placeholder="Your Name"></div><div class="form-group"><label>Email</label><input type="email" id="signupEmail" placeholder="your@email.com"></div><div class="form-group"><label>Password</label><input type="password" id="signupPassword" placeholder="Password"></div><button class="btn" onclick="handleSignup()">Sign Up</button><div class="link-text">Have account? <a onclick="showLogin()">Login</a></div></div></div></div><div class="dashboard" id="dashboard"><div class="header"><h1>TradeMind Pro Dashboard</h1><div class="header-right"><div class="user-info"><p>Welcome, <strong id="userName">User</strong></p><p id="userTier" style="font-size:12px;color:#999;"></p></div><button class="btn btn-secondary btn-small" onclick="handleLogout()">Logout</button></div></div><div class="nav-tabs"><button class="active" onclick="switchPage('overview')">Overview</button><button onclick="switchPage('bots')">Bots</button><button onclick="switchPage('brokers')">Brokers</button><button onclick="switchPage('pricing')">Subscription</button><button onclick="switchPage('settings')">Settings</button></div><div class="main-content"><div class="page active" id="page-overview"><div class="grid"><div class="card"><h3>Portfolio Value</h3><div class="metric" id="portfolioValue">$0.00</div><div class="subtext">Total balance</div></div><div class="card"><h3>Active Bots</h3><div class="metric" id="activeBots">0</div><div class="subtext">Running bots</div></div><div class="card"><h3>Win Rate</h3><div class="metric" id="winRate">0%</div><div class="subtext">Average</div></div><div class="card"><h3>Total P&L</h3><div class="metric" id="totalPL" style="color:#28a745">+$0.00</div><div class="subtext">Profit/Loss</div></div></div><div class="section"><h2>Recent Activity</h2><p style="color:#999">No activity yet. Create a bot to get started!</p></div></div><div class="page" id="page-bots"><div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2>Your Bots</h2><button class="btn btn-success btn-small" onclick="showBotModal()">Create Bot</button></div><table class="table"><thead><tr><th>Name</th><th>Symbol</th><th>Strategy</th><th>Status</th><th>Action</th></tr></thead><tbody id="botsList"><tr><td colspan="5" style="text-align:center;color:#999">No bots yet</td></tr></tbody></table></div></div><div class="page" id="page-brokers"><div class="section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2>Connected Brokers</h2><button class="btn btn-success btn-small" onclick="showBrokerModal()">Connect Broker</button></div><table class="table"><thead><tr><th>Broker</th><th>Account ID</th><th>Type</th><th>Balance</th><th>Action</th></tr></thead><tbody id="brokersList"><tr><td colspan="5" style="text-align:center;color:#999">No brokers connected</td></tr></tbody></table></div></div><div class="page" id="page-pricing"><div class="section"><h2>Subscription Plans</h2><p style="color:#666;margin-bottom:30px">Upgrade your plan to unlock more features</p><div class="pricing-grid"><div class="pricing-card"><h3>Free</h3><div class="price">$0</div><div class="features"><strong>Features:</strong><ul><li>? 1 Bot</li><li>? 1 Broker</li></ul></div><button class="btn btn-secondary btn-small" id="freeBtn" onclick="selectPlan('free')">Current Plan</button></div><div class="pricing-card"><h3>Starter</h3><div class="price">$29<span style="font-size:14px">/mo</span></div><div class="features"><strong>Features:</strong><ul><li>? 3 Bots</li><li>? 2 Brokers</li></ul></div><button class="btn btn-small" onclick="selectPlan('starter')">Upgrade</button></div><div class="pricing-card"><h3>Premium</h3><div class="price">$99<span style="font-size:14px">/mo</span></div><div class="features"><strong>Features:</strong><ul><li>? 10 Bots</li><li>? Unlimited Brokers</li></ul></div><button class="btn btn-small" onclick="selectPlan('premium')">Upgrade</button></div><div class="pricing-card"><h3>Unlimited</h3><div class="price">$199<span style="font-size:14px">/mo</span></div><div class="features"><strong>Features:</strong><ul><li>? Unlimited Bots</li><li>? Unlimited Brokers</li></ul></div><button class="btn btn-small" onclick="selectPlan('unlimited')">Upgrade</button></div></div></div></div><div class="page" id="page-settings"><div class="section"><h2>Profile Settings</h2><div class="form-group"><label>Full Name</label><input type="text" id="settingsName" placeholder="Your name"></div><div class="form-group"><label>Email</label><input type="email" id="settingsEmail" placeholder="Email" disabled></div><button class="btn" onclick="saveSettings()">Save Changes</button></div></div></div></div><div class="modal" id="botModal"><div class="modal-content"><span class="modal-close" onclick="closeBotModal()">&times;</span><h2>Create New Bot</h2><div class="form-group"><label>Bot Name</label><input type="text" id="botName" placeholder="My Trading Bot"></div><div class="form-group"><label>Trading Symbol</label><input type="text" id="botSymbol" placeholder="EURUSD"></div><div class="form-group"><label>Strategy</label><select id="botStrategy" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:5px"><option>Trend Following</option><option>Mean Reversion</option><option>Scalping</option></select></div><button class="btn" onclick="createBot()">Create Bot</button></div></div><div class="modal" id="brokerModal"><div class="modal-content"><span class="modal-close" onclick="closeBrokerModal()">&times;</span><h2>Connect Broker</h2><div class="form-group"><label>Select Broker</label><select id="brokerName" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:5px"><option>Exness</option><option>XM</option><option>Doto</option></select></div><div class="form-group"><label>Account ID</label><input type="text" id="brokerAccount" placeholder="Your account ID"></div><div class="form-group"><label>Account Type</label><select id="brokerType" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:5px"><option>Demo</option><option>Live</option></select></div><button class="btn" onclick="connectBroker()">Connect</button></div></div><script>const API=window.location.origin;;let currentUser=null;function showSignup(){document.getElementById("loginForm").style.display="none";document.getElementById("signupForm").style.display="block"}function showLogin(){document.getElementById("signupForm").style.display="none";document.getElementById("loginForm").style.display="block"}async function handleLogin(){const email=document.getElementById("loginEmail").value;const password=document.getElementById("loginPassword").value;const res=await fetch(API+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});const data=await res.json();if(data.token){localStorage.setItem("token",data.token);currentUser=data.user;showDashboard()}else{alert("Login failed")}}async function handleSignup(){const name=document.getElementById("signupName").value;const email=document.getElementById("signupEmail").value;const password=document.getElementById("signupPassword").value;const res=await fetch(API+"/api/auth/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,email,password})});const data=await res.json();if(data.token){localStorage.setItem("token",data.token);currentUser=data.user;showDashboard()}else{alert("Signup failed")}}function showDashboard(){document.getElementById("authPage").style.display="none";document.getElementById("dashboard").classList.add("active");document.getElementById("userName").textContent=currentUser.name;document.getElementById("userTier").textContent="Plan: "+(currentUser.subscription_tier||"Free");loadBots();loadBrokers()}function handleLogout(){localStorage.removeItem("token");currentUser=null;document.getElementById("dashboard").classList.remove("active");document.getElementById("authPage").style.display="flex";showLogin()}function switchPage(page){document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));document.getElementById("page-"+page).classList.add("active");document.querySelectorAll(".nav-tabs button").forEach(b=>b.classList.remove("active"));event.target.classList.add("active")}async function loadBots(){const token=localStorage.getItem("token");const res=await fetch(API+"/api/bots",{headers:{"Authorization":"Bearer "+token}});const bots=await res.json();const tbody=document.getElementById("botsList");if(bots.length===0){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:#999">No bots yet</td></tr>'}else{tbody.innerHTML=bots.map(b=>'<tr><td>'+b.name+'</td><td>'+b.symbol+'</td><td>'+b.strategy+'</td><td><span class="badge badge-active">'+b.status+'</span></td><td><button class="btn btn-secondary btn-small" onclick="deleteBot('+b.id+')">Delete</button></td></tr>').join("")}document.getElementById("activeBots").textContent=bots.filter(b=>b.status==="active").length}async function loadBrokers(){const token=localStorage.getItem("token");const res=await fetch(API+"/api/brokers",{headers:{"Authorization":"Bearer "+token}});const brokers=await res.json();const tbody=document.getElementById("brokersList");if(brokers.length===0){tbody.innerHTML='<tr><td colspan="5" style="text-align:center;color:#999">No brokers connected</td></tr>'}else{tbody.innerHTML=brokers.map(b=>'<tr><td>'+b.broker_name+'</td><td>'+b.account_id+'</td><td>'+b.account_type+'</td><td>$'+(b.balance||0).toLocaleString()+'</td><td><button class="btn btn-secondary btn-small" onclick="disconnectBroker('+b.id+')">Disconnect</button></td></tr>').join("")}}function showBotModal(){document.getElementById("botModal").classList.add("active")}function closeBotModal(){document.getElementById("botModal").classList.remove("active")}async function createBot(){const token=localStorage.getItem("token");const name=document.getElementById("botName").value;const symbol=document.getElementById("botSymbol").value;const strategy=document.getElementById("botStrategy").value;if(!name||!symbol){alert("Fill all fields");return}const res=await fetch(API+"/api/bots",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({name,symbol,strategy,broker:"demo"})});const data=await res.json();if(data.success){closeBotModal();loadBots();alert("Bot created!");document.getElementById("botName").value="";document.getElementById("botSymbol").value=""}}async function deleteBot(id){if(confirm("Delete bot?")){const token=localStorage.getItem("token");await fetch(API+"/api/bots/"+id,{method:"DELETE",headers:{"Authorization":"Bearer "+token}});loadBots()}}function showBrokerModal(){document.getElementById("brokerModal").classList.add("active")}function closeBrokerModal(){document.getElementById("brokerModal").classList.remove("active")}async function connectBroker(){const token=localStorage.getItem("token");const broker_name=document.getElementById("brokerName").value;const account_id=document.getElementById("brokerAccount").value;const account_type=document.getElementById("brokerType").value;if(!account_id){alert("Enter account ID");return}const res=await fetch(API+"/api/brokers",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({broker_name,account_id,account_type})});const data=await res.json();if(data.success){closeBrokerModal();loadBrokers();alert("Broker connected!")}}async function disconnectBroker(id){if(confirm("Disconnect broker?")){const token=localStorage.getItem("token");await fetch(API+"/api/brokers/"+id,{method:"DELETE",headers:{"Authorization":"Bearer "+token}});loadBrokers()}}function selectPlan(plan){alert("Plan selected: "+plan+". Payment integration coming soon!")}function saveSettings(){alert("Settings saved!")}window.addEventListener("load",()=>{const token=localStorage.getItem("token");if(token){fetch(API+"/api/user/profile",{headers:{"Authorization":"Bearer "+token}}).then(r=>r.json()).then(data=>{if(data.id){currentUser=data;showDashboard()}})}})</script></body></html>`);
});

app.post("/api/auth/signup", (req, res) => {
  const { email, password, name } = req.body;
  bcrypt.hash(password, 10, (err, hash) => {
    db.run("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", [email, hash, name], function(err) {
      if (err) return res.status(400).json({ error: "Email exists" });
      const token = jwt.sign({ id: this.lastID, email }, JWT_SECRET, { expiresIn: "30d" });
      res.json({ token, user: { id: this.lastID, email, name, subscription_tier: "free" } });
    });
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Invalid" });
    bcrypt.compare(password, user.password, (err, match) => {
      if (!match) return res.status(401).json({ error: "Invalid" });
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, subscription_tier: user.subscription_tier } });
    });
  });
});

app.get("/api/user/profile", auth, (req, res) => {
  db.get("SELECT id, email, name, subscription_tier FROM users WHERE id = ?", [req.user.id], (err, user) => {
    if (!user) return res.status(404).json({ error: "Not found" });
    res.json(user);
  });
});

app.get("/api/bots", auth, (req, res) => {
  db.all("SELECT * FROM bots WHERE user_id = ?", [req.user.id], (err, bots) => {
    res.json(bots || []);
  });
});

app.post("/api/bots", auth, (req, res) => {
  const { name, symbol, strategy, broker } = req.body;
  db.run("INSERT INTO bots (user_id, name, symbol, strategy, broker) VALUES (?, ?, ?, ?, ?)", [req.user.id, name, symbol, strategy, broker], function(err) {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete("/api/bots/:id", auth, (req, res) => {
  db.run("DELETE FROM bots WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err) => {
    res.json({ success: true });
  });
});

app.get("/api/brokers", auth, (req, res) => {
  db.all("SELECT * FROM brokers WHERE user_id = ?", [req.user.id], (err, brokers) => {
    res.json(brokers || []);
  });
});

app.post("/api/brokers", auth, (req, res) => {
  const { broker_name, account_id, account_type } = req.body;
  db.run("INSERT INTO brokers (user_id, broker_name, account_id, account_type) VALUES (?, ?, ?, ?)", [req.user.id, broker_name, account_id, account_type], function(err) {
    if (err) return res.status(400).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

app.delete("/api/brokers/:id", auth, (req, res) => {
  db.run("DELETE FROM brokers WHERE id = ? AND user_id = ?", [req.params.id, req.user.id], (err) => {
    res.json({ success: true });
  });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(5000, () => {
  console.log("");
  console.log("=================================");
  console.log("TradeMind Pro RUNNING");
  console.log("Frontend: http://localhost:5000");
  console.log("=================================");
  console.log("");
});
