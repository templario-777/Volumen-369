/**
 * 🚀 Volumen-369 Trading Bot - Versión ELITE V5 "MAGNET GRAVITY"
 * Lógica: Entrada en Imanes de Liquidación + Gravedad del Order Book.
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
  
  const [c15m, c1h, c4h, c1d, depth] = await Promise.all([
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=100`),
    fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=50`),
    fetchBinance(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`)
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

  const lastPrice = parseFloat(c15m[c15m.length-1][4]);
  
  // ANALISIS DE GRAVEDAD DEL ORDER BOOK (BIDS VS ASKS)
  const totalBids = depth.bids.reduce((a, b) => a + parseFloat(b[1]), 0);
  const totalAsks = depth.asks.reduce((a, b) => a + parseFloat(b[1]), 0);
  const gravitySource = totalBids > totalAsks ? "COMPRADORES (BIDS)" : "VENDEDORES (ASKS)";
  const gravityPower = ((Math.max(totalBids, totalAsks) / (totalBids + totalAsks)) * 100).toFixed(1);

  // LÓGICA MAGNET GRAVITY: Entrada en el Imán de Liquidación
  const liqShorts = lastPrice * 1.025; // Imán Superior
  const liqLongs = lastPrice * 0.975;  // Imán Inferior
  
  let idea = "";
  let entry, tp1, tp2, sl;

  // El precio siempre va hacia donde hay más volumen (Gravedad)
  if (totalBids > totalAsks) {
    // La masa de dinero está abajo (Bids). El precio cae al imán de Longs, ahí rebotamos.
    idea = "REBOTE EN IMÁN DE LONGS";
    entry = liqLongs;
    sl = (entry * 0.992).toFixed(symbol.includes("USDT") ? 2 : 5);
    tp1 = lastPrice.toFixed(symbol.includes("USDT") ? 2 : 5); // Volver al precio actual
    tp2 = liqShorts.toFixed(symbol.includes("USDT") ? 2 : 5); // Barrida total al imán opuesto
  } else {
    // La masa de dinero está arriba (Asks). El precio sube al imán de Shorts, ahí rechazamos.
    idea = "RECHAZO EN IMÁN DE SHORTS";
    entry = liqShorts;
    sl = (entry * 1.008).toFixed(symbol.includes("USDT") ? 2 : 5);
    tp1 = lastPrice.toFixed(symbol.includes("USDT") ? 2 : 5);
    tp2 = liqLongs.toFixed(symbol.includes("USDT") ? 2 : 5);
  }

  return {
    symbol, price: lastPrice,
    gravitySource, gravityPower: gravityPower + "%",
    liqShorts: liqShorts.toFixed(symbol.includes("USDT") ? 2 : 5),
    liqLongs: liqLongs.toFixed(symbol.includes("USDT") ? 2 : 5),
    idea,
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    plan: { 
      entry: entry.toFixed(symbol.includes("USDT") ? 2 : 5), 
      sl, tp1, tp2 
    }
  };
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
    <title>Volumen-369 V5 GRAVITY</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        :root { --bg: #0b0e11; --card: #1e2329; --yellow: #f0b90b; --green: #0ecb81; --red: #f6465d; --text: #ffffff; }
        body { background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; font-weight: 800; }
        .card { background: var(--card); border: 3px solid #474d57; border-radius: 20px; padding: 30px; box-shadow: 0 15px 30px rgba(0,0,0,0.7); }
        
        .metric-label { color: #b7bdc6; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; }
        .metric-value { font-size: 2.8rem; font-weight: 900; color: var(--yellow); text-shadow: 0 0 15px rgba(240, 185, 11, 0.4); }
        .plan-val { font-size: 2.2rem; font-weight: 900; color: #fff; }
        
        .BUY { color: var(--green) !important; }
        .SELL { color: var(--red) !important; }
        
        .search-box { background: #2b3139; border: 4px solid var(--yellow); color: #fff; padding: 18px 30px; border-radius: 60px; width: 450px; font-size: 1.4rem; outline: none; box-shadow: 0 0 20px rgba(240, 185, 11, 0.2); }
        
        .liq-zone { padding: 25px; border-radius: 20px; margin-top: 20px; border: 4px solid; position: relative; overflow: hidden; }
        .liq-shorts { background: rgba(14, 203, 129, 0.15); border-color: var(--green); }
        .liq-longs { background: rgba(246, 70, 93, 0.15); border-color: var(--red); }
        
        .chart-container { height: 600px; border-radius: 20px; overflow: hidden; border: 3px solid #474d57; }
        #idea-pill { background: var(--yellow); color: #000; padding: 12px 25px; border-radius: 12px; font-size: 1.3rem; font-weight: 900; box-shadow: 0 5px 15px rgba(240, 185, 11, 0.4); }
        
        .gravity-bar { height: 12px; background: #2b3139; border-radius: 10px; margin-top: 10px; overflow: hidden; border: 1px solid #474d57; }
        .gravity-fill { height: 100%; background: var(--yellow); transition: 0.5s; box-shadow: 0 0 10px var(--yellow); }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h1 class="m-0 fw-bold">🚀 Volumen-369 <span class="badge bg-warning text-dark">V5 MAGNET GRAVITY</span></h1>
            <input type="text" id="symbolInput" class="search-box" placeholder="BUSCAR CRYPTO (BTC, ETH...)" onkeypress="if(event.key==='Enter') updateSymbol()">
        </div>

        <div class="row g-4">
            <div class="col-lg-8">
                <div class="chart-container" id="tv_chart"></div>
                <!-- PLAN MAGNET GRAVITY -->
                <div class="card mt-4">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h4 class="metric-label m-0">🎯 ENTRADA EN IMÁN DE LIQUIDACIÓN</h4>
                            <div id="idea-pill" class="mt-2">BUSCANDO GRAVEDAD...</div>
                        </div>
                        <div class="text-end" style="width: 300px;">
                            <div class="metric-label">FUERZA DE GRAVEDAD (<span id="gravitySource">---</span>)</div>
                            <div class="gravity-bar"><div id="gravityFill" class="gravity-fill" style="width: 0%"></div></div>
                            <div id="gravityPower" class="mt-1" style="color: var(--yellow);">---</div>
                        </div>
                    </div>
                    <div class="row text-center mt-4">
                        <div class="col-3"><div class="metric-label">ENTRADA (IMÁN)</div><div id="planEntry" class="plan-val" style="color: var(--yellow);">---</div></div>
                        <div class="col-3"><div class="metric-label text-danger">STOP LOSS</div><div id="planSL" class="SELL plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-success">TARGET 1 (REBOTE)</div><div id="planTP1" class="BUY plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-warning">TARGET 2 (BARRIDA TOTAL)</div><div id="planTP2" class="plan-val" style="color: #fff;">---</div></div>
                    </div>
                </div>
            </div>

            <div class="col-lg-4">
                <div class="row g-4">
                    <div class="col-12">
                        <div class="card text-center">
                            <div class="metric-label">PRECIO ACTUAL <span id="curSymbol" class="text-white">BTCUSDT</span></div>
                            <div id="price" class="metric-value">---</div>
                            <hr>
                            <div class="row">
                                <div class="col-6"><div class="metric-label">FUNDING</div><div id="funding" class="h5">---</div></div>
                                <div class="col-6"><div class="metric-label">OPEN INTEREST</div><div id="oi" class="h5">---</div></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">NIVELES DE ENTRADA ALGORÍTMICA (IMANES)</h5>
                            <div class="liq-zone liq-shorts">
                                <div class="metric-label text-success">LIQUIDACIÓN DE SHORTS (PUNTO DE REBOTE)</div>
                                <div id="liqShorts" class="BUY h1 m-0">---</div>
                            </div>
                            <div class="liq-zone liq-longs">
                                <div class="metric-label text-danger">LIQUIDACIÓN DE LONGS (PUNTO DE REBOTE)</div>
                                <div id="liqLongs" class="SELL h1 m-0">---</div>
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
                "container_id": "tv_chart", "studies": ["VWAP@tv-basicstudies"]
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
            document.getElementById('liqShorts').innerText = d.liqShorts;
            document.getElementById('liqLongs').innerText = d.liqLongs;
            document.getElementById('idea-pill').innerText = d.idea;
            document.getElementById('planEntry').innerText = d.plan.entry;
            document.getElementById('planSL').innerText = d.plan.sl;
            document.getElementById('planTP1').innerText = d.plan.tp1;
            document.getElementById('planTP2').innerText = d.plan.tp2;
            document.getElementById('gravitySource').innerText = d.gravitySource;
            document.getElementById('gravityPower').innerText = d.gravityPower;
            document.getElementById('gravityFill').style.width = d.gravityPower;
            document.getElementById('funding').innerText = d.funding;
            document.getElementById('oi').innerText = d.oi;
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 10000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
