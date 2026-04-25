/**
 * 🚀 Volumen-369 Trading Bot - Versión PRO "Institucional"
 * Análisis de Volumen, VWAP, Futuros y Liquidaciones.
 */

async function handleRequest(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("target");

  if (targetUrl) return await handleProxy(request, targetUrl);

  try {
    if (url.pathname === "/api/pro-analysis") {
      const symbol = url.searchParams.get("symbol") || "BTCUSDT";
      const data = await getProAnalysis(symbol);
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/api/top-markets") {
      const markets = await getTopMarkets();
      return new Response(JSON.stringify(markets), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    }
    return await handleDashboard();
  } catch (err) {
    return new Response(JSON.stringify({ error: true, message: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

async function handleProxy(request, targetUrl) {
  const response = await fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.arrayBuffer() : null
  });
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

async function getProAnalysis(symbol) {
  // 1. Obtener datos básicos y velas
  const candles = await fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=100`);
  const ticker = await fetchBinance(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  const orderBook = await fetchBinance(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`);
  
  // 2. Datos de Futuros (Si es posible)
  let futuresData = { fundingRate: "0.00%", openInterest: "N/D", longShortRatio: "N/D" };
  try {
    const fTicker = await fetchBinance(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    const fOI = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    futuresData.fundingRate = (parseFloat(fTicker.lastFundingRate) * 100).toFixed(4) + "%";
    futuresData.openInterest = parseFloat(fOI.openInterest).toFixed(2);
  } catch(e) {}

  // 3. Cálculos Avanzados
  const lastClose = parseFloat(candles[candles.length-1][4]);
  const high = candles.map(c => parseFloat(c[2]));
  const low = candles.map(c => parseFloat(c[3]));
  const close = candles.map(c => parseFloat(c[4]));
  const vol = candles.map(c => parseFloat(c[5]));

  // VWAP Simple
  let sumTypicalPriceVol = 0, sumVol = 0;
  candles.forEach(c => {
    const tp = (parseFloat(c[2]) + parseFloat(c[3]) + parseFloat(c[4])) / 3;
    const v = parseFloat(c[5]);
    sumTypicalPriceVol += tp * v;
    sumVol += v;
  });
  const vwap = sumTypicalPriceVol / sumVol;

  // ATR (Simplificado para 14 periodos)
  let trSum = 0;
  for(let i=candles.length-14; i<candles.length; i++) {
    trSum += Math.max(high[i]-low[i], Math.abs(high[i]-close[i-1] || 0), Math.abs(low[i]-close[i-1] || 0));
  }
  const atr = trSum / 14;

  // Presión Compra/Venta (Order Book)
  const bids = orderBook.bids.reduce((a, b) => a + parseFloat(b[1]), 0);
  const asks = orderBook.asks.reduce((a, b) => a + parseFloat(b[1]), 0);
  const buyPressure = (bids / (bids + asks) * 100).toFixed(1);

  // Mapa de Liquidación Estimado
  const liqShorts = (lastClose * 1.015).toFixed(2); // Estimación 1.5% arriba
  const liqLongs = (lastClose * 0.985).toFixed(2); // Estimación 1.5% abajo

  // RVOL
  const avgVol = vol.slice(-21, -1).reduce((a,b)=>a+b, 0) / 20;
  const rvol = vol[vol.length-1] / avgVol;

  return {
    price: lastClose,
    rvol: rvol.toFixed(2),
    vwap: vwap.toFixed(2),
    buyPressure: buyPressure + "%",
    sellPressure: (100 - buyPressure).toFixed(1) + "%",
    fundingRate: futuresData.fundingRate,
    openInterest: futuresData.openInterest,
    liqZoneShorts: `${liqShorts} - ${(liqShorts*1.002).toFixed(2)}`,
    liqZoneLongs: `${liqLongs} - ${(liqLongs*0.998).toFixed(2)}`,
    plan: {
      entry: lastClose,
      sl: (lastClose - (atr * 1.5)).toFixed(2),
      tp1: (lastClose + (atr * 1.5)).toFixed(2),
      tp2: (lastClose + (atr * 3)).toFixed(2)
    },
    signal: rvol > 2.0 && lastClose > vwap ? "BUY" : (rvol > 2.0 && lastClose < vwap ? "SELL" : "HOLD")
  };
}

async function getTopMarkets() {
  const data = await fetchBinance("https://api.binance.com/api/v3/ticker/24hr");
  return data.filter(t => t.symbol.endsWith("USDT"))
             .sort((a, b) => b.quoteVolume - a.quoteVolume)
             .slice(0, 10).map(t => t.symbol);
}

async function fetchBinance(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Binance API Error: ${r.status}`);
  return await r.json();
}

async function handleDashboard() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Volumen-369 PRO</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #0b0e11; color: #eaecef; font-family: 'Inter', sans-serif; }
        .card { background: #1e2329; border: 1px solid #474d57; border-radius: 8px; padding: 20px; height: 100%; }
        .metric-label { color: #848e9c; font-size: 0.85rem; }
        .metric-value { font-size: 1.25rem; font-weight: 600; color: #f0b90b; }
        .BUY { color: #0ecb81 !important; }
        .SELL { color: #f6465d !important; }
        .liq-box { border-left: 4px solid #f0b90b; background: #2b3139; padding: 10px; margin-top: 10px; }
        .btn-binance { background: #f0b90b; color: #000; border: none; font-weight: bold; }
        .btn-binance:hover { background: #dcb000; }
        select { background: #2b3139; color: white; border: 1px solid #474d57; padding: 5px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="container py-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h2 class="m-0">🚀 Volumen-369 <span class="badge bg-warning text-dark" style="font-size: 0.5em;">PRO</span></h2>
            <div>
                <select id="symbolSelect" onchange="loadProData()"><option>Cargando...</option></select>
                <button onclick="loadProData()" class="btn btn-binance btn-sm ms-2">🔄</button>
            </div>
        </div>

        <div class="row g-3">
            <!-- Panel Principal -->
            <div class="col-md-4">
                <div class="card">
                    <div class="metric-label">Precio Actual</div>
                    <div id="price" class="metric-value">---</div>
                    <hr>
                    <div class="row">
                        <div class="col-6">
                            <div class="metric-label">RVOL</div>
                            <div id="rvol">---</div>
                        </div>
                        <div class="col-6">
                            <div class="metric-label">VWAP</div>
                            <div id="vwap">---</div>
                        </div>
                    </div>
                    <hr>
                    <div class="metric-label">Señal Algorítmica</div>
                    <div id="signal" class="h4 font-weight-bold">HOLD</div>
                </div>
            </div>

            <!-- Futuros y Presión -->
            <div class="col-md-4">
                <div class="card">
                    <div class="metric-label">Presión Compra/Venta</div>
                    <div class="progress mt-2" style="height: 25px; background: #f6465d;">
                        <div id="pressureBar" class="progress-bar bg-success" style="width: 50%"></div>
                    </div>
                    <div class="d-flex justify-content-between mt-1" style="font-size: 0.8rem;">
                        <span id="buyText">50% Compra</span>
                        <span id="sellText">50% Venta</span>
                    </div>
                    <hr>
                    <div class="metric-label">Funding Rate</div>
                    <div id="funding">---</div>
                    <div class="metric-label mt-2">Open Interest</div>
                    <div id="oi">---</div>
                </div>
            </div>

            <!-- Mapa de Liquidación -->
            <div class="col-md-4">
                <div class="card">
                    <div class="metric-label">Mapa de Liquidación Estimado</div>
                    <div class="liq-box">
                        <small class="metric-label">ZONA LIQ SHORTS (IMÁN)</small><br>
                        <span id="liqShorts" class="BUY">---</span>
                    </div>
                    <div class="liq-box mt-3" style="border-left-color: #f6465d;">
                        <small class="metric-label">ZONA LIQ LONGS (IMÁN)</small><br>
                        <span id="liqLongs" class="SELL">---</span>
                    </div>
                </div>
            </div>

            <!-- Plan Cuantitativo -->
            <div class="col-12">
                <div class="card">
                    <h5>🎯 Plan Operativo (Basado en ATR)</h5>
                    <div class="row text-center mt-3">
                        <div class="col-md-3">
                            <div class="metric-label">ENTRADA</div>
                            <div id="planEntry" class="text-white">---</div>
                        </div>
                        <div class="col-md-3">
                            <div class="metric-label text-danger">STOP LOSS</div>
                            <div id="planSL" class="SELL">---</div>
                        </div>
                        <div class="col-md-3">
                            <div class="metric-label text-success">TAKE PROFIT 1</div>
                            <div id="planTP1" class="BUY">---</div>
                        </div>
                        <div class="col-md-3">
                            <div class="metric-label text-success">TAKE PROFIT 2</div>
                            <div id="planTP2" class="BUY">---</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        async function loadSymbols() {
            const r = await fetch('/api/top-markets');
            const symbols = await r.json();
            const sel = document.getElementById('symbolSelect');
            sel.innerHTML = symbols.map(s => \`<option value="\${s}">\${s}</option>\`).join('');
            loadProData();
        }

        async function loadProData() {
            const symbol = document.getElementById('symbolSelect').value;
            const r = await fetch(\`/api/pro-analysis?symbol=\${symbol}\`);
            const d = await r.json();

            document.getElementById('price').innerText = d.price.toFixed(4);
            document.getElementById('rvol').innerText = d.rvol + "x";
            document.getElementById('vwap').innerText = d.vwap;
            document.getElementById('signal').innerText = d.signal;
            document.getElementById('signal').className = "h4 font-weight-bold " + d.signal;
            
            document.getElementById('pressureBar').style.width = d.buyPressure;
            document.getElementById('buyText').innerText = d.buyPressure + " Compra";
            document.getElementById('sellText').innerText = d.sellPressure + " Venta";
            
            document.getElementById('funding').innerText = d.fundingRate;
            document.getElementById('oi').innerText = d.openInterest;
            document.getElementById('liqShorts').innerText = d.liqZoneShorts;
            document.getElementById('liqLongs').innerText = d.liqZoneLongs;

            document.getElementById('planEntry').innerText = d.plan.entry;
            document.getElementById('planSL').innerText = d.plan.sl;
            document.getElementById('planTP1').innerText = d.plan.tp1;
            document.getElementById('planTP2').innerText = d.plan.tp2;
        }

        loadSymbols();
        setInterval(loadProData, 60000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
