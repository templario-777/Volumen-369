/**
 * 🚀 Volumen-369 Trading Bot - Cloudflare Worker
 * Versión Final: Ultra-Compatibilidad y Fallback
 */

const DEFAULT_TOP_N = 10;
const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "AVAXUSDT", "DOGEUSDT", "DOTUSDT", "LINKUSDT"];

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Headers de CORS para todas las respuestas
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Lógica de Proxy (para bot.py)
  const targetUrl = url.searchParams.get("target");
  if (targetUrl) {
    return await handleProxy(request, targetUrl, corsHeaders);
  }

  try {
    if (url.pathname === "/api/status") {
      const data = await getStatusData();
      return new Response(JSON.stringify(data), { 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    } 
    
    if (url.pathname === "/run") {
      await runBot();
      return new Response("Escaneo completado con éxito.", { headers: corsHeaders });
    }

    if (url.pathname === "/" || url.pathname === "") {
      return await handleDashboard();
    }
    
    return new Response("Not Found", { status: 404, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({
      error: true,
      message: err.message,
      type: "Worker Error"
    }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
}

async function handleProxy(request, targetUrl, corsHeaders) {
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

    const responseHeaders = new Headers(response.headers);
    Object.keys(corsHeaders).forEach(h => responseHeaders.set(h, corsHeaders[h]));
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response("Proxy Error: " + err.message, { status: 500, headers: corsHeaders });
  }
}

async function getStatusData() {
  const topN = getEnvVar("TOP_N", DEFAULT_TOP_N);
  let symbols = [];
  
  try {
    symbols = await getTopSymbols(topN);
  } catch (e) {
    console.log("Usando fallback de símbolos debido a error en Binance API");
    symbols = FALLBACK_SYMBOLS.slice(0, topN);
  }

  const results = [];
  for (const symbol of symbols) {
    try {
      const klines = await getKlines(symbol, '5m', 200);
      if (klines && klines.length >= 200) {
        const ind = calculateIndicators(symbol, klines);
        const sig = detectPattern(ind);
        results.push({
          symbol,
          price: ind.close,
          rvol: ind.rvol,
          sma50: ind.sma50,
          sma200: ind.sma200,
          signal: sig.patron
        });
      }
    } catch (e) {}
  }
  return results;
}

async function handleDashboard() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Volumen-369 Dashboard</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #0f172a; color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; }
        .container { max-width: 900px; }
        .card { background: #1e293b; border: none; border-radius: 15px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); padding: 25px; margin-top: 20px; }
        .table { color: #f8fafc; margin-bottom: 0; }
        .table th { border-top: none; color: #94a3b8; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
        .table td { vertical-align: middle; border-color: #334155; padding: 12px 8px; }
        .BUY { color: #10b981; font-weight: 800; }
        .SELL { color: #f43f5e; font-weight: 800; }
        .HOLD { color: #64748b; }
        .badge-status { font-size: 0.7rem; padding: 5px 10px; border-radius: 20px; background: #334155; color: #38bdf8; }
        .header-title { font-weight: 800; letter-spacing: -0.02em; color: #fff; }
        .btn-refresh { background: #3b82f6; border: none; font-weight: 600; padding: 8px 20px; border-radius: 8px; }
        .btn-refresh:hover { background: #2563eb; }
        #last-update { font-size: 0.75rem; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="d-flex justify-content-between align-items-center">
            <div>
                <h1 class="header-title m-0">🚀 Volumen-369</h1>
                <p id="last-update" class="m-0">Actualizando datos cada 30s...</p>
            </div>
            <div class="text-end">
                <span class="badge-status mb-2 d-inline-block">● Worker Online</span><br>
                <button onclick="refreshData()" class="btn btn-refresh btn-sm">Actualizar Ahora</button>
            </div>
        </div>

        <div class="card">
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Símbolo</th>
                            <th>Precio</th>
                            <th>RVOL</th>
                            <th>Señal</th>
                        </tr>
                    </thead>
                    <tbody id="main-table">
                        <tr><td colspan="4" class="text-center py-5"><div class="spinner-border text-primary spinner-border-sm" role="status"></div><br><small class="mt-2 d-block">Conectando con Binance...</small></td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="mt-4 text-center">
            <button onclick="runBot()" class="btn btn-outline-secondary btn-sm" style="font-size: 0.7rem;">Forzar Ejecución en Telegram</button>
        </div>
    </div>

    <script>
        async function refreshData() {
            const table = document.getElementById('main-table');
            try {
                const response = await fetch('/api/status');
                const data = await response.json();
                
                if (data.length === 0) {
                    table.innerHTML = '<tr><td colspan="4" class="text-center text-warning py-4">No se recibieron datos de Binance. Reintente en unos segundos.</td></tr>';
                    return;
                }

                table.innerHTML = data.map(item => \`
                    <tr>
                        <td><strong>\${item.symbol}</strong></td>
                        <td>\${item.price.toFixed(4)}</td>
                        <td>\${item.rvol.toFixed(2)}x</td>
                        <td><span class="\${item.signal}">\${item.signal === 'HOLD' ? 'ESPERANDO' : item.signal}</span></td>
                    </tr>
                \`).join('');
                
                document.getElementById('last-update').innerText = 'Última actualización: ' + new Date().toLocaleTimeString();
            } catch (err) {
                table.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Error de conexión: ' + err.message + '</td></tr>';
            }
        }

        async function runBot() {
            if(!confirm("¿Quieres forzar un escaneo y enviar alertas a Telegram?")) return;
            try {
                const res = await fetch('/run');
                alert(await res.text());
                refreshData();
            } catch(e) { alert("Error: " + e.message); }
        }

        refreshData();
        setInterval(refreshData, 30000);
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
  let symbols = [];
  try { symbols = await getTopSymbols(topN); } catch(e) { symbols = FALLBACK_SYMBOLS.slice(0, topN); }
  
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
    "https://api1.binance.com/api/v3/ticker/24hr",
    "https://api2.binance.com/api/v3/ticker/24hr"
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 60 } });
      if (r.ok) {
        const d = await r.json();
        return d.filter(t => t.symbol.endsWith("USDT"))
                .sort((a,b) => b.quoteVolume - a.quoteVolume)
                .slice(0, topN).map(t => t.symbol);
      }
    } catch (e) {}
  }
  throw new Error("Binance API Offline");
}

async function getKlines(symbol, interval, limit) {
  const endpoints = [
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    `https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cf: { cacheTtl: 300 } });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  return null;
}

function calculateIndicators(symbol, candles) {
  const close = candles.map(c => parseFloat(c[4]));
  const vol = candles.map(c => parseFloat(c[5]));
  const avg = (arr) => arr.reduce((a,b) => a+b, 0) / arr.length;
  const volMa20 = avg(vol.slice(-21, -1)) || 1; // Evitar división por cero
  return {
    symbol, close: close[close.length-1],
    rvol: vol[vol.length-1] / volMa20,
    sma50: avg(close.slice(-50)),
    sma200: avg(close.slice(-200)),
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

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

addEventListener("scheduled", event => {
  event.waitUntil(runBot());
});
