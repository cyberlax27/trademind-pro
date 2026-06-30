... (keep all previous code from before, just replace this section)

async function executeTrade() {
  if (!token) return alert("Login first");
  const symbol = document.getElementById("assetSymbol").value;
  const type = document.getElementById("tradeType").value;
  const lot_size = parseFloat(document.getElementById("lotSize").value);
  const bot_id = document.getElementById("tradeBot").value || null;
  
  if (!symbol || !type || !lot_size) return alert("Select symbol, type, and lot size");
  
  try {
    const res = await fetch(API + "/api/demo/trade", {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify({symbol, type, lot_size, bot_id: bot_id ? parseInt(bot_id) : null})
    });
    const data = await res.json();
    if (data.success) {
      const assetName = ASSET_NAMES[symbol] || symbol;
      const botName = bot_id ? " → " + allBots.find(b => b.id == bot_id)?.name : " (Manual)";
      document.getElementById("tradeMsg").innerHTML = "<p style='color:#00d4ff'>✓ Trade opened: " + assetName + botName + " at $" + data.entry_price.toFixed(2) + "</p>";
      document.getElementById("lotSize").value = "";
      document.getElementById("assetSymbol").value = "";
      document.getElementById("tradeBot").value = "";
      await refreshDemo();
    } else {
      document.getElementById("tradeMsg").innerHTML = "<p style='color:#ff6b6b'>✗ " + (data.error || "Trade failed") + "</p>";
    }
  } catch (e) {
    document.getElementById("tradeMsg").innerHTML = "<p style='color:#ff6b6b'>✗ Error: " + e.message + "</p>";
  }
}
