/**
 * 🚀 Volumen-369 Trading Bot - Cloudflare Worker
 * Versión Ultra-Estable
 */

// --- CONFIGURACIÓN POR DEFECTO ---
const DEFAULT_TOP_N = 10;
const DEFAULT_USD_PER_TRADE = 50;

// --- GESTIÓN DE PETICIONES ---
async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Endpoint de prueba rápido
  if (url.pathname === "/ping") {
    return new Response("pong", { status: 200 });
  }

  // Lógica de Proxy
  const targetUrl = url.searchParams.get("target");
  if (targetUrl) {
    return await handleProxy(request, targetUrl);
  }

  // Endpoints de API y Dashboard
  try {
    if (url.pathname === "/api/status") {
      return await handleStatus();
    } else if (url.pathname === "/run") {
      return await handleManualRun();
    } else if (url.pathname === "/" || url.pathname === "") {
      return await handleDashboard();
    }
    
    return new Response("Not Found", { status: 404 });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "Runtime Error",
      message: err.message
    }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }
}

// --- HANDLERS ---

async function handleProxy(request, targetUrl) {
  try {
    const url = new URL(targetUrl);
    const headers = new Headers(request.headers);
    headers.delete("Host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");

    const response = await fetch(url.toString(), {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
      redirect: 'follow'
    });

    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    newHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch (err) {
    return new Response("Proxy Error: " + err.message, { status: 500 });
  }
}

async function handleStatus() {
  const topN = getEnvVar("TOP_N", DEFAULT_TOP_N);
  try {
    const symbols = await getTopSymbols(topN);
    const data = [];
    for (const symbol of symbols) {
      try {
        const klines = await getKlines(symbol, '5m', 200);
        if (klines && klines.length >= 200) {
          const indicators = calculateIndicators(symbol, klines);
          const signal = detectPattern(indicators);
          data.push({
            symbol,
            price: indicators.close,
            rvol: indicators.rvol,
            sma50: indicators.sma50,
            sma200: indicators.sma200,
            signal: signal.patron
          });
        }
      } catch (e) {}
    }
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: true, message: err.message }), { status: 500 });
  }
}

async function handleManualRun() {
  try {
    await runBot();
    return new Response("Escaneo completado. Revisa Telegram.");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}

async function handleDashboard() {
  const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Dashboard Volumen-369</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #0f172a; color: #fff; font-family: sans-serif; padding: 20px; }
        .card { background: #1e293b; border: none; padding: 20px; border-radius: 10px; }
        .buy { color: #10b981; font-weight: bold; }
        .sell { color: #f43f5e; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <div class="d-flex justify-content-between mb-4">
            <h1>🚀 Bot Volumen-369</h1>
            <button onclick="runNow()" class="btn btn-primary">Escanear Ahora</button>
        </div>
        <div class="card">
            <table class="table table-dark">
                <thead>
                    <tr><th>Símbolo</th><th>Precio</th><th>RVOL</th><th>Señal</th></tr>
                </thead>
                <tbody id="data"><tr><td colspan="4">Cargando...</td></tr></tbody>
            </table>
        </div>
    </div>
    <script>
        async function load() {
            try {
                const r = await fetch('/api/status');
                const d = await r.json();
                if (d.error) throw new Error(d.message);
                const b = document.getElementById('data');
                b.innerHTML = d.map(i => \`
                    <tr>
                        <td>\${i.symbol}</td>
                        <td>\${i.price.toFixed(4)}</td>
                        <td>\${i.rvol.toFixed(2)}x</td>
                        <td class="\${i.signal.toLowerCase()}">\${i.signal}</td>
                    </tr>
                \`).join('');
            } catch(e) { document.getElementById('data').innerHTML = '<tr><td colspan="4">Error: '+e.message+'</td></tr>'; }
        }
        async function runNow() {
            alert(await (await fetch('/run')).text());
            load();
        }
        load();
        setInterval(load, 30000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

// --- LÓGICA DE TRADING ---

async function runBot() {
  const apiKey = getEnvVar("BINANCE_API_KEY");
  const apiSecret = getEnvVar("BINANCE_API_SECRET");
  if (!apiKey || !apiSecret) return;

  const topN = getEnvVar("TOP_N", DEFAULT_TOP_N);
  const symbols = await getTopSymbols(topN);
  
  for (const symbol of symbols) {
    try {
      const klines = await getKlines(symbol, '5m', 200);
      if (!klines) continue;
      const ind = calculateIndicators(symbol, klines);
      const sig = detectPattern(ind);
      if (sig.patron !== "HOLD") {
        await sendTelegram(`🚨 SEÑAL: ${sig.patron} en ${symbol} (Precio: ${ind.close})`);
      }
    } catch (e) {}
  }
}

async function getTopSymbols(topN) {
  const endpoints = [
    "https://api.binance.com/api/v3/ticker/24hr",
    "https://api1.binance.com/api/v3/ticker/24hr"
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (r.ok) {
        const d = await r.json();
        return d.filter(t => t.symbol.endsWith("USDT"))
                .sort((a,b) => b.quoteVolume - a.quoteVolume)
                .slice(0, topN).map(t => t.symbol);
      }
    } catch (e) {}
  }
  throw new Error("Binance inaccesible");
}

async function getKlines(symbol, interval, limit) {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

function calculateIndicators(symbol, candles) {
  const close = candles.map(c => parseFloat(c[4]));
  const vol = candles.map(c => parseFloat(c[5]));
  const avg = (arr) => arr.reduce((a,b) => a+b, 0) / arr.length;
  const sma50 = avg(close.slice(-50));
  const sma200 = avg(close.slice(-200));
  const volMa20 = avg(vol.slice(-21, -1));
  return {
    symbol, close: close[close.length-1],
    rvol: vol[vol.length-1] / volMa20,
    sma50, sma200,
    highPrev: parseFloat(candles[candles.length-2][2]),
    lowPrev: parseFloat(candles[candles.length-2][3]),
    volPrev: parseFloat(candles[candles.length-2][5]),
    volCur: vol[vol.length-1]
  };
}

function detectPattern(i) {
  const explosive = i.rvol > 2.0;
  if (i.sma50 > i.sma200 && i.close > i.highPrev && i.volCur > i.volPrev * 1.5 && explosive) return { patron: "BUY" };
  if (i.sma50 < i.sma200 && i.close < i.lowPrev && i.volCur > i.volPrev * 1.5 && explosive) return { patron: "SELL" };
  return { patron: "HOLD" };
}

async function sendTelegram(text) {
  const token = getEnvVar("TELEGRAM_BOT_TOKEN");
  const chatId = getEnvVar("TELEGRAM_CHAT_ID");
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

function getEnvVar(name, fallback = null) {
  try {
    return typeof globalThis[name] !== 'undefined' ? globalThis[name] : fallback;
  } catch (e) { return fallback; }
}

// --- EVENT LISTENERS ---
addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

addEventListener("scheduled", event => {
  event.waitUntil(runBot());
});
