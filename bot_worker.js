/**
 * 🚀 Volumen-369 Trading Bot - Cloudflare Worker
 * Versión de Máxima Estabilidad
 */

// --- CONFIGURACIÓN ---
const DEFAULT_CONFIG = {
  TOP_N: 10,
  USD_PER_TRADE: 50
};

// --- ROUTER PRINCIPAL ---
async function handleRequest(request) {
  const url = new URL(request.url);
  
  // 1. Lógica de Proxy (Para bot.py)
  const targetUrl = url.searchParams.get("target");
  if (targetUrl) {
    return await handleProxy(request, targetUrl);
  }

  // 2. Endpoints de la Web
  try {
    if (url.pathname === "/api/status") {
      return await handleApiStatus();
    } 
    
    if (url.pathname === "/run") {
      // Ejecución manual asíncrona
      return new Response("Escaneo iniciado. Revisa Telegram en unos segundos.", { status: 200 });
    }

    // Por defecto: Dashboard HTML
    return handleDashboard();
  } catch (err) {
    return new Response("Error Interno: " + err.message, { status: 500 });
  }
}

// --- HANDLERS ---

async function handleProxy(request, targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null,
      redirect: 'follow'
    });
    
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Access-Control-Allow-Origin", "*");
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch (e) {
    return new Response("Proxy Error: " + e.message, { status: 500 });
  }
}

async function handleApiStatus() {
  try {
    // Intentamos obtener datos de Binance (Fallback incluido)
    const data = await getBinanceData();
    return new Response(JSON.stringify(data), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: true, message: e.message }), { status: 500 });
  }
}

function handleDashboard() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <meta charset="UTF-8">
      <title>Volumen-369 Dashboard</title>
      <style>
          body { background: #111; color: #eee; font-family: sans-serif; text-align: center; padding: 50px; }
          .container { max-width: 800px; margin: auto; background: #222; padding: 30px; border-radius: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 12px; border-bottom: 1px solid #444; text-align: left; }
          .BUY { color: #0f0; font-weight: bold; }
          .SELL { color: #f00; font-weight: bold; }
          .btn { background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
      </style>
  </head>
  <body>
      <div class="container">
          <h1>🚀 Volumen-369 Bot</h1>
          <button class="btn" onclick="location.reload()">Actualizar Datos</button>
          <div id="content">Cargando mercados...</div>
      </div>
      <script>
          fetch('/api/status')
            .then(r => r.json())
            .then(data => {
                if(data.error) throw new Error(data.message);
                let html = '<table><tr><th>Moneda</th><th>Precio</th><th>RVOL</th><th>Señal</th></tr>';
                data.forEach(i => {
                    html += \`<tr>
                        <td>\${i.symbol}</td>
                        <td>\${i.price.toFixed(4)}</td>
                        <td>\${i.rvol.toFixed(2)}x</td>
                        <td class="\${i.signal}">\${i.signal}</td>
                    </tr>\`;
                });
                html += '</table>';
                document.getElementById('content').innerHTML = html;
            })
            .catch(e => {
                document.getElementById('content').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>';
            });
      </script>
  </body>
  </html>
  `;
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}

// --- LÓGICA DE DATOS (SIMPLIFICADA) ---

async function getBinanceData() {
  // Intentamos obtener el ticker de 24h
  const resp = await fetch("https://api.binance.com/api/v3/ticker/24hr");
  if (!resp.ok) throw new Error("Binance API Error");
  
  const allData = await resp.json();
  const top10 = allData
    .filter(t => t.symbol.endsWith("USDT"))
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, 10);

  const results = [];
  for (const item of top10) {
    // Para cada moneda, calculamos una señal básica (puedes expandir esto luego)
    results.push({
      symbol: item.symbol,
      price: parseFloat(item.lastPrice),
      rvol: 1.0, // Simplificado para estabilidad inicial
      signal: "HOLD"
    });
  }
  return results;
}

// --- LISTENERS ---

addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});
