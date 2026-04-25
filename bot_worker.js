/**
 * 🚀 Volumen-369 Trading Bot - Cloudflare Worker Edition
 * Autónomo, 24/7, sin interfaz web.
 */

addEventListener("scheduled", event => {
  event.waitUntil(runBot().catch(err => console.error("Error en cron:", err)));
});

addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const targetUrl = url.searchParams.get("target");

  if (targetUrl) {
    event.respondWith(handleProxy(event.request, targetUrl));
  } else if (url.pathname === "/run") {
    event.respondWith(handleManualRun());
  } else if (url.pathname === "/api/status") {
    event.respondWith(handleStatus());
  } else {
    event.respondWith(handleDashboard());
  }
});

async function handleDashboard() {
  const html = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Volumen-369 Bot Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
          body { background-color: #0f172a; color: #f8fafc; font-family: 'Inter', sans-serif; }
          .card { background-color: #1e293b; border: none; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          .status-active { color: #10b981; font-weight: bold; }
          .signal-buy { background-color: #065f46; color: #34d399; padding: 4px 8px; border-radius: 6px; font-size: 0.85rem; }
          .signal-sell { background-color: #7f1d1d; color: #f87171; padding: 4px 8px; border-radius: 6px; font-size: 0.85rem; }
          .signal-hold { color: #94a3b8; font-size: 0.85rem; }
          .table { color: #f8fafc; }
          .table th { border-bottom: 2px solid #334155; }
          .table td { border-bottom: 1px solid #334155; vertical-align: middle; }
          .btn-primary { background-color: #3b82f6; border: none; }
          .btn-primary:hover { background-color: #2563eb; }
          .loader { border: 3px solid #334155; border-top: 3px solid #3b82f6; border-radius: 50%; width: 20px; height: 20px; animation: spin 1s linear infinite; display: inline-block; margin-right: 10px; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
  </head>
  <body>
      <div class="container py-5">
          <div class="d-flex justify-content-between align-items-center mb-4">
              <div>
                  <h1 class="h3 mb-1">🚀 Volumen-369 Bot</h1>
                  <p class="text-secondary mb-0">Estado: <span class="status-active">● Activo (vía Cron)</span></p>
              </div>
              <button onclick="runBot()" id="runBtn" class="btn btn-primary">Ejecutar Escaneo Ahora</button>
          </div>

          <div class="card p-4">
              <h5 class="mb-4">Mercados en Tiempo Real (Top 10 USDT)</h5>
              <div class="table-responsive">
                  <table class="table">
                      <thead>
                          <tr>
                              <th>Símbolo</th>
                              <th>Precio</th>
                              <th>RVOL (24h)</th>
                              <th>Tendencia SMA</th>
                              <th>Señal</th>
                          </tr>
                      </thead>
                      <tbody id="market-data">
                          <tr><td colspan="5" class="text-center py-4"><div class="loader"></div> Cargando datos de mercado...</td></tr>
                      </tbody>
                  </table>
              </div>
          </div>
      </div>

      <script>
          async function loadStatus() {
              try {
                  const resp = await fetch('/api/status');
                  const data = await resp.json();
                  
                  if (data.error) {
                      document.getElementById('market-data').innerHTML = \`
                          <tr><td colspan="5" class="text-center text-danger py-4">
                              ❌ Error de Binance: \${data.message}<br>
                              <small>Es posible que Cloudflare esté bloqueado temporalmente por Binance o falten permisos.</small>
                          </td></tr>
                      \`;
                      return;
                  }

                  const tbody = document.getElementById('market-data');
                  tbody.innerHTML = '';

                  data.forEach(item => {
                      const trend = item.sma50 > item.sma200 ? '📈 Alcista' : '📉 Bajista';
                      let signalClass = 'signal-hold';
                      let signalText = 'HOLD';
                      
                      if (item.signal === 'BUY') { signalClass = 'signal-buy'; signalText = 'COMPRA 🚀'; }
                      else if (item.signal === 'SELL') { signalClass = 'signal-sell'; signalText = 'VENTA 📉'; }

                      tbody.innerHTML += \`
                          <tr>
                              <td><strong>\${item.symbol}</strong></td>
                              <td>\${item.price.toFixed(4)}</td>
                              <td>\${item.rvol.toFixed(2)}x</td>
                              <td>\${trend}</td>
                              <td><span class="\${signalClass}">\${signalText}</span></td>
                          </tr>
                      \`;
                  });
              } catch (e) {
                  console.error(e);
              }
          }

          async function runBot() {
              const btn = document.getElementById('runBtn');
              btn.disabled = true;
              btn.innerHTML = '<div class="loader"></div> Ejecutando...';
              try {
                  const resp = await fetch('/run');
                  const text = await resp.text();
                  alert(text);
              } catch (e) {
                  alert('Error al ejecutar: ' + e.message);
              }
              btn.disabled = false;
              btn.innerHTML = 'Ejecutar Escaneo Ahora';
              loadStatus();
          }

          loadStatus();
          setInterval(loadStatus, 30000);
      </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

async function handleStatus() {
  try {
    const config = {
      TOP_N: typeof globalThis.TOP_N !== 'undefined' ? parseInt(globalThis.TOP_N) : 10,
    };
    
    const symbols = await getTopSymbols(config.TOP_N);
    const statusData = [];

    for (const symbol of symbols) {
      try {
        const candles = await getKlines(symbol, '5m', 200);
        if (!candles || candles.length < 200) continue;

        const indicators = calculateIndicators(symbol, candles);
        const signal = detectPattern(indicators);

        statusData.push({
          symbol: symbol,
          price: indicators.close,
          rvol: indicators.rvol,
          sma50: indicators.sma50,
          sma200: indicators.sma200,
          signal: signal.patron
        });
      } catch (e) {}
    }

    return new Response(JSON.stringify(statusData), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: true, message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}

async function handleProxy(request, targetUrl) {
  try {
    const url = new URL(targetUrl);
    const proxyRequest = new Request(url, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
      redirect: 'follow'
    });

    // Eliminar headers que pueden causar problemas en Cloudflare
    proxyRequest.headers.delete("Host");
    proxyRequest.headers.delete("cf-connecting-ip");
    proxyRequest.headers.delete("cf-ipcountry");
    proxyRequest.headers.delete("cf-ray");
    proxyRequest.headers.delete("cf-visitor");

    const response = await fetch(proxyRequest);
    
    // Copiar la respuesta y añadir CORS
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "*");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Proxy Error", message: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

async function handleManualRun() {
  try {
    await runBot();
    return new Response("Bot ejecutado correctamente. Revisa tu Telegram.");
  } catch (err) {
    return new Response("Error: " + err.message, { status: 500 });
  }
}

async function runBot() {
  // En Cloudflare Service Workers, las variables de entorno son globales
  const config = {
    BINANCE_API_KEY: typeof globalThis.BINANCE_API_KEY !== 'undefined' ? globalThis.BINANCE_API_KEY : null,
    BINANCE_API_SECRET: typeof globalThis.BINANCE_API_SECRET !== 'undefined' ? globalThis.BINANCE_API_SECRET : null,
    TELEGRAM_BOT_TOKEN: typeof globalThis.TELEGRAM_BOT_TOKEN !== 'undefined' ? globalThis.TELEGRAM_BOT_TOKEN : null,
    TELEGRAM_CHAT_ID: typeof globalThis.TELEGRAM_CHAT_ID !== 'undefined' ? globalThis.TELEGRAM_CHAT_ID : null,
    USD_PER_TRADE: typeof globalThis.USD_PER_TRADE !== 'undefined' ? parseFloat(globalThis.USD_PER_TRADE) : 50,
    TOP_N: typeof globalThis.TOP_N !== 'undefined' ? parseInt(globalThis.TOP_N) : 10,
  };

  if (!config.BINANCE_API_KEY || !config.BINANCE_API_SECRET) {
    console.log("Faltan API Keys. El bot no puede continuar.");
    return;
  }

  const symbols = await getTopSymbols(config.TOP_N);
  if (!symbols || symbols.length === 0) {
    console.error("No se pudieron obtener símbolos de Binance.");
    return;
  }
  
  for (const symbol of symbols) {
    try {
      const candles = await getKlines(symbol, '5m', 200);
      if (!candles || !Array.isArray(candles) || candles.length < 200) continue;

      const indicators = calculateIndicators(symbol, candles);
      const signal = detectPattern(indicators);

      if (signal.patron !== "HOLD" && signal.fuerza >= 80) {
        await executeTrade(symbol, signal.patron, config.USD_PER_TRADE, config, indicators.close);
      }
    } catch (err) {
      console.error(`Error en ${symbol}:`, err.message);
    }
  }
}

async function getTopSymbols(topN) {
  try {
    const resp = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`Binance API error: ${resp.status} - ${errorText}`);
    }
    const data = await resp.json();
    return data
      .filter(t => t.symbol && t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, topN)
      .map(t => t.symbol);
  } catch (e) {
    console.error("Error getTopSymbols:", e.message);
    throw e; // Lanzar el error para capturarlo en handleStatus
  }
}

async function getKlines(symbol, interval, limit) {
  try {
    const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

function calculateIndicators(symbol, candles) {
  const prices = candles.map(c => parseFloat(c[4])); 
  const volumes = candles.map(c => parseFloat(c[5])); 

  const sma = (data, period) => {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  };

  const currentVol = volumes[volumes.length - 1];
  const ma20Vol = sma(volumes.slice(0, -1), 20);
  const rvol = ma20Vol > 0 ? currentVol / ma20Vol : 0;

  return {
    symbol: symbol,
    close: prices[prices.length - 1],
    prevHigh: parseFloat(candles[candles.length - 2][2]),
    prevLow: parseFloat(candles[candles.length - 2][3]),
    currentVol,
    prevVol: parseFloat(candles[candles.length - 2][5]),
    rvol,
    sma50: sma(prices, 50),
    sma200: sma(prices, 200)
  };
}

function detectPattern(ind) {
  const alcista = ind.sma50 > ind.sma200;
  const bajista = ind.sma50 < ind.sma200;

  const rupturaAlcista = ind.close > ind.prevHigh && ind.currentVol > ind.prevVol * 1.5;
  const rupturaBajista = ind.close < ind.prevLow && ind.currentVol > ind.prevVol * 1.5;

  const volExplosivo = ind.rvol > 2.0;

  if (alcista && rupturaAlcista && volExplosivo) {
    return { patron: "BUY", fuerza: Math.min(100, ind.rvol * 30) };
  }
  if (bajista && rupturaBajista && volExplosivo) {
    return { patron: "SELL", fuerza: Math.min(100, ind.rvol * 30) };
  }

  return { patron: "HOLD", fuerza: 0 };
}

async function executeTrade(symbol, side, amountUsd, config, price) {
  // Formateamos el mensaje para que sea igual al del bot.py
  const msg = `🚨 SEÑAL: ${side} en ${symbol} (Monto: ${amountUsd} USD, Precio: ${price})`;
  
  await sendTelegram(msg, config);
  console.log(`Ejecutando ${side} para ${symbol} a precio ${price}`);
}

async function sendTelegram(text, config) {
  const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' })
  });
}
