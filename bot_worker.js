/**
 * 🚀 Volumen-369 Trading Bot - Versión PRO ELITE
 * Análisis de Volumen, VWAP, Futuros, Liquidaciones y Gráficos en Tiempo Real.
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
  try {
    const data = await fetchBinance(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol.toUpperCase()}`);
    return !!data.symbol;
  } catch (e) {
    return false;
  }
}

async function getProAnalysis(symbol) {
  symbol = symbol.toUpperCase();
  // 1. Obtener datos básicos y velas
  const candles = await fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=100`);
  const orderBook = await fetchBinance(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=100`);
  
  // 2. Datos de Futuros (Si es posible)
  let futuresData = { fundingRate: "0.00%", openInterest: "N/D" };
  try {
    const fTicker = await fetchBinance(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    const fOI = await fetchBinance(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`);
    futuresData.fundingRate = (parseFloat(fTicker.lastFundingRate) * 100).toFixed(4) + "%";
    futuresData.openInterest = parseFloat(fOI.openInterest).toLocaleString();
  } catch(e) {}

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

  // ATR (14 periodos)
  let trSum = 0;
  for(let i=candles.length-14; i<candles.length; i++) {
    trSum += Math.max(high[i]-low[i], Math.abs(high[i]-close[i-1] || 0), Math.abs(low[i]-close[i-1] || 0));
  }
  const atr = trSum / 14;

  // Presión Compra/Venta
  const bids = orderBook.bids.reduce((a, b) => a + parseFloat(b[1]), 0);
  const asks = orderBook.asks.reduce((a, b) => a + parseFloat(b[1]), 0);
  const buyPressure = (bids / (bids + asks) * 100).toFixed(1);

  // Liquidación Estimada
  const liqShorts = (lastClose * 1.012).toFixed(symbol.includes("USDT") ? 2 : 4);
  const liqLongs = (lastClose * 0.988).toFixed(symbol.includes("USDT") ? 2 : 4);

  // RVOL
  const avgVol = vol.slice(-21, -1).reduce((a,b)=>a+b, 0) / 20;
  const rvol = vol[vol.length-1] / (avgVol || 1);

  return {
    symbol,
    price: lastClose,
    rvol: rvol.toFixed(2),
    vwap: vwap.toFixed(symbol.includes("USDT") ? 2 : 4),
    buyPressure: buyPressure + "%",
    sellPressure: (100 - buyPressure).toFixed(1) + "%",
    fundingRate: futuresData.fundingRate,
    openInterest: futuresData.openInterest,
    liqZoneShorts: liqShorts,
    liqZoneLongs: liqLongs,
    plan: {
      entry: lastClose,
      sl: (lastClose - (atr * 1.5)).toFixed(symbol.includes("USDT") ? 2 : 4),
      tp1: (lastClose + (atr * 1.5)).toFixed(symbol.includes("USDT") ? 2 : 4),
      tp2: (lastClose + (atr * 3)).toFixed(symbol.includes("USDT") ? 2 : 4)
    },
    signal: rvol > 1.8 && lastClose > vwap ? "BUY" : (rvol > 1.8 && lastClose < vwap ? "SELL" : "HOLD")
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
    <title>Volumen-369 ELITE</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #0b0e11; color: #ffffff; font-family: 'Inter', sans-serif; }
        .card { background: #1e2329; border: 1px solid #474d57; border-radius: 12px; padding: 20px; height: 100%; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
        .metric-label { color: #b7bdc6; font-size: 0.8rem; text-transform: uppercase; font-weight: 500; margin-bottom: 4px; }
        .metric-value { font-size: 1.4rem; font-weight: 700; color: #f0b90b; }
        .BUY { color: #0ecb81 !important; font-weight: 800; }
        .SELL { color: #f6465d !important; font-weight: 800; }
        .HOLD { color: #848e9c !important; }
        .chart-container { height: 500px; border-radius: 12px; overflow: hidden; border: 1px solid #474d57; background: #161a1e; }
        .search-box { background: #2b3139; border: 1px solid #474d57; color: #ffffff; padding: 10px 20px; border-radius: 25px; width: 280px; font-weight: 500; }
        .search-box::placeholder { color: #848e9c; }
        .liq-box { border-left: 4px solid #f0b90b; background: rgba(240, 185, 11, 0.1); padding: 12px; margin-top: 10px; border-radius: 0 8px 8px 0; }
        .liq-box-long { border-left: 4px solid #f6465d; background: rgba(246, 70, 93, 0.1); }
        .btn-update { background: #f0b90b; color: #000000; border-radius: 25px; font-weight: 700; padding: 10px 25px; transition: all 0.2s; border: none; }
        .btn-update:hover { background: #dcb000; transform: scale(1.05); }
        .plan-val { color: #ffffff; font-weight: 600; font-size: 1.1rem; }
        hr { border-color: #474d57; opacity: 0.3; }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <!-- Header -->
        <div class="d-flex justify-content-between align-items-center mb-4">
            <h3 class="m-0">🚀 Volumen-369 <span class="badge bg-warning text-dark" style="font-size: 0.4em;">ELITE</span></h3>
            <div class="d-flex gap-2">
                <input type="text" id="symbolInput" class="search-box" placeholder="Ej: BTCUSDT, SOLUSDT..." onkeypress="if(event.key==='Enter') updateSymbol()">
                <button onclick="updateSymbol()" class="btn btn-update">BUSCAR</button>
            </div>
        </div>

        <div class="row g-3">
            <!-- Columna Izquierda: Gráfico -->
            <div class="col-lg-8">
                <div class="chart-container" id="tv_chart"></div>
                
                <div class="row g-3 mt-1">
                    <div class="col-md-12">
                        <div class="card">
                            <h6 class="metric-label">🎯 Plan Cuantitativo ATR (Gestión de Riesgo)</h6>
                            <div class="d-flex justify-content-between text-center mt-2">
                                <div><div class="metric-label">Entrada</div><div id="planEntry" class="plan-val">---</div></div>
                                <div><div class="metric-label text-danger">Stop Loss</div><div id="planSL" class="SELL plan-val">---</div></div>
                                <div><div class="metric-label text-success">Target 1</div><div id="planTP1" class="BUY plan-val">---</div></div>
                                <div><div class="metric-label text-success">Target 2</div><div id="planTP2" class="BUY plan-val">---</div></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Columna Derecha: Métricas Pro -->
            <div class="col-lg-4">
                <div class="row g-3">
                    <div class="col-12">
                        <div class="card">
                            <div class="d-flex justify-content-between">
                                <div>
                                    <div class="metric-label">Precio <span id="curSymbol">BTCUSDT</span></div>
                                    <div id="price" class="metric-value" style="font-size: 1.8rem;">---</div>
                                </div>
                                <div class="text-end">
                                    <div class="metric-label">Señal</div>
                                    <div id="signal" class="h5">HOLD</div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-6">
                                    <div class="metric-label">RVOL (Volumen)</div>
                                    <div id="rvol">---</div>
                                </div>
                                <div class="col-6">
                                    <div class="metric-label">VWAP (Inst)</div>
                                    <div id="vwap">---</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-12">
                        <div class="card">
                            <div class="metric-label">Presión de Compra / Venta (Order Book)</div>
                            <div class="progress mt-2" style="height: 20px; background: #f6465d; border-radius: 10px;">
                                <div id="pressureBar" class="progress-bar bg-success" style="width: 50%"></div>
                            </div>
                            <div class="d-flex justify-content-between mt-1" style="font-size: 0.75rem;">
                                <span id="buyText">---</span>
                                <span id="sellText">---</span>
                            </div>
                        </div>
                    </div>

                    <div class="col-12">
                        <div class="card">
                            <div class="metric-label">Datos de Futuros</div>
                            <div class="row mt-2">
                                <div class="col-6">
                                    <div class="metric-label">Funding Rate</div>
                                    <div id="funding" style="color: #fff;">---</div>
                                </div>
                                <div class="col-6">
                                    <div class="metric-label">Open Interest</div>
                                    <div id="oi" style="color: #fff;">---</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="col-12">
                        <div class="card">
                            <div class="metric-label">Mapa de Liquidación (Imanes)</div>
                            <div class="liq-box">
                                <small class="metric-label">Zona Shorts (Barrida Arriba)</small><br>
                                <span id="liqShorts" class="BUY" style="font-size: 1.1rem;">---</span>
                            </div>
                            <div class="liq-box liq-box-long mt-2">
                                <small class="metric-label">Zona Longs (Barrida Abajo)</small><br>
                                <span id="liqLongs" class="SELL" style="font-size: 1.1rem;">---</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- TradingView Widget -->
    <script type="text/javascript" src="https://s3.tradingview.com/tv.js"></script>
    <script>
        let currentSymbol = "BTCUSDT";
        let widget = null;

        function initChart(symbol) {
            widget = new TradingView.widget({
                "autosize": true,
                "symbol": "BINANCE:" + symbol,
                "interval": "5",
                "timezone": "Etc/UTC",
                "theme": "dark",
                "style": "1",
                "locale": "es",
                "toolbar_bg": "#f1f3f6",
                "enable_publishing": false,
                "hide_top_toolbar": false,
                "save_image": false,
                "container_id": "tv_chart",
                "studies": [
                    "VWAP@tv-basicstudies",
                    "MASimple@tv-basicstudies"
                ]
            });
        }

        async function updateSymbol() {
            const input = document.getElementById('symbolInput').value.toUpperCase();
            if(!input) return;
            
            const check = await fetch(\`/api/check-symbol?symbol=\${input}\`);
            const res = await check.json();
            
            if(res.exists) {
                currentSymbol = input;
                initChart(currentSymbol);
                loadProData();
                document.getElementById('symbolInput').value = "";
            } else {
                alert("Símbolo no encontrado en Binance. Usa formato BTCUSDT");
            }
        }

        async function loadProData() {
            try {
                const r = await fetch(\`/api/pro-analysis?symbol=\${currentSymbol}\`);
                const d = await r.json();

                document.getElementById('curSymbol').innerText = d.symbol;
                document.getElementById('price').innerText = d.price.toLocaleString();
                document.getElementById('rvol').innerText = d.rvol + "x";
                document.getElementById('vwap').innerText = d.vwap;
                document.getElementById('signal').innerText = d.signal;
                document.getElementById('signal').className = "h5 " + d.signal;
                
                document.getElementById('pressureBar').style.width = d.buyPressure;
                document.getElementById('buyText').innerText = d.buyPressure + " Compra";
                document.getElementById('sellText').innerText = d.sellPressure + " Venta";
                
                document.getElementById('funding').innerText = d.fundingRate;
                document.getElementById('oi').innerText = d.openInterest;
                document.getElementById('liqShorts').innerText = d.liqZoneShorts;
                document.getElementById('liqLongs').innerText = d.liqZoneLongs;

                document.getElementById('planEntry').innerText = d.plan.entry.toLocaleString();
                document.getElementById('planSL').innerText = d.plan.sl;
                document.getElementById('planTP1').innerText = d.plan.tp1;
                document.getElementById('planTP2').innerText = d.plan.tp2;
            } catch(e) {}
        }

        initChart(currentSymbol);
        loadProData();
        setInterval(loadProData, 10000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
