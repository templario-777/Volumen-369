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
    fetchKlines(symbol, "15m", 200),
    fetchKlines(symbol, "1h", 200),
    fetchKlines(symbol, "4h", 200),
    fetchKlines(symbol, "1d", 200),
    fetchDepth(symbol, 100)
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

  const fmtDp = symbol.includes("USDT") ? 2 : 6;
  const obImbalance = (totalBids + totalAsks) > 0 ? totalBids / (totalBids + totalAsks) : 0.5;

  const profiles = {
    "15m": computeVolumeProfile(c15m, lastPrice, 90),
    "1h": computeVolumeProfile(c1h, lastPrice, 90),
    "4h": computeVolumeProfile(c4h, lastPrice, 90),
    "1d": computeVolumeProfile(c1d, lastPrice, 90),
  };

  const mtf = Object.fromEntries(Object.entries(profiles).map(([tf, p]) => ([
    tf,
    {
      poc: p.poc,
      magnetUp: p.magnetUp,
      magnetDown: p.magnetDown,
      dominant: p.dominant,
      dominance: p.dominance,
    }
  ])));

  const entrySide = obImbalance >= 0.55 ? "ABAJO" : (obImbalance <= 0.45 ? "ARRIBA" : profiles["4h"].dominant);
  const entryPick = pickMagnet(mtf, entrySide);
  const oppPick = pickMagnet(mtf, entrySide === "ABAJO" ? "ARRIBA" : "ABAJO");

  const entry = entryPick.price ?? lastPrice;
  const tp2 = oppPick.price ?? (entrySide === "ABAJO" ? (lastPrice * 1.02) : (lastPrice * 0.98));

  const atr15m = calculateATR(
    c15m.map(c => parseFloat(c[2])),
    c15m.map(c => parseFloat(c[3])),
    c15m.map(c => parseFloat(c[4])),
    14
  );
  const slDist = Math.max(atr15m * 1.25, entry * 0.0035);
  const sl = (entrySide === "ABAJO" ? (entry - slDist) : (entry + slDist));

  const tp1 = profiles["15m"].poc ?? lastPrice;

  const idea = entrySide === "ABAJO"
    ? `ENTRAR EN IMÁN ABAJO (${entryPick.tf}) Y BUSCAR BARRIDA ARRIBA (${oppPick.tf})`
    : `ENTRAR EN IMÁN ARRIBA (${entryPick.tf}) Y BUSCAR BARRIDA ABAJO (${oppPick.tf})`;

  const sentiment = buildSentiment({
    obImbalance,
    futuresFunding: futures.funding,
    oiChange: futures.oiChange,
    dominance4h: profiles["4h"].dominance,
    entrySide,
    entryTf: entryPick.tf,
  });

  return {
    symbol, price: lastPrice,
    gravitySource, gravityPower: gravityPower + "%",
    orderBookImbalance: (obImbalance * 100).toFixed(1) + "%",
    mtf,
    liqShorts: (profiles["4h"].magnetUp ?? (lastPrice * 1.02)).toFixed(fmtDp),
    liqLongs: (profiles["4h"].magnetDown ?? (lastPrice * 0.98)).toFixed(fmtDp),
    idea,
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    oiChange: futures.oiChange.toFixed(2) + "%",
    sentiment,
    plan: { 
      entry: entry.toFixed(fmtDp),
      sl: sl.toFixed(fmtDp),
      tp1: tp1.toFixed(fmtDp),
      tp2: tp2.toFixed(fmtDp),
      entryTf: entryPick.tf,
      targetTf: oppPick.tf
    }
  };
}

async function fetchKlines(symbol, interval, limit) {
  try {
    return await fetchBinance(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  } catch (e) {
    return await fetchBinance(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  }
}

async function fetchDepth(symbol, limit) {
  try {
    return await fetchBinance(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${limit}`);
  } catch (e) {
    return await fetchBinance(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
  }
}

function computeVolumeProfile(candles, currentPrice, bins) {
  const tps = [];
  const vols = [];
  for (const c of candles) {
    const h = parseFloat(c[2]);
    const l = parseFloat(c[3]);
    const cl = parseFloat(c[4]);
    const v = parseFloat(c[5]);
    const tp = (h + l + cl) / 3;
    if (Number.isFinite(tp) && Number.isFinite(v)) {
      tps.push(tp);
      vols.push(v);
    }
  }
  if (tps.length === 0) {
    return { poc: null, magnetUp: null, magnetDown: null, dominant: "NEUTRAL", dominance: 0 };
  }
  let min = tps[0], max = tps[0];
  for (const tp of tps) {
    if (tp < min) min = tp;
    if (tp > max) max = tp;
  }
  const range = max - min;
  if (range <= 0) {
    return { poc: tps[tps.length - 1], magnetUp: tps[tps.length - 1], magnetDown: tps[tps.length - 1], dominant: "NEUTRAL", dominance: 0 };
  }
  const step = range / Math.max(10, bins);
  const binCount = Math.max(10, bins);
  const vb = Array(binCount).fill(0);
  for (let i = 0; i < tps.length; i++) {
    const idx = Math.max(0, Math.min(binCount - 1, Math.floor((tps[i] - min) / step)));
    vb[idx] += vols[i];
  }
  let maxVol = vb[0];
  let pocIdx = 0;
  for (let i = 1; i < vb.length; i++) {
    if (vb[i] > maxVol) {
      maxVol = vb[i];
      pocIdx = i;
    }
  }
  const poc = min + step * (pocIdx + 0.5);

  let upIdx = null;
  let downIdx = null;
  let upVol = 0;
  let downVol = 0;
  let upAgg = 0;
  let downAgg = 0;

  for (let i = 0; i < vb.length; i++) {
    const mid = min + step * (i + 0.5);
    const v = vb[i];
    if (mid >= currentPrice) {
      upAgg += v;
      if (v > upVol) {
        upVol = v;
        upIdx = i;
      }
    } else {
      downAgg += v;
      if (v > downVol) {
        downVol = v;
        downIdx = i;
      }
    }
  }

  const magnetUp = upIdx === null ? null : (min + step * (upIdx + 0.5));
  const magnetDown = downIdx === null ? null : (min + step * (downIdx + 0.5));
  const dominant = downAgg > upAgg ? "ABAJO" : (upAgg > downAgg ? "ARRIBA" : "NEUTRAL");
  const dominance = (upAgg + downAgg) > 0 ? Math.max(upAgg, downAgg) / (upAgg + downAgg) : 0;

  return { poc, magnetUp, magnetDown, dominant, dominance };
}

function pickMagnet(mtf, side) {
  const order = ["1d", "4h", "1h", "15m"];
  let best = { tf: order[order.length - 1], price: null, dominance: -1 };
  for (const tf of order) {
    const p = mtf[tf];
    if (!p) continue;
    const price = side === "ABAJO" ? p.magnetDown : p.magnetUp;
    const dominance = typeof p.dominance === "number" ? p.dominance : 0;
    if (price != null && dominance > best.dominance) {
      best = { tf, price, dominance };
    }
  }
  if (best.price == null) {
    return { tf: "15m", price: null, dominance: 0 };
  }
  return best;
}

function buildSentiment({ obImbalance, futuresFunding, oiChange, dominance4h, entrySide, entryTf }) {
  const obScore = Math.round(100 * Math.abs(obImbalance - 0.5) * 2);
  const fundingScore = Math.min(100, Math.round(Math.abs(futuresFunding) * 100000));
  const oiScore = Math.min(100, Math.round(Math.abs(oiChange) * 40));
  const domScore = Math.min(100, Math.round((dominance4h || 0) * 100));
  const base = Math.round(obScore * 0.35 + fundingScore * 0.2 + oiScore * 0.25 + domScore * 0.2);

  let bias = "NEUTRAL";
  if (entrySide === "ABAJO") bias = obImbalance >= 0.55 ? "ALCISTA" : "ALCISTA (CONTRARIA)";
  if (entrySide === "ARRIBA") bias = obImbalance <= 0.45 ? "BAJISTA" : "BAJISTA (CONTRARIA)";

  let label = "DÉBIL";
  if (base >= 70) label = "FUERTE";
  else if (base >= 45) label = "MODERADO";

  return { score: base, label, bias, entryTf };
}

function calculateATR(high, low, close, period) {
  const trs = [];
  for (let i = 1; i < close.length; i++) {
    const tr = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
    if (Number.isFinite(tr)) trs.push(tr);
  }
  const slice = trs.slice(-Math.max(1, period));
  if (slice.length === 0) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
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
        
        .metric-label { color: #d5d9e0; font-size: 1.02rem; text-transform: uppercase; letter-spacing: 1px; }
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
        .mtf-table { width: 100%; margin-top: 10px; font-size: 0.95rem; }
        .mtf-table td { padding: 8px 6px; border-bottom: 1px solid rgba(71, 77, 87, 0.6); }
        .mtf-tag { font-weight: 900; color: #fff; }
        .mono { font-variant-numeric: tabular-nums; letter-spacing: 0.5px; }
        #funding, #oi, #oiChange, #obImb { color: #ffffff; font-weight: 900; font-size: 1.25rem; }
        #sentimentBox { color: #ffffff; font-weight: 900; font-size: 1.25rem; }
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
                    <div class="col-3"><div class="metric-label">ENTRADA (IMÁN)</div><div id="planEntry" class="plan-val mono" style="color: var(--yellow);">---</div><div id="planEntryTf" style="color:#d5d9e0; font-size:0.95rem;"></div></div>
                        <div class="col-3"><div class="metric-label text-danger">STOP LOSS</div><div id="planSL" class="SELL plan-val">---</div></div>
                        <div class="col-3"><div class="metric-label text-success">TARGET 1 (REBOTE)</div><div id="planTP1" class="BUY plan-val">---</div></div>
                    <div class="col-3"><div class="metric-label text-warning">TARGET 2 (IMÁN OPUESTO)</div><div id="planTP2" class="plan-val mono" style="color: #fff;">---</div><div id="planTargetTf" style="color:#d5d9e0; font-size:0.95rem;"></div></div>
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
                            <div class="row mt-3">
                                <div class="col-6"><div class="metric-label">OI Δ</div><div id="oiChange" class="h5">---</div></div>
                                <div class="col-6"><div class="metric-label">OB Δ</div><div id="obImb" class="h5">---</div></div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12"><div class="metric-label">SENTIMIENTO</div><div id="sentimentBox" class="h4" style="color:#fff;"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">NIVELES DE ENTRADA ALGORÍTMICA (IMANES)</h5>
                            <table class="mtf-table">
                                <tbody>
                                    <tr><td class="mtf-tag">15M</td><td>POC</td><td id="poc15m" class="mono"></td><td>⬆</td><td id="up15m" class="mono"></td><td>⬇</td><td id="dn15m" class="mono"></td></tr>
                                    <tr><td class="mtf-tag">1H</td><td>POC</td><td id="poc1h" class="mono"></td><td>⬆</td><td id="up1h" class="mono"></td><td>⬇</td><td id="dn1h" class="mono"></td></tr>
                                    <tr><td class="mtf-tag">4H</td><td>POC</td><td id="poc4h" class="mono"></td><td>⬆</td><td id="up4h" class="mono"></td><td>⬇</td><td id="dn4h" class="mono"></td></tr>
                                    <tr><td class="mtf-tag">1D</td><td>POC</td><td id="poc1d" class="mono"></td><td>⬆</td><td id="up1d" class="mono"></td><td>⬇</td><td id="dn1d" class="mono"></td></tr>
                                </tbody>
                            </table>
                            <div class="liq-zone liq-shorts">
                                <div class="metric-label text-success">LIQUIDACIÓN DE SHORTS (PUNTO DE REBOTE)</div>
                                <div id="liqShorts" class="BUY h1 m-0 mono">---</div>
                            </div>
                            <div class="liq-zone liq-longs">
                                <div class="metric-label text-danger">LIQUIDACIÓN DE LONGS (PUNTO DE REBOTE)</div>
                                <div id="liqLongs" class="SELL h1 m-0 mono">---</div>
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
        let tvWidget = null;
        function initChart(s) {
            tvWidget = new TradingView.widget({
                "autosize": true, "symbol": "BINANCE:" + s, "interval": "15", "theme": "dark", "style": "1",
                "container_id": "tv_chart", "studies": ["VWAP@tv-basicstudies"]
            });

            try {
                tvWidget.onChartReady(function() {
                    try {
                        tvWidget.chart().onSymbolChanged().subscribe(null, function(sym) {
                            const raw = (sym && sym.name) ? sym.name : "";
                            const parsed = parseTvSymbol(raw);
                            if (parsed) {
                                setSymbolFromChart(parsed);
                            }
                        });
                    } catch (e) {}
                });
            } catch (e) {}
        }

        async function updateSymbol() {
            let input = document.getElementById('symbolInput').value.toUpperCase().trim();
            if(!input) return;
            if(!input.endsWith("USDT")) input += "USDT";
            const res = await (await fetch(\`/api/check-symbol?symbol=\${input}\`)).json();
            if(res.exists) { currentSymbol = input; initChart(input); loadData(); document.getElementById('symbolInput').value = ""; }
            else { alert("Moneda no encontrada."); }
        }

        function parseTvSymbol(raw) {
            if (!raw) return null;
            let s = raw;
            const idx = s.indexOf(":");
            if (idx >= 0) s = s.slice(idx + 1);
            const dot = s.indexOf(".");
            if (dot >= 0) s = s.slice(0, dot);
            s = s.replace(/USDTPERP$/i, "USDT");
            s = s.replace(/PERP$/i, "");
            s = s.toUpperCase().trim();
            if (!s) return null;
            if (!s.endsWith("USDT") && !s.endsWith("BUSD") && !s.endsWith("USDC")) s = s + "USDT";
            return s;
        }

        async function setSymbolFromChart(symbol) {
            if (symbol === currentSymbol) return;
            const res = await (await fetch(\`/api/check-symbol?symbol=\${symbol}\`)).json();
            if (res.exists) {
                currentSymbol = symbol;
                document.getElementById('symbolInput').value = "";
                loadData();
            }
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
            document.getElementById('planEntryTf').innerText = d.plan.entryTf ? ('TF: ' + d.plan.entryTf.toUpperCase()) : '';
            document.getElementById('planTargetTf').innerText = d.plan.targetTf ? ('TF: ' + d.plan.targetTf.toUpperCase()) : '';
            document.getElementById('gravitySource').innerText = d.gravitySource;
            document.getElementById('gravityPower').innerText = d.gravityPower;
            document.getElementById('gravityFill').style.width = d.gravityPower;
            document.getElementById('funding').innerText = d.funding;
            document.getElementById('oi').innerText = d.oi;
            document.getElementById('oiChange').innerText = d.oiChange || '---';
            document.getElementById('obImb').innerText = d.orderBookImbalance || '---';

            const s = d.sentiment;
            if (s && typeof s === 'object') {
                document.getElementById('sentimentBox').innerText = s.label + ' (' + s.score + '/100) • ' + s.bias;
            } else {
                document.getElementById('sentimentBox').innerText = '---';
            }

            const mtf = d.mtf || {};
            const setMtf = (tf, key) => {
                const v = mtf[tf] && mtf[tf][key] != null ? mtf[tf][key] : null;
                return v == null ? '---' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
            };
            document.getElementById('poc15m').innerText = setMtf('15m','poc');
            document.getElementById('up15m').innerText = setMtf('15m','magnetUp');
            document.getElementById('dn15m').innerText = setMtf('15m','magnetDown');
            document.getElementById('poc1h').innerText = setMtf('1h','poc');
            document.getElementById('up1h').innerText = setMtf('1h','magnetUp');
            document.getElementById('dn1h').innerText = setMtf('1h','magnetDown');
            document.getElementById('poc4h').innerText = setMtf('4h','poc');
            document.getElementById('up4h').innerText = setMtf('4h','magnetUp');
            document.getElementById('dn4h').innerText = setMtf('4h','magnetDown');
            document.getElementById('poc1d').innerText = setMtf('1d','poc');
            document.getElementById('up1d').innerText = setMtf('1d','magnetUp');
            document.getElementById('dn1d').innerText = setMtf('1d','magnetDown');
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 10000);
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
