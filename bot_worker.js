/**
 * 🚀 Volumen-369 Trading Bot - Versión ELITE V3 "CONFLUENCIA MACRO"
 * Análisis Multi-Timeframe (15m, 1h, 4h, 1d) + Motor de Sentimiento Avanzado.
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
  try {
    const data = await fetchBinance(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    return { exists: !!data.symbol };
  } catch (e) { return { exists: false }; }
}

async function getProAnalysis(symbol) {
  symbol = symbol.toUpperCase();
  
  // 1. Obtención de Datos Multi-Timeframe (MTF)
  const [c15m, c1h, c4h, c1d] = await Promise.all([
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=50`)
  ]);

  // 2. Datos de Futuros y Sentimiento
  let futures = { funding: 0, oi: 0, oiChange: 0 };
  try {
    const fTicker = await fetchBinance(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    const fOI = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    const fOIHist = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterestHist?symbol=${symbol}&period=15m&limit=2`);
    futures.funding = parseFloat(fTicker.lastFundingRate);
    futures.oi = parseFloat(fOI.openInterest);
    if(fOIHist.length >= 2) {
      futures.oiChange = ((futures.oi - parseFloat(fOIHist[0].sumOpenInterest)) / parseFloat(fOIHist[0].sumOpenInterest)) * 100;
    }
  } catch(e) {}

  // 3. Análisis de Tendencia MTF (SMA 50/200)
  const getBias = (candles) => {
    const close = candles.map(c => parseFloat(c[4]));
    const sma50 = close.slice(-50).reduce((a,b)=>a+b,0) / 50;
    const sma200 = close.slice(-100).reduce((a,b)=>a+b,0) / 100;
    return close[close.length-1] > sma50 && sma50 > sma200 ? "ALCISTA" : (close[close.length-1] < sma50 && sma50 < sma200 ? "BAJISTA" : "NEUTRAL");
  };

  const bias15m = getBias(c15m);
  const bias1h = getBias(c1h);
  const bias4h = getBias(c4h);
  const bias1d = getBias(c1d);

  // 4. Confluencia y Fuerza del Sentimiento
  let score = 0;
  if (bias15m === bias1h) score += 20;
  if (bias1h === bias4h) score += 30;
  if (bias4h === bias1d) score += 20;
  if (futures.oiChange > 0.5) score += 15;
  if (Math.abs(futures.funding) > 0.01) score += 15;

  const lastPrice = parseFloat(c15m[c15m.length-1][4]);
  const atr15m = calculateATR(c15m.map(c=>parseFloat(c[2])), c15m.map(c=>parseFloat(c[3])), c15m.map(c=>parseFloat(c[4])), 14);

  // 5. Motor de Sentimiento Refinado
  let sentiment = "NEUTRAL";
  if (score >= 70) sentiment = "EXTREMADAMENTE FUERTE";
  else if (score >= 40) sentiment = "MODERADO";
  else sentiment = "DÉBIL / RIESGO";

  // 6. Plan Institucional alineado a la Liquidez
  const liqShorts = (lastPrice * 1.02).toFixed(2);
  const liqLongs = (lastPrice * 0.98).toFixed(2);

  return {
    symbol, price: lastPrice,
    mtf: { "15m": bias15m, "1h": bias1h, "4h": bias4h, "1d": bias1d },
    confluence: score + "%",
    sentiment,
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    oiChange: futures.oiChange.toFixed(2) + "%",
    liqShorts, liqLongs,
    plan: {
      entry: lastPrice,
      sl: (lastPrice - (atr15m * 2)).toFixed(2),
      tp1: (lastPrice + (atr15m * 3)).toFixed(2),
      tp2: (score > 60 ? (bias1h === "ALCISTA" ? liqShorts : liqLongs) : (lastPrice + (atr15m * 5)).toFixed(2))
    }
  };
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
    <title>Volumen-369 ELITE V3</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        :root { --bg: #0b0e11; --card: #1e2329; --yellow: #f0b90b; --green: #0ecb81; --red: #f6465d; --text: #ffffff; --muted: #b7bdc6; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; }
        .card { background: var(--card); border: 1px solid #474d57; border-radius: 12px; padding: 20px; box-shadow: 0 8px 16px rgba(0,0,0,0.5); }
        .metric-label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; }
        .metric-value { font-size: 1.6rem; font-weight: 900; color: var(--yellow); }
        .bias-pill { padding: 4px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; margin-right: 5px; }
        .ALCISTA { background: rgba(14, 203, 129, 0.2); color: var(--green); }
        .BAJISTA { background: rgba(246, 70, 93, 0.2); color: var(--red); }
        .NEUTRAL { background: #2b3139; color: var(--muted); }
        .chart-container { height: 500px; border-radius: 12px; overflow: hidden; border: 1px solid #474d57; }
        .search-box { background: #2b3139; border: 2px solid #474d57; color: #fff; padding: 10px 20px; border-radius: 30px; width: 300px; font-weight: 700; }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h3 class="m-0 fw-bold">🚀 Volumen-369 <span class="badge bg-warning text-dark" style="font-size: 0.5em;">V3 CONFLUENCIA</span></h3>
            <div class="d-flex gap-3 align-items-center">
                <div id="mtf-panel" class="d-flex">
                    <span class="bias-pill" id="b15m">15M: --</span>
                    <span class="bias-pill" id="b1h">1H: --</span>
                    <span class="bias-pill" id="b4h">4H: --</span>
                    <span class="bias-pill" id="b1d">1D: --</span>
                </div>
                <input type="text" id="symbolInput" class="search-box" placeholder="BUSCAR CRYPTO..." onkeypress="if(event.key==='Enter') updateSymbol()">
            </div>
        </div>

        <div class="row g-4">
            <div class="col-lg-8">
                <div class="chart-container" id="tv_chart"></div>
                <div class="card mt-4">
                    <h6 class="metric-label">🎯 Plan Algorítmico (Confirmación MTF)</h6>
                    <div class="row text-center mt-3">
                        <div class="col-3"><div class="metric-label">ENTRADA</div><div id="planEntry" class="fw-bold">---</div></div>
                        <div class="col-3"><div class="metric-label text-danger">STOP LOSS</div><div id="planSL" class="fw-bold text-danger">---</div></div>
                        <div class="col-3"><div class="metric-label text-success">TARGET 1</div><div id="planTP1" class="fw-bold text-success">---</div></div>
                        <div class="col-3"><div class="metric-label text-warning">TARGET 2 (LIQ)</div><div id="planTP2" class="fw-bold text-warning">---</div></div>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="row g-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="metric-label">SENTIMIENTO / CONFLUENCIA</div>
                            <div id="confluence" class="metric-value">---</div>
                            <div id="sentiment" class="fw-bold mt-1">---</div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h6 class="metric-label">FUTUROS (SMART MONEY)</h6>
                            <div class="row mt-2">
                                <div class="col-6"><div class="metric-label">FUNDING</div><div id="funding" class="fw-bold">---</div></div>
                                <div class="col-6"><div class="metric-label">CAMBIO OI</div><div id="oiChange" class="fw-bold">---</div></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h6 class="metric-label">ZONAS DE LIQUIDEZ (IMANES)</h6>
                            <div class="mt-2 p-3 rounded" style="background: rgba(14, 203, 129, 0.1); border-left: 4px solid var(--green);">
                                <div class="metric-label text-success">LIQ SHORTS</div>
                                <div id="liqShorts" class="fw-bold">---</div>
                            </div>
                            <div class="mt-2 p-3 rounded" style="background: rgba(246, 70, 93, 0.1); border-left: 4px solid var(--red);">
                                <div class="metric-label text-danger">LIQ LONGS</div>
                                <div id="liqLongs" class="fw-bold">---</div>
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
                "autosize": true, "symbol": "BINANCE:" + s, "interval": "15", "theme": "dark", "style": "1",
                "container_id": "tv_chart", "studies": ["VWAP@tv-basicstudies", "MASimple@tv-basicstudies"]
            });
        }

        async function updateSymbol() {
            const input = document.getElementById('symbolInput').value.toUpperCase().trim();
            if(!input) return;
            const s = input.endsWith("USDT") ? input : input + "USDT";
            const check = await (await fetch(\`/api/check-symbol?symbol=\${s}\`)).json();
            if(check.exists) { currentSymbol = s; initChart(s); loadData(); document.getElementById('symbolInput').value = ""; }
            else { alert("Moneda no encontrada."); }
        }

        async function loadData() {
            const d = await (await fetch(\`/api/pro-analysis?symbol=\${currentSymbol}\`)).json();
            document.getElementById('confluence').innerText = d.confluence;
            document.getElementById('sentiment').innerText = d.sentiment;
            document.getElementById('funding').innerText = d.funding;
            document.getElementById('oiChange').innerText = d.oiChange;
            document.getElementById('liqShorts').innerText = d.liqShorts;
            document.getElementById('liqLongs').innerText = d.liqLongs;
            document.getElementById('planEntry').innerText = d.plan.entry.toLocaleString();
            document.getElementById('planSL').innerText = d.plan.sl;
            document.getElementById('planTP1').innerText = d.plan.tp1;
            document.getElementById('planTP2').innerText = d.plan.tp2;

            // Update MTF Pills
            const timeframes = ["15m", "1h", "4h", "1d"];
            timeframes.forEach(tf => {
                const el = document.getElementById('b' + tf);
                el.innerText = tf.toUpperCase() + ": " + d.mtf[tf];
                el.className = "bias-pill " + d.mtf[tf];
            });
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 20000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
