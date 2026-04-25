/**
 * 🚀 Volumen-369 Trading Bot - Versión ELITE FINAL "Smart Money"
 * Implementación de Wyckoff, CVD Divergence, Squeeze de Volatilidad y OI Avanzado.
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
    if (url.pathname === "/api/check-symbol") {
      const symbol = url.searchParams.get("symbol") || "";
      const exists = await checkSymbolExists(symbol);
      return new Response(JSON.stringify({ exists }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
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

async function checkSymbolExists(symbol) {
  symbol = symbol.toUpperCase();
  // Intentar Binance Spot primero
  try {
    const data = await fetchBinance(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (data.symbol) return { exists: true, source: 'BINANCE' };
  } catch (e) {}

  // Intentar Binance Futuros
  try {
    const data = await fetchBinance(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
    if (data.symbol) return { exists: true, source: 'BINANCE_FUTURES' };
  } catch (e) {}

  // Intentar Bybit (como alternativa para monedas que no están en Binance)
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
    const data = await r.json();
    if (data.result && data.result.list && data.result.list.length > 0) return { exists: true, source: 'BYBIT' };
  } catch (e) {}

  return { exists: false };
}

async function getProAnalysis(symbol) {
  symbol = symbol.toUpperCase();
  const candles = await fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=200`);
  const ticker24h = await fetchBinance(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`);
  
  // 1. Datos de Futuros Avanzados (OI y Funding)
  let futures = { funding: 0, oi: 0, oiChange: 0 };
  try {
    const fTicker = await fetchBinance(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    const fOI = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    const fOIHist = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=5m&limit=2`);
    futures.funding = parseFloat(fTicker.lastFundingRate);
    futures.oi = parseFloat(fOI.openInterest);
    if(fOIHist.length >= 2) {
      futures.oiChange = ((futures.oi - parseFloat(fOIHist[0].sumOpenInterest)) / parseFloat(fOIHist[0].sumOpenInterest)) * 100;
    }
  } catch(e) {}

  const close = candles.map(c => parseFloat(c[4]));
  const high = candles.map(c => parseFloat(c[2]));
  const low = candles.map(c => parseFloat(c[3]));
  const vol = candles.map(c => parseFloat(c[5]));
  const lastPrice = close[close.length - 1];

  // 2. Lógica de Squeeze (Bandas de Bollinger vs Keltner)
  const sma20 = calculateSMA(close, 20);
  const stdDev = calculateStdDev(close, 20, sma20);
  const atr20 = calculateATR(high, low, close, 20);
  const isSqueeze = stdDev < (atr20 * 1.5);

  // 3. CVD Divergence (Delta de Volumen Acumulado - Estimado)
  let cvdDelta = 0;
  for(let i = candles.length - 10; i < candles.length; i++) {
    const cOpen = parseFloat(candles[i][1]), cClose = parseFloat(candles[i][4]), cVol = parseFloat(candles[i][5]);
    cvdDelta += (cClose > cOpen ? 1 : -1) * cVol;
  }
  let cvdStatus = "NEUTRAL";
  if (close[close.length-1] < close[close.length-10] && cvdDelta > 0) cvdStatus = "BULLISH_ABSORPTION";
  if (close[close.length-1] > close[close.length-10] && cvdDelta < 0) cvdStatus = "BEARISH_ABSORPTION";

  // 4. Ciclo Wyckoff y Sesión
  const now = new Date();
  const hour = now.getUTCHours();
  let session = "ASIA";
  if (hour >= 8 && hour < 16) session = "LONDRES";
  else if (hour >= 13 && hour < 21) session = "NUEVA YORK";

  let phase = "MARKUP";
  if (isSqueeze) phase = "ACUMULACIÓN (WYCKOFF)";
  else if (futures.funding < -0.01) phase = "POTENCIAL SHORT SQUEEZE";
  else if (futures.funding > 0.01) phase = "DISTRIBUCIÓN / RIESGO LONG";

  // 5. Plan Cuantitativo ATR + Liquidez (Targeting Institucional)
  const atr14 = calculateATR(high, low, close, 14);
  const sl = (lastPrice - (atr14 * 2)).toFixed(symbol.includes("USDT") ? 2 : 4);
  
  // Targets dinámicos basados en zonas de liquidación (Imanes)
  // TP1: Mitad de camino al imán o 2.5x ATR
  // TP2: Justo en la zona de liquidación (Barrida)
  let tp1, tp2;
  if (cvdStatus === "BULLISH_ABSORPTION" || lastPrice > vwap) {
    // Escenario Alcista: Apuntamos a liquidar Shorts (Arriba)
    const liqTarget = lastPrice * 1.015; 
    tp1 = (lastPrice + (atr14 * 3)).toFixed(symbol.includes("USDT") ? 2 : 4);
    tp2 = liqTarget.toFixed(symbol.includes("USDT") ? 2 : 4);
  } else {
    // Escenario Bajista: Apuntamos a liquidar Longs (Abajo)
    const liqTarget = lastPrice * 0.985;
    tp1 = (lastPrice - (atr14 * 3)).toFixed(symbol.includes("USDT") ? 2 : 4);
    tp2 = liqTarget.toFixed(symbol.includes("USDT") ? 2 : 4);
  }

  return {
    symbol, price: lastPrice,
    rvol: (parseFloat(ticker24h.volume) / (vol.slice(-24).reduce((a,b)=>a+b,0) * 10)).toFixed(2),
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    oiChange: futures.oiChange.toFixed(2) + "%",
    isSqueeze, phase, cvdStatus, session,
    liqShorts: (lastPrice * 1.015).toFixed(2),
    liqLongs: (lastPrice * 0.985).toFixed(2),
    plan: { entry: lastPrice, sl, tp1, tp2 },
    regime: isSqueeze ? "COMPRESIÓN (BOMBA)" : "FLUJO ACTIVO"
  };
}

function calculateSMA(data, period) {
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateStdDev(data, period, sma) {
  const slice = data.slice(-period);
  return Math.sqrt(slice.map(x => Math.pow(x - sma, 2)).reduce((a, b) => a + b) / period);
}

function calculateATR(h, l, c, p) {
  let trs = [];
  for(let i=1; i<h.length; i++) {
    trs.push(Math.max(h[i]-l[i], Math.abs(h[i]-c[i-1]), Math.abs(l[i]-c[i-1])));
  }
  return trs.slice(-p).reduce((a,b)=>a+b, 0) / p;
}

async function fetchBinance(url) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Binance API Error`);
  return await r.json();
}

async function handleDashboard() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Volumen-369 ELITE FINAL</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        :root { --bg: #0b0e11; --card: #1e2329; --yellow: #f0b90b; --green: #0ecb81; --red: #f6465d; --text: #ffffff; --muted: #b7bdc6; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; }
        .card { background: var(--card); border: 1px solid #474d57; border-radius: 12px; padding: 20px; box-shadow: 0 8px 16px rgba(0,0,0,0.5); }
        
        /* VISIBILIDAD DE TEXTOS */
        .metric-label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .metric-value { font-size: 1.6rem; font-weight: 900; color: var(--yellow); text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
        .metric-sub { font-size: 1.1rem; font-weight: 700; color: #fff; }
        
        .BUY, .bullish { color: var(--green) !important; font-weight: 900; }
        .SELL, .bearish { color: var(--red) !important; font-weight: 900; }
        
        .search-box { background: #2b3139; border: 2px solid #474d57; color: #fff; padding: 12px 20px; border-radius: 30px; width: 320px; font-weight: 700; outline: none; }
        .search-box:focus { border-color: var(--yellow); }
        
        .status-pill { padding: 5px 15px; border-radius: 30px; font-size: 0.75rem; font-weight: 800; background: #2b3139; border: 1px solid #474d57; color: var(--yellow); }
        .squeeze-active { background: rgba(240, 185, 11, 0.25); border-color: var(--yellow); color: var(--yellow); box-shadow: 0 0 15px rgba(240, 185, 11, 0.3); }
        
        .liq-zone { padding: 15px; border-radius: 10px; margin-top: 10px; border-left: 5px solid; }
        .liq-shorts { background: rgba(14, 203, 129, 0.15); border-color: var(--green); }
        .liq-longs { background: rgba(246, 70, 93, 0.15); border-color: var(--red); }
        
        .chart-container { height: 500px; border-radius: 12px; overflow: hidden; border: 1px solid #474d57; }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <!-- HEADER -->
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h3 class="m-0 fw-bold">🚀 Volumen-369 <span class="badge bg-warning text-dark">ELITE FINAL</span></h3>
            <div class="d-flex gap-3 align-items-center">
                <div id="sessionPill" class="status-pill">SESIÓN: ---</div>
                <input type="text" id="symbolInput" class="search-box" placeholder="BUSCAR CRYPTO (EJ: BTCUSDT)" onkeypress="if(event.key==='Enter') updateSymbol()">
            </div>
        </div>

        <div class="row g-4">
            <!-- GRÁFICO -->
            <div class="col-lg-8">
                <div class="chart-container" id="tv_chart"></div>
                <!-- PLAN CUANTITATIVO -->
                <div class="card mt-4">
                    <h6 class="metric-label">🎯 Plan Institucional (Targets en Imanes de Liquidez)</h6>
                    <div class="row text-center mt-3">
                        <div class="col-3"><div class="metric-label">ENTRADA</div><div id="planEntry" class="metric-sub">---</div></div>
                        <div class="col-3"><div class="metric-label text-danger">STOP LOSS</div><div id="planSL" class="SELL metric-sub">---</div></div>
                        <div class="col-3"><div class="metric-label text-success">TARGET 1 (VOL)</div><div id="planTP1" class="BUY metric-sub">---</div></div>
                        <div class="col-3"><div class="metric-label text-warning">TARGET 2 (LIQ)</div><div id="planTP2" class="metric-sub" style="color: #f0b90b;">---</div></div>
                    </div>
                </div>
            </div>

            <!-- MÉTRICAS SMART MONEY -->
            <div class="col-lg-4">
                <div class="row g-4">
                    <!-- PRECIO Y FASE -->
                    <div class="col-12">
                        <div class="card">
                            <div class="d-flex justify-content-between">
                                <div>
                                    <div class="metric-label">PRECIO <span id="curSymbol" class="text-white">BTCUSDT</span></div>
                                    <div id="price" class="metric-value">---</div>
                                </div>
                                <div class="text-end">
                                    <div id="squeezeBadge" class="status-pill mb-2">VOLATILIDAD NORMAL</div>
                                    <div class="metric-label">FASE WYCKOFF</div>
                                    <div id="phase" class="metric-sub">---</div>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-6"><div class="metric-label">RVOL (MANOS FUERTES)</div><div id="rvol" class="metric-sub">---</div></div>
                                <div class="col-6"><div class="metric-label">CVD DIVERGENCIA</div><div id="divergence" class="metric-sub">---</div></div>
                            </div>
                        </div>
                    </div>

                    <!-- FUTUROS -->
                    <div class="col-12">
                        <div class="card">
                            <h6 class="metric-label">FUTUROS Y SENTIMIENTO (SMART MONEY)</h6>
                            <div class="row mt-3">
                                <div class="col-6"><div class="metric-label">FUNDING RATE</div><div id="funding" class="metric-sub">---</div></div>
                                <div class="col-6"><div class="metric-label">OPEN INTEREST</div><div id="oi" class="metric-sub">---</div></div>
                            </div>
                            <div class="mt-3">
                                <div class="metric-label">CAMBIO OI (5M)</div>
                                <div id="oiChange" class="metric-value">---</div>
                            </div>
                        </div>
                    </div>

                    <!-- LIQUIDEZ -->
                    <div class="col-12">
                        <div class="card">
                            <h6 class="metric-label">IMANES DE LIQUIDACIÓN (TARGETS)</h6>
                            <div class="liq-zone liq-shorts">
                                <div class="metric-label text-success">LIQUIDACIÓN DE SHORTS (IMÁN)</div>
                                <div id="liqShorts" class="BUY metric-sub">---</div>
                            </div>
                            <div class="liq-zone liq-longs">
                                <div class="metric-label text-danger">LIQUIDACIÓN DE LONGS (IMÁN)</div>
                                <div id="liqLongs" class="SELL metric-sub">---</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
    <script>
        let currentSymbol = "BTCUSDT";
        function initChart(s) {
            new TradingView.widget({
                "autosize": true, "symbol": "BINANCE:" + s, "interval": "5", "theme": "dark", "style": "1",
                "container_id": "tv_chart", "studies": ["VWAP@tv-basicstudies", "MASimple@tv-basicstudies"]
            });
        }

        async function updateSymbol() {
            let input = document.getElementById('symbolInput').value.toUpperCase().trim();
            if(!input) return;
            
            // Auto-corrección: si solo ponen "BTC", convertir a "BTCUSDT"
            if(!input.endsWith("USDT") && !input.endsWith("BUSD") && !input.endsWith("USDC")) {
                input = input + "USDT";
            }
            
            const sessionPill = document.getElementById('sessionPill');
            sessionPill.innerText = "BUSCANDO: " + input + "...";

            const check = await fetch(\`/api/check-symbol?symbol=\${input}\`);
            const res = await check.json();
            
            if(res.exists) {
                currentSymbol = input;
                initChart(currentSymbol);
                loadData();
                document.getElementById('symbolInput').value = "";
                sessionPill.innerText = "SESIÓN: ---"; // Se actualizará con loadData
            } else {
                alert("La moneda '" + input + "' no se encuentra en Binance Spot, Futuros ni Bybit. Asegúrate de escribir bien el símbolo (ej: PEPE, SOL, ARB).");
                sessionPill.innerText = "MONEDA NO ENCONTRADA";
            }
        }

        async function loadData() {
            const d = await (await fetch(\`/api/pro-analysis?symbol=\${currentSymbol}\`)).json();
            document.getElementById('price').innerText = d.price.toLocaleString();
            document.getElementById('curSymbol').innerText = d.symbol;
            document.getElementById('rvol').innerText = d.rvol + "x";
            document.getElementById('phase').innerText = d.phase;
            document.getElementById('funding').innerText = d.funding;
            document.getElementById('oi').innerText = d.oi;
            document.getElementById('oiChange').innerText = d.oiChange;
            document.getElementById('oiChange').className = "metric-value " + (parseFloat(d.oiChange) > 0 ? "BUY" : "SELL");
            document.getElementById('liqShorts').innerText = d.liqShorts;
            document.getElementById('liqLongs').innerText = d.liqLongs;
            document.getElementById('planEntry').innerText = d.plan.entry.toLocaleString();
            document.getElementById('planSL').innerText = d.plan.sl;
            document.getElementById('planTP1').innerText = d.plan.tp1;
            document.getElementById('planTP2').innerText = d.plan.tp2;
            document.getElementById('divergence').innerText = d.cvdStatus.replace('_', ' ');
            document.getElementById('divergence').className = "metric-sub " + (d.cvdStatus.includes('BULL') ? "BUY" : (d.cvdStatus.includes('BEAR') ? "SELL" : ""));
            document.getElementById('sessionPill').innerText = "SESIÓN: " + d.session;
            
            const sq = document.getElementById('squeezeBadge');
            if(d.isSqueeze) { sq.innerText = "💥 SQUEEZE DETECTADO"; sq.className = "status-pill squeeze-active"; }
            else { sq.innerText = "VOLATILIDAD NORMAL"; sq.className = "status-pill"; }
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 10000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
