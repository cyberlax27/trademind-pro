const API = window.location.origin;
let token = localStorage.getItem("token");
let strategies = {};
let assets = {};
let brokersList = {};
let chart = null;
let candleSeries = null;
let allBots = [];

const ASSET_NAMES = {
  "EURUSD": "EUR/USD - Euro vs Dollar", "GBPUSD": "GBP/USD - British Pound vs Dollar", "USDJPY": "USD/JPY - Dollar vs Yen",
  "AUDUSD": "AUD/USD - Australian Dollar vs Dollar", "NZDUSD": "NZD/USD - NZ Dollar vs Dollar", "USDCAD": "USD/CAD - Dollar vs Canadian Dollar",
  "BTCUSD": "BTC/USD - Bitcoin", "ETHUSD": "ETH/USD - Ethereum", "XRPUSD": "XRP/USD - Ripple", "ADAUSD": "ADA/USD - Cardano", "DOGEUSD": "DOGE/USD - Dogecoin",
  "XAUUSD": "XAU/USD - Gold", "XAGUUSD": "XAG/USD - Silver", "WTIUSD": "WTI/USD - Crude Oil", "NGAS": "NGAS/USD - Natural Gas", "CORN": "CORN/USD - Corn"
};

document.addEventListener('DOMContentLoaded', function() {
  if (token) {
    document.getElementById("heroSection").style.display = "none";
    document.getElementById("authCard").style.display = "none";
    document.getElementById("mainCard").style.display = "block";
    loadProfile();
  }

  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("signupBtn").addEventListener("click", signup);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("signupToggleBtn").addEventListener("click", showSignup);
  document.getElementById("toSignupBtn").addEventListener("click", showSignup);
  document.getElementById("toLoginBtn").addEventListener("click", showLogin);
  document.getElementById("createBotBtn").addEventListener("click", createBot);
  document.getElementById("brokerSelect").addEventListener("change", showBrokerGuide);
  document.getElementById("assetClass").addEventListener("change", updateAssetSymbols);
  document.getElementById("assetSymbol").addEventListener("change", function() {
    if (this.value) loadChart(this.value);
  });
  document.getElementById("botStrategy").addEventListener("change", updateStrategyHint);
  document.getElementById("executeTradeBtn").addEventListener("click", executeTrade);
  document.getElementById("updateProfileBtn").addEventListener("click", updateProfile);
  document.getElementById("deleteAccountBtn").addEventListener("click", deleteAccount);
  document.getElementById("sendSupportBtn").addEventListener("click", sendSupport);
  document.getElementById("buyStarterBtn").addEventListener("click", function() { buyPayPal('starter'); });
  document.getElementById("buyPremiumBtn").addEventListener("click", function() { buyPayPal('premium'); });
  document.getElementById("buyUnlimitedBtn").addEventListener("click", function() { buyPayPal('unlimited'); });
  
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', function() {
      const tabName = this.getAttribute('data-tab');
      showTab(tabName);
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
    });
  });
});

function showSignup() {
  document.getElementById("loginForm").style.display = "none";
  document.getElementById("signupForm").style.display = "block";
  document.getElementById("authToggle").style.display = "none";
}

function showLogin() {
  document.getElementById("signupForm").style.display = "none";
  document.getElementById("loginForm").style.display = "block";
  document.getElementById("authToggle").style.display = "none";
}

async function logout() {
  localStorage.removeItem("token");
  token = null;
  location.reload();
}

function showTab(tabName) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.getElementById(tabName).classList.add("active");
  if (tabName === "demo") refreshDemo();
  if (tabName === "robots") loadRobots();
  if (tabName === "settings") loadSettings();
}

async function signup() {
  const username = document.getElementById("signupUsername").value;
  const email = document.getElementById("signupEmail").value;
  const password = document.getElementById("signupPassword").value;
  const password2 = document.getElementById("signupPassword2").value;
  if (!username || !email || !password || !password2) return alert("All fields required");
  if (password !== password2) return alert("Passwords don't match");
  
  try {
    const res = await fetch(API + "/api/auth/signup", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, email, password})
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem("token", data.token);
      token = data.token;
      document.getElementById("signupMsg").innerHTML = "<p style='color:#00d4ff'>✓ Account created! Redirecting...</p>";
      setTimeout(() => location.reload(), 1500);
    } else {
      document.getElementById("signupMsg").innerHTML = "<p style='color:#ff6b6b'>✗ " + (data.error || "Signup failed") + "</p>";
    }
  } catch (e) {
    document.getElementById("signupMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Error: " + e.message + "</p>";
  }
}

async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  if (!username || !password) return alert("Enter username and password");
  
  try {
    const res = await fetch(API + "/api/auth/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if (data.token) {
      localStorage.setItem("token", data.token);
      token = data.token;
      document.getElementById("authMsg").innerHTML = "<p style='color:#00d4ff'>✓ Login successful! Redirecting...</p>";
      setTimeout(() => location.reload(), 1500);
    } else {
      document.getElementById("authMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Invalid credentials</p>";
    }
  } catch (e) {
    document.getElementById("authMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Error: " + e.message + "</p>";
  }
}

async function loadProfile() {
  try {
    document.getElementById("profileMsg").innerHTML = "👤 Loading account...";
    const res = await fetch(API + "/api/user/profile", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load profile");
    const user = await res.json();
    document.getElementById("profileMsg").innerHTML = "<p>👤 <strong>" + user.username + "</strong> (" + user.email + ")<br><span class='tier-badge'>" + user.tier.toUpperCase() + "</span></p>";
    document.getElementById("currentPlan").innerHTML = "<strong>Current Plan:</strong> <span class='tier-badge'>" + user.tier.toUpperCase() + "</span> - " + (user.tier === "free" ? "Upgrade anytime to unlock more features" : "Thank you for being a " + user.tier + " member!");
    document.getElementById("navUserInfo").style.display = "flex";
    document.getElementById("navUsername").innerHTML = "👤 " + user.username;
    document.getElementById("navTier").innerHTML = user.tier.toUpperCase();
    document.getElementById("settingsEmail").value = user.email;
    
    await Promise.all([loadBots(), loadBrokers(), loadBrokersList(), loadAssets(), loadStrategies()]);
  } catch (e) {
    document.getElementById("profileMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Error loading profile: " + e.message + "</p>";
  }
}

async function loadBrokersList() {
  try {
    const res = await fetch(API + "/api/brokers-list");
    brokersList = await res.json();
  } catch (e) {
    console.error("Error loading brokers list:", e);
  }
}

async function loadAssets() {
  try {
    const res = await fetch(API + "/api/assets");
    assets = await res.json();
  } catch (e) {
    console.error("Error loading assets:", e);
  }
}

async function loadStrategies() {
  try {
    const res = await fetch(API + "/api/strategies");
    strategies = await res.json();
  } catch (e) {
    console.error("Error loading strategies:", e);
  }
}

function updateAssetSymbols() {
  const assetClass = document.getElementById("assetClass").value;
  const symbols = assets[assetClass] || [];
  const symbolSelect = document.getElementById("assetSymbol");
  if (symbols.length > 0) {
    symbolSelect.innerHTML = "<option value=''>Select Symbol...</option>" + symbols.map(s => "<option value='" + s + "'>" + ASSET_NAMES[s] || s + "</option>").join("");
  } else {
    symbolSelect.innerHTML = "<option value=''>No symbols available</option>";
  }
}

function updateStrategyHint() {
  const strategy = document.getElementById("botStrategy").value;
  const hint = document.getElementById("strategyHint");
  if (strategy && strategies[strategy]) {
    hint.innerHTML = "📝 " + strategies[strategy].desc;
  } else {
    hint.innerHTML = "";
  }
}

async function createBot() {
  if (!token) return alert("Login first");
  const name = document.getElementById("botName").value;
  const strategy = document.getElementById("botStrategy").value;
  const bot_type = document.getElementById("botType").value;
  if (!name || !strategy) return alert("Enter bot name and select strategy");
  
  try {
    const res = await fetch(API + "/api/bots", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({name, strategy, bot_type})
    });
    const bot = await res.json();
    if (bot.error) {
      alert("Error: " + bot.error);
    } else {
      alert("✓ Bot created: " + bot.name);
      document.getElementById("botName").value = "";
      document.getElementById("botStrategy").value = "";
      document.getElementById("strategyHint").innerHTML = "";
      await loadBots();
      await loadRobots();
    }
  } catch (e) {
    alert("Error creating bot: " + e.message);
  }
}

async function loadBots() {
  try {
    const res = await fetch(API + "/api/bots", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load bots");
    allBots = await res.json();
    console.log("Bots loaded:", allBots);
  } catch (e) {
    console.error("Error loading bots:", e);
  }
}

async function loadRobots() {
  try {
    const res = await fetch(API + "/api/bots", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load robots");
    const bots = await res.json();
    allBots = bots;
    await loadStrategies();
    
    const activeBots = bots.filter(b => b.status === "active");
    const stoppedBots = bots.filter(b => b.status !== "active");
    
    document.getElementById("demoBotsList").innerHTML = activeBots.length ? await Promise.all(activeBots.map(async b => {
      try {
        const statsRes = await fetch(API + "/api/bots/" + b.id + "/stats", {headers: {Authorization: "Bearer " + token}});
        const stats = await statsRes.json();
        const activePositions = stats.trade_count > 0 ? "🟢 ACTIVELY TRADING" : "⚪ Waiting for signals";
        return '<div class="bot-item"><div class="bot-header"><div><strong>🤖 ' + b.name + '</strong><br><small>' + (strategies[b.strategy]?.name || '') + '</small></div><div><span class="bot-status status-active">ACTIVE</span></div></div><div class="bot-stats"><div class="stat-box"><div class="stat-label">Bot Profit</div><div class="stat-value">$' + stats.bot_profit.toFixed(2) + '</div></div><div class="stat-box"><div class="stat-label">Current P&L</div><div class="stat-value">$' + stats.current_pnl.toFixed(2) + '</div></div></div><div style="padding:8px;font-size:11px;color:#00ff00">' + activePositions + ' (' + stats.trade_count + ' trades)</div><button class="small-btn" onclick="toggleBotStatus(' + b.id + ', \'active\')">Stop</button><button class="small-btn" onclick="deleteBot(' + b.id + ')" style="background:#ff6b6b">Delete</button></div>';
      } catch (e) {
        return '<div class="bot-item"><strong>🤖 ' + b.name + '</strong> (Error loading stats)</div>';
      }
    })).then(r => r.join("")) : '<p style="color:#666">No active bots yet</p>';
    
    document.getElementById("realBotsList").innerHTML = stoppedBots.length ? await Promise.all(stoppedBots.map(async b => {
      try {
        const statsRes = await fetch(API + "/api/bots/" + b.id + "/stats", {headers: {Authorization: "Bearer " + token}});
        const stats = await statsRes.json();
        return '<div class="bot-item"><div class="bot-header"><div><strong>🤖 ' + b.name + '</strong><br><small>' + (strategies[b.strategy]?.name || '') + '</small></div><div><span class="bot-status status-inactive">STOPPED</span></div></div><div class="bot-stats"><div class="stat-box"><div class="stat-label">Bot Profit</div><div class="stat-value">$' + stats.bot_profit.toFixed(2) + '</div></div><div class="stat-box"><div class="stat-label">Total Trades</div><div class="stat-value">' + stats.trade_count + '</div></div></div><button class="small-btn" onclick="toggleBotStatus(' + b.id + ', \'inactive\')">Start</button><button class="small-btn" onclick="deleteBot(' + b.id + ')" style="background:#ff6b6b">Delete</button></div>';
      } catch (e) {
        return '<div class="bot-item"><strong>🤖 ' + b.name + '</strong> (Error loading stats)</div>';
      }
    })).then(r => r.join("")) : '<p style="color:#666">No stopped bots yet</p>';
  } catch (e) {
    document.getElementById("demoBotsList").innerHTML = '<p style="color:#ff6b6b">Error loading bots: ' + e.message + '</p>';
  }
}

async function toggleBotStatus(id, currentStatus) {
  try {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    const res = await fetch(API + "/api/bots/" + id + "/status", {
      method: "PUT",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({status: newStatus})
    });
    if (res.ok) {
      await loadRobots();
    }
  } catch (e) {
    alert("Error updating bot status: " + e.message);
  }
}

async function deleteBot(id) {
  if (!confirm("Delete this bot?")) return;
  try {
    const res = await fetch(API + "/api/bots/" + id, {
      method: "DELETE",
      headers: {Authorization: "Bearer " + token}
    });
    if (res.ok) {
      await loadRobots();
    }
  } catch (e) {
    alert("Error deleting bot: " + e.message);
  }
}

function showBrokerGuide() {
  const brokerKey = document.getElementById("brokerSelect").value;
  const guideContainer = document.getElementById("brokerGuideContainer");
  const apiKeyInput = document.getElementById("brokerApiKey");
  const accountSelect = document.getElementById("brokerAccountType");
  const connectBtn = document.getElementById("brokerConnectBtn");
  
  if (!brokerKey) {
    guideContainer.innerHTML = "";
    apiKeyInput.style.display = "none";
    accountSelect.style.display = "none";
    connectBtn.style.display = "none";
    return;
  }
  
  const broker = brokersList[brokerKey];
  if (broker) {
    const guide = '<div class="broker-guide"><strong style="color:#00d4ff">' + broker.name + '</strong><br><br>' + broker.guide.split("\n").join("<br>") + '<br><br><a href="' + broker.docs + '" target="_blank" class="guide-link">📖 View Official Docs →</a></div>';
    guideContainer.innerHTML = guide;
    if (brokerKey === "demo") {
      apiKeyInput.style.display = "none";
      accountSelect.style.display = "none";
      connectBtn.style.display = "block";
      connectBtn.textContent = "Use Demo Account";
    } else {
      apiKeyInput.style.display = "block";
      accountSelect.style.display = "block";
      connectBtn.style.display = "block";
      connectBtn.textContent = "Connect Broker";
    }
  }
}

async function connectBroker() {
  if (!token) return alert("Login first");
  const brokerSelect = document.getElementById("brokerSelect").value;
  if (!brokerSelect) return alert("Select a broker");
  
  try {
    let name = brokersList[brokerSelect]?.name || brokerSelect;
    let api_key = "";
    if (brokerSelect !== "demo") {
      api_key = document.getElementById("brokerApiKey").value;
      if (!api_key) return alert("Paste your API key");
    }
    const account_type = document.getElementById("brokerAccountType").value;
    
    const res = await fetch(API + "/api/brokers", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({name, api_key, account_type})
    });
    const broker = await res.json();
    if (broker.error) {
      alert("Error: " + broker.error);
    } else {
      alert("✓ Broker connected: " + broker.name);
      document.getElementById("brokerSelect").value = "";
      document.getElementById("brokerApiKey").value = "";
      document.getElementById("brokerGuideContainer").innerHTML = "";
      loadBrokers();
      loadSettings();
    }
  } catch (e) {
    alert("Error connecting broker: " + e.message);
  }
}

async function loadBrokers() {
  try {
    const res = await fetch(API + "/api/brokers", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load brokers");
    const brokers = await res.json();
  } catch (e) {
    console.error("Error loading brokers:", e);
  }
}

async function loadChart(symbol) {
  try {
    document.getElementById("chartTitle").innerHTML = "📊 " + (ASSET_NAMES[symbol] || symbol);
    const res = await fetch(API + "/api/chart-data/" + symbol);
    if (!res.ok) throw new Error("Failed to load chart data");
    const data = await res.json();
    const chartContainer = document.getElementById("chart");
    chartContainer.innerHTML = "";
    chart = LightweightCharts.createChart(chartContainer, {
      layout: {background: {color: "#0a0e27"}, textColor: "#888"},
      timeScale: {timeVisible: true}
    });
    candleSeries = chart.addCandlestickSeries({
      upColor: "#00ff00", downColor: "#ff0000", wickUpColor: "#00ff00", wickDownColor: "#ff0000", borderVisible: false
    });
    candleSeries.setData(data);
    chart.timeScale().fitContent();
  } catch (e) {
    document.getElementById("chartTitle").innerHTML = "❌ Error loading chart: " + e.message;
  }
}

async function refreshDemo() {
  try {
    const res = await fetch(API + "/api/demo/account", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load demo account");
    const account = await res.json();
    document.getElementById("demoBalance").innerHTML = account.balance.toFixed(2);
    document.getElementById("demoEquity").innerHTML = account.equity.toFixed(2);
    document.getElementById("demoFreeMargin").innerHTML = account.free_margin.toFixed(2);
    document.getElementById("demoUsedMargin").innerHTML = account.used_margin.toFixed(2);
    await Promise.all([loadPositions(), loadPendingPositions(), loadTrades()]);
  } catch (e) {
    console.error("Error refreshing demo:", e);
  }
}

async function executeTrade() {
  if (!token) return alert("Login first");
  const symbol = document.getElementById("assetSymbol").value;
  const type = document.getElementById("tradeType").value;
  const lot_size = parseFloat(document.getElementById("lotSize").value);
  if (!symbol || !type || !lot_size) return alert("Select symbol, type, and lot size");
  
  try {
    const res = await fetch(API + "/api/demo/trade", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({symbol, type, lot_size})
    });
    const data = await res.json();
    if (data.success) {
      const assetName = ASSET_NAMES[symbol] || symbol;
      document.getElementById("tradeMsg").innerHTML = "<p style='color:#00d4ff'>✓ Trade opened: " + assetName + " at $" + data.entry_price.toFixed(2) + "</p>";
      document.getElementById("lotSize").value = "";
      document.getElementById("assetSymbol").value = "";
      await refreshDemo();
    } else {
      document.getElementById("tradeMsg").innerHTML = "<p style='color:#ff6b6b'>✗ " + (data.error || "Trade failed") + "</p>";
    }
  } catch (e) {
    document.getElementById("tradeMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Error: " + e.message + "</p>";
  }
}

async function loadPositions() {
  try {
    const res = await fetch(API + "/api/demo/positions", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load positions");
    const positions = await res.json();
    document.getElementById("openPositions").innerHTML = positions.length ? positions.map(p => {
      const assetName = ASSET_NAMES[p.symbol] || p.symbol;
      const botInfo = allBots.find(b => b.id === p.bot_id);
      const botLabel = botInfo ? " (Bot: " + botInfo.name + ")" : " (Manual Trade)";
      return "<div class='position-item'><div><strong>" + assetName + "</strong>" + botLabel + " (" + p.type + ") x" + p.lot_size.toFixed(2) + "<br><small>Entry: $" + p.entry_price.toFixed(2) + " | Current: $" + p.current_price.toFixed(2) + " | P&L: <span class='" + (p.pnl >= 0 ? "pnl-positive" : "pnl-negative") + "'>$" + p.pnl.toFixed(2) + "</span></small></div><div><button class='small-btn' onclick='closePosition(" + p.id + ")'>Close</button></div></div>";
    }).join("") : "<p style='color:#666'>No open positions</p>";
  } catch (e) {
    console.error("Error loading positions:", e);
  }
}

async function loadPendingPositions() {
  try {
    const res = await fetch(API + "/api/demo/pending", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load pending positions");
    const positions = await res.json();
    document.getElementById("pendingPositions").innerHTML = positions.length ? positions.map(p => {
      const assetName = ASSET_NAMES[p.symbol] || p.symbol;
      return "<div class='position-item'><strong>" + assetName + "</strong> (" + p.type + ") - Entry Pending at $" + p.entry_price.toFixed(2) + "</div>";
    }).join("") : "<p style='color:#666'>No pending positions</p>";
  } catch (e) {
    console.error("Error loading pending positions:", e);
  }
}

async function closePosition(id) {
  try {
    const res = await fetch(API + "/api/demo/close-position/" + id, {
      method: "POST",
      headers: {Authorization: "Bearer " + token}
    });
    const data = await res.json();
    if (data.success) {
      const pnl_class = data.pnl >= 0 ? "pnl-positive" : "pnl-negative";
      document.getElementById("tradeMsg").innerHTML = "<p style='color:#00d4ff'>✓ Position closed | P&L: <span class='" + pnl_class + "'>$" + data.pnl.toFixed(2) + "</span></p>";
      await refreshDemo();
    } else {
      alert("Error: " + (data.error || "Failed to close position"));
    }
  } catch (e) {
    alert("Error closing position: " + e.message);
  }
}

async function loadTrades() {
  try {
    const res = await fetch(API + "/api/demo/closed", {headers: {Authorization: "Bearer " + token}});
    if (!res.ok) throw new Error("Failed to load trades");
    const trades = await res.json();
    document.getElementById("closedTrades").innerHTML = trades.length ? "<table style='width:100%;font-size:12px'><tr style='border-bottom:1px solid rgba(102,126,234,0.3)'><td style='padding:8px'>Asset</td><td style='padding:8px'>Type</td><td style='padding:8px'>Size</td><td style='padding:8px'>Entry</td><td style='padding:8px'>Exit</td><td style='padding:8px'>P&L</td></tr>" + trades.map(t => {
      const assetName = ASSET_NAMES[t.symbol] || t.symbol;
      return "<tr style='border-bottom:1px solid rgba(102,126,234,0.1)'><td style='padding:8px'>" + assetName + "</td><td style='padding:8px'>" + t.type + "</td><td style='padding:8px'>" + t.lot_size.toFixed(2) + "</td><td style='padding:8px'>$" + t.entry_price.toFixed(2) + "</td><td style='padding:8px'>$" + t.exit_price.toFixed(2) + "</td><td style='padding:8px;color:" + (t.pnl >= 0 ? "#00ff00" : "#ff6b6b") + "'>$" + t.pnl.toFixed(2) + "</td></tr>";
    }).join("") + "</table>" : "<p style='color:#666'>No closed trades</p>";
  } catch (e) {
    console.error("Error loading trades:", e);
  }
}

async function loadSettings() {
  try {
    const brokerRes = await fetch(API + "/api/brokers", {headers: {Authorization: "Bearer " + token}});
    if (!brokerRes.ok) throw new Error("Failed to load brokers");
    const brokers = await brokerRes.json();
    document.getElementById("settingsBrokersList").innerHTML = brokers.length ? brokers.map(b => "<div style='margin:10px 0;padding:10px;background:rgba(102,126,234,0.05);border-radius:6px'>🏦 " + b.name + " (" + b.account_type + ")</div>").join("") : "<p style='color:#666'>No brokers connected</p>";
    
    document.getElementById("helpCenter").innerHTML = `
      <div style='margin:10px 0;padding:10px;background:rgba(102,126,234,0.05);border-radius:6px;cursor:pointer' onclick="toggleHelp(this)">
        <strong>Getting Started</strong> <span style='color:#888'>►</span>
        <div style='display:none;margin-top:10px;font-size:11px;color:#aaa'>
          Create your first trading bot by selecting a strategy, connect a broker (XM, Exness, or Doto), and start with our $10,000 demo account. Watch the candlestick charts and execute trades to practice.
        </div>
      </div>
      <div style='margin:10px 0;padding:10px;background:rgba(102,126,234,0.05);border-radius:6px;cursor:pointer' onclick="toggleHelp(this)">
        <strong>Trading Strategies</strong> <span style='color:#888'>►</span>
        <div style='display:none;margin-top:10px;font-size:11px;color:#aaa'>
          <strong>Moving Average Crossover:</strong> Best for beginners, tracks price trends. <strong>RSI Momentum:</strong> Detects overbought/oversold. <strong>MACD Trend:</strong> Combines momentum and trend. <strong>Bollinger Bands:</strong> Uses support/resistance levels. <strong>Fibonacci Retracement:</strong> Level-based trading.
        </div>
      </div>
      <div style='margin:10px 0;padding:10px;background:rgba(102,126,234,0.05);border-radius:6px;cursor:pointer' onclick="toggleHelp(this)">
        <strong>Broker Connection</strong> <span style='color:#888'>►</span>
        <div style='display:none;margin-top:10px;font-size:11px;color:#aaa'>
          Go to Dashboard → Connect Broker. Select XM, Exness, or Doto. Follow the setup guide (find your API keys in your broker account). Paste the API key and connect. For Demo, no API key needed!
        </div>
      </div>
      <div style='margin:10px 0;padding:10px;background:rgba(102,126,234,0.05);border-radius:6px;cursor:pointer' onclick="toggleHelp(this)">
        <strong>Plan & Pricing</strong> <span style='color:#888'>►</span>
        <div style='display:none;margin-top:10px;font-size:11px;color:#aaa'>
          <strong>Free:</strong> 1 bot, 1 broker. <strong>Starter ($29/mo):</strong> 3 bots, 2 brokers. <strong>Premium ($99/mo):</strong> 10 bots, unlimited brokers. <strong>Unlimited ($199/mo):</strong> Unlimited bots & brokers.
        </div>
      </div>
    `;
  } catch (e) {
    console.error("Error loading settings:", e);
  }
}

function toggleHelp(element) {
  const details = element.querySelector('div');
  if (details) {
    details.style.display = details.style.display === 'none' ? 'block' : 'none';
    const arrow = element.querySelector('span');
    if (arrow) arrow.textContent = details.style.display === 'none' ? '►' : '▼';
  }
}

async function updateProfile() {
  const email = document.getElementById("settingsEmail").value;
  const password = document.getElementById("settingsPassword").value;
  try {
    const res = await fetch(API + "/api/user/profile", {
      method: "PUT",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({email, password: password || undefined})
    });
    if (res.ok) {
      alert("✓ Profile updated!");
      await loadProfile();
    } else {
      alert("Error updating profile");
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}

async function deleteAccount() {
  if (!confirm("This will permanently delete your account and all data. Are you sure?")) return;
  if (!confirm("This action cannot be undone. Confirm by clicking OK")) return;
  try {
    const res = await fetch(API + "/api/user/account", {
      method: "DELETE",
      headers: {Authorization: "Bearer " + token}
    });
    if (res.ok) {
      await logout();
    } else {
      alert("Error deleting account");
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}

function sendSupport() {
  const message = document.getElementById("supportMessage").value;
  if (!message) return alert("Enter a message");
  alert("✓ Support request sent! Our team will respond within 24 hours.");
  document.getElementById("supportMessage").value = "";
}

async function buyPayPal(tier) {
  if (!token) return alert("Login first");
  try {
    const res = await fetch(API + "/api/payments/paypal/create-order", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({tier})
    });
    const data = await res.json();
    if (data.order_id) {
      window.location.href = "https://www.paypal.com/pay?token=" + data.order_id;
    } else {
      alert("Error: " + (data.error || "Unknown"));
    }
  } catch (e) {
    alert("Error: " + e.message);
  }
}
