/**
 * 🚀 Volumen-369 Trading Bot - Versión ELITE V4 "LIQUIDITY HUNTER"
 * Caza de barridas de volumen, rebotes en imanes y visibilidad ultra-alta.
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
  
  const [c15m, c1h, c4h, c1d] = await Promise.all([
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=50`)
  ]);

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

  const getBias = (candles) => {
    const close = candles.map(c => parseFloat(c[4]));
    const sma50 = close.slice(-50).reduce((a,b)=>a+b,0) / 50;
    const sma200 = close.slice(-100).reduce((a,b)=>a+b,0) / 100;
    return close[close.length-1] > sma50 ? "ALCISTA" : "BAJISTA";
  };

  const bias15m = getBias(c15m);
  const bias1h = getBias(c1h);
  const bias4h = getBias(c4h);
  const bias1d = getBias(c1d);

  const lastPrice = parseFloat(c15m[c15m.length-1][4]);
  const atr15m = calculateATR(c15m.map(c=>parseFloat(c[2])), c15m.map(c=>parseFloat(c[3])), c15m.map(c=>parseFloat(c[4])), 14);

  // LÓGICA DE BARRIDA Y REBOTE (LIQUIDITY HUNTER)
  const liqShorts = lastPrice * 1.025; // Imán superior
  const liqLongs = lastPrice * 0.975;  // Imán inferior
  
  let idea = "ESPERAR BARRIDA";
  let tp1, tp2, sl;

  if (bias1d === "ALCISTA") {
    // Si la tendencia macro es alcista, buscamos que el precio caiga a liquidar LONGs para comprar el rebote
    idea = "COMPRAR REBOTE EN LIQ LONGS";
    sl = (liqLongs * 0.99).toFixed(symbol.includes("USDT") ? 2 : 5);
    tp1 = lastPrice.toFixed(symbol.includes("USDT") ? 2 : 5);
    tp2 = liqShorts.toFixed(symbol.includes("USDT") ? 2 : 5);
  } else {
    // Si la tendencia macro es bajista, buscamos que el precio suba a liquidar SHORTs para vender la caída
    idea = "VENDER RECHAZO EN LIQ SHORTS";
    sl = (liqShorts * 1.01).toFixed(symbol.includes("USDT") ? 2 : 5);
    tp1 = lastPrice.toFixed(symbol.includes("USDT") ? 2 : 5);
    tp2 = liqLongs.toFixed(symbol.includes("USDT") ? 2 : 5);
  }

  return {
    symbol, price: lastPrice,
    mtf: { "15m": bias15m, "1h": bias1h, "4h": bias4h, "1d": bias1d },
    confluence: (bias15m === bias1h && bias1h === bias4h ? "ALTA" : "BAJA"),
    sentiment: futures.funding < 0 ? "MIEDO (Oportunidad Long)" : "EUFORIA (Oportunidad Short)",
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    oiChange: futures.oiChange.toFixed(2) + "%",
    liqShorts: liqShorts.toFixed(symbol.includes("USDT") ? 2 : 5),
    liqLongs: liqLongs.toFixed(symbol.includes("USDT") ? 2 : 5),
    idea,
    plan: { entry: lastPrice.toFixed(symbol.includes("USDT") ? 2 : 5), sl, tp1, tp2 }
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
  if (!r.ok) throw new Error(`API Error`);
  return await r.json();
}

async function handleDashboard() {
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Volumen-369 V4 HUNTER</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        :root { --bg: #0b0e11; --card: #1e2329; --yellow: #f0b90b; --green: #0ecb81; --red: #f6465d; --text: #ffffff; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; font-weight: 700; }
        .card { background: var(--card); border: 2px solid #474d57; border-radius: 15px; padding: 25px; box-shadow: 0 10px 20px rgba(0,0,0,0.6); }
        
        /* VISIBILIDAD ULTRA ALTA */
        .metric-label { color: #b7bdc6; font-size: 0.9rem; text-transform: uppercase; margin-bottom: 5px; }
        .metric-value { font-size: 2.2rem; font-weight: 900; color: var(--yellow); text-shadow: 0 0 10px rgba(240, 185, 11, 0.3); }
        .plan-val { font-size: 1.8rem; font-weight: 900; color: #fff; }
        
        .BUY, .ALCISTA { color: var(--green) !important; }
        .SELL, .BAJISTA { color: var(--red) !important; }
        
        .bias-pill { padding: 8px 15px; border-radius: 10px; font-size: 0.8rem; border: 2px solid transparent; }
        .ALCISTA-P { background: rgba(14, 203, 129, 0.2); border-color: var(--green); color: var(--green); }
        .BAJISTA-P { background: rgba(246, 70, 93, 0.2); border-color: var(--red); color: var(--red); }
        
        .search-box { background: #2b3139; border: 3px solid var(--yellow); color: #fff; padding: 15px 25px; border-radius: 50px; width: 400px; font-size: 1.2rem; outline: none; }
        .liq-zone { padding: 20px; border-radius: 15px; margin-top: 15px; border: 3px solid; }
        .liq-shorts { background: rgba(14, 203, 129, 0.1); border-color: var(--green); }
        .liq-longs { background: rgba(246, 70, 93, 0.1); border-color: var(--red); }
        
        .chart-container { height: 550px; border-radius: 15px; overflow: hidden; border: 2px solid #474d57; }
        #idea-pill { background: var(--yellow); color: #000; padding: 10px 20px; border-radius: 10px; display: inline-block; margin-top: 10px; font-size: 1.1rem; }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h2 class="m-0 fw-bold">🚀 Volumen-369 <span class="badge bg-warning text-dark">V4 HUNTER</span></h2>
            <div class="d-flex gap-3">
                <div id="mtf-panel" class="d-flex gap-2">
                    <span id="b15m" class="bias-pill">15M: --</span>
                    <span id="b1h" class="bias-pill">1H: --</span>
                    <span id="b4h" class="bias-pill">4H: --</span>
                    <span id="b1d" class="bias-pill">1D: --</span>
                </div>
                <input type="text" id="symbolInput" class="search-box" placeholder="BUSCAR CRYPTO (BTC, SOL...)" onkeypress="if(event.key==='Enter') updateSymbol()">
            </div>
        </div>

        <div class="row g-4">
            <div class="col-lg-8">
                <div class="chart-container" id="tv_chart"></div>
                <!-- PLAN OPERATIVO -->
                <div class="card mt-4">
                    <div class="d-flex justify-content-between">
                        <h4 class="metric-label">🎯 PLAN DE REBOTE INSTITUCIONAL</h4>
                        <div id="idea-pill">ESPERANDO SEÑAL...</div>
                    </div>
                    <div class="row text-center mt-4">
                        <div class="col-3"><div class="metric-label">ENTRADA</div><div id="planEntry" class="plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-danger">STOP LOSS</div><div id="planSL" class="SELL plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-success">TARGET 1</div><div id="planTP1" class="BUY plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-warning">TARGET 2 (BARRIDA)</div><div id="planTP2" class="plan-val" style="color: var(--yellow);">---</div></div>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="row g-4">
                    <div class="col-12">
                        <div class="card">
                            <div class="metric-label">PRECIO <span id="curSymbol" class="text-white">BTCUSDT</span></div>
                            <div id="price" class="metric-value">---</div>
                            <hr>
                            <div class="metric-label">SENTIMIENTO DE MERCADO</div>
                            <div id="sentiment" class="h4">---</div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label">IMANES DE LIQUIDACIÓN (TARGETS)</h5>
                            <div class="liq-zone liq-shorts">
                                <div class="metric-label text-success">LIQUIDACIÓN DE SHORTS (ARRIBA)</div>
                                <div id="liqShorts" class="BUY h3 m-0">---</div>
                            </div>
                            <div class="liq-zone liq-longs">
                                <div class="metric-label text-danger">LIQUIDACIÓN DE LONGS (ABAJO)</div>
                                <div id="liqLongs" class="SELL h3 m-0">---</div>
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
            let input = document.getElementById('symbolInput').value.toUpperCase().trim();
            if(!input) return;
            if(!input.endsWith("USDT")) input += "USDT";
            const res = await (await fetch(\`/api/check-symbol?symbol=\${input}\`)).json();
            if(res.exists) { currentSymbol = input; initChart(input); loadData(); document.getElementById('symbolInput').value = ""; }
            else { alert("Moneda no encontrada."); }
        }

        async function loadData() {
            const d = await (await fetch(\`/api/pro-analysis?symbol=\${currentSymbol}\`)).json();
            document.getElementById('price').innerText = d.price.toLocaleString();
            document.getElementById('curSymbol').innerText = d.symbol;
            document.getElementById('sentiment').innerText = d.sentiment;
            document.getElementById('liqShorts').innerText = d.liqShorts;
            document.getElementById('liqLongs').innerText = d.liqLongs;
            document.getElementById('idea-pill').innerText = d.idea;
            document.getElementById('planEntry').innerText = d.plan.entry;
            document.getElementById('planSL').innerText = d.plan.sl;
            document.getElementById('planTP1').innerText = d.plan.tp1;
            document.getElementById('planTP2').innerText = d.plan.tp2;

            const tfs = ["15m", "1h", "4h", "1d"];
            tfs.forEach(tf => {
                const el = document.getElementById('b' + tf);
                el.innerText = tf.toUpperCase() + ": " + d.mtf[tf];
                el.className = "bias-pill " + d.mtf[tf] + "-P";
            });
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 15000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
