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
  } catch (e) {}
  try {
    const data = await fetchBinance(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
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

  const arb = await computeSpotFuturesArb(symbol);
  
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

  const cp = {
    "15m": computeChartPrimeProfile(c15m, 200, 90),
    "1h": computeChartPrimeProfile(c1h, 200, 90),
    "4h": computeChartPrimeProfile(c4h, 200, 90),
    "1d": computeChartPrimeProfile(c1d, 200, 90),
  };

  const sd = {
    "15m": computeSupplyDemandZones(c15m, 200),
    "1h": computeSupplyDemandZones(c1h, 200),
    "4h": computeSupplyDemandZones(c4h, 200),
    "1d": computeSupplyDemandZones(c1d, 200),
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

  const entryFromZones = pickEntryFromZones(sd, entrySide, lastPrice);
  const entry = (entryFromZones && entryFromZones.price != null) ? entryFromZones.price : (entryPick.price ?? lastPrice);
  const entryTf = (entryFromZones && entryFromZones.tf) ? entryFromZones.tf : entryPick.tf;

  const tp2FromZones = pickEntryFromZones(sd, entrySide === "ABAJO" ? "ARRIBA" : "ABAJO", lastPrice);
  const tp2 = (tp2FromZones && tp2FromZones.price != null)
    ? tp2FromZones.price
    : (oppPick.price ?? (entrySide === "ABAJO" ? (lastPrice * 1.02) : (lastPrice * 0.98)));
  const targetTf = (tp2FromZones && tp2FromZones.tf) ? tp2FromZones.tf : oppPick.tf;

  const atr15m = calculateATR(
    c15m.map(c => parseFloat(c[2])),
    c15m.map(c => parseFloat(c[3])),
    c15m.map(c => parseFloat(c[4])),
    14
  );
  const slDist = Math.max(atr15m * 1.25, entry * 0.0035);
  const sl = (entrySide === "ABAJO" ? (entry - slDist) : (entry + slDist));

  const tp1 = cp["15m"].poc ?? profiles["15m"].poc ?? lastPrice;

  const idea = entrySide === "ABAJO"
    ? `ENTRAR EN IMÁN ABAJO (${entryTf}) Y BUSCAR BARRIDA ARRIBA (${targetTf})`
    : `ENTRAR EN IMÁN ARRIBA (${entryTf}) Y BUSCAR BARRIDA ABAJO (${targetTf})`;

  const sentiment = buildSentiment({
    obImbalance,
    futuresFunding: futures.funding,
    oiChange: futures.oiChange,
    dominance4h: profiles["4h"].dominance,
    entrySide,
    entryTf,
  });

  const delta = computeDeltaDivergence(c15m, 20);
  const slip = computeSlippagePredictor(depth, lastPrice, entrySide === "ABAJO" ? "BUY" : "SELL", symbol.includes("USDT") ? 100 : 100);
  const cluster1d = computeVolumeCluster1D(c1d, entry, 120);
  const heatmap = buildLiquidationHeatmap({ mtf, chartPrime: cp, supplyDemand: sd, lastPrice, dp: fmtDp });

  return {
    symbol, price: lastPrice,
    gravitySource, gravityPower: gravityPower + "%",
    orderBookImbalance: (obImbalance * 100).toFixed(1) + "%",
    mtf,
    chartPrime: cp,
    supplyDemand: sd,
    supportResistance: pickSupportResistance(sd, lastPrice),
    arb,
    liqShorts: (profiles["4h"].magnetUp ?? (lastPrice * 1.02)).toFixed(fmtDp),
    liqLongs: (profiles["4h"].magnetDown ?? (lastPrice * 0.98)).toFixed(fmtDp),
    idea,
    funding: (futures.funding * 100).toFixed(4) + "%",
    oi: futures.oi.toLocaleString(),
    oiChange: futures.oiChange.toFixed(2) + "%",
    sentiment,
    delta,
    slippage: slip,
    cluster1d,
    heatmap,
    plan: { 
      entry: entry.toFixed(fmtDp),
      sl: sl.toFixed(fmtDp),
      tp1: tp1.toFixed(fmtDp),
      tp2: tp2.toFixed(fmtDp),
      entryTf,
      targetTf
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

async function computeSpotFuturesArb(symbol) {
  const out = { spotMid: null, futuresMid: null, basisPct: null, ok: false };
  let spot = null;
  let fut = null;
  try {
    spot = await fetchBinance(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`);
  } catch (e) {}
  try {
    fut = await fetchBinance(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`);
  } catch (e) {}

  const sb = spot && spot.bidPrice != null ? parseFloat(spot.bidPrice) : null;
  const sa = spot && spot.askPrice != null ? parseFloat(spot.askPrice) : null;
  const fb = fut && fut.bidPrice != null ? parseFloat(fut.bidPrice) : null;
  const fa = fut && fut.askPrice != null ? parseFloat(fut.askPrice) : null;

  const sMid = (sb != null && sa != null) ? (sb + sa) / 2 : null;
  const fMid = (fb != null && fa != null) ? (fb + fa) / 2 : null;

  out.spotMid = sMid;
  out.futuresMid = fMid;
  if (sMid != null && fMid != null && sMid !== 0) {
    out.basisPct = ((fMid - sMid) / sMid) * 100;
    out.ok = true;
  }
  return out;
}

function pickSupportResistance(sd, price) {
  const order = ["15m", "1h", "4h", "1d"];
  const res = { support: null, resistance: null };
  for (const tf of order) {
    const z = sd[tf];
    if (!z) continue;
    const demands = z.demand || [];
    const supplies = z.supply || [];

    let bestSup = null;
    let bestSupDist = Infinity;
    for (const s of supplies) {
      const lvl = s.bottom;
      if (lvl == null) continue;
      const dist = lvl - price;
      if (dist >= 0 && dist < bestSupDist) {
        bestSupDist = dist;
        bestSup = { tf, price: lvl };
      }
    }

    let bestDem = null;
    let bestDemDist = Infinity;
    for (const d of demands) {
      const lvl = d.top;
      if (lvl == null) continue;
      const dist = price - lvl;
      if (dist >= 0 && dist < bestDemDist) {
        bestDemDist = dist;
        bestDem = { tf, price: lvl };
      }
    }

    if (bestDem && res.support == null) res.support = bestDem;
    if (bestSup && res.resistance == null) res.resistance = bestSup;
  }
  return res;
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

function computeChartPrimeProfile(candles, lookbackBars, binResolution) {
  const lb = Math.min(lookbackBars, candles.length);
  if (lb < 30) {
    const last = candles.length ? parseFloat(candles[candles.length - 1][4]) : null;
    return { poc: last, buyPoc: last, sellPoc: last, buyTotal: 0, sellTotal: 0 };
  }

  const closes = [];
  for (let i = candles.length - lb; i < candles.length; i++) {
    closes.push(parseFloat(candles[i][4]));
  }
  const dev = stdev(closes, Math.min(25, closes.length)) * 2;

  const refs = [];
  const vols = [];
  for (let i = candles.length - lb; i < candles.length; i++) {
    const o = parseFloat(candles[i][1]);
    const h = parseFloat(candles[i][2]);
    const l = parseFloat(candles[i][3]);
    const c = parseFloat(candles[i][4]);
    const v = parseFloat(candles[i][5]);
    const ref = c > o ? (l - dev) : (h + dev);
    if (Number.isFinite(ref) && Number.isFinite(v)) {
      refs.push(ref);
      vols.push(v);
    }
  }
  if (!refs.length) {
    const last = parseFloat(candles[candles.length - 1][4]);
    return { poc: last, buyPoc: last, sellPoc: last, buyTotal: 0, sellTotal: 0 };
  }
  let min = refs[0], max = refs[0];
  for (const r of refs) {
    if (r < min) min = r;
    if (r > max) max = r;
  }
  const range = max - min;
  if (range <= 0) {
    const last = parseFloat(candles[candles.length - 1][4]);
    return { poc: last, buyPoc: last, sellPoc: last, buyTotal: 0, sellTotal: 0 };
  }

  const bins = Math.max(20, binResolution);
  const step = range / bins;
  const volumeBins = Array(bins).fill(0);
  const lastClose = parseFloat(candles[candles.length - 1][4]);

  for (let bar = 0; bar < refs.length; bar++) {
    const ref = refs[bar];
    const v = vols[bar];
    const idx = Math.max(0, Math.min(bins - 1, Math.floor((ref - min) / step)));
    const binMid = min + step * (idx + 0.5);
    if (Math.abs(ref - binMid) <= step && !(Math.abs(lastClose - binMid) < step * 2)) {
      volumeBins[idx] += v;
    }
  }

  let maxVol = 0;
  for (const v of volumeBins) {
    if (v > maxVol) maxVol = v;
  }
  if (maxVol <= 0) {
    return { poc: lastClose, buyPoc: lastClose, sellPoc: lastClose, buyTotal: 0, sellTotal: 0 };
  }

  let buyTotal = 0;
  let sellTotal = 0;
  let buyMax = -1;
  let sellMax = -1;
  let buyPoc = null;
  let sellPoc = null;
  let poc = null;
  let pocMax = -1;

  for (let i = 0; i < volumeBins.length; i++) {
    const binMid = min + step * (i + 0.5);
    const v = volumeBins[i];
    if (v > pocMax) {
      pocMax = v;
      poc = binMid;
    }
    if (Math.abs(lastClose - binMid) < step * 2) continue;
    if (lastClose < binMid) {
      sellTotal += v;
      if (v > sellMax) {
        sellMax = v;
        sellPoc = binMid;
      }
    } else {
      buyTotal += v;
      if (v > buyMax) {
        buyMax = v;
        buyPoc = binMid;
      }
    }
  }

  return {
    poc,
    buyPoc,
    sellPoc,
    buyTotal,
    sellTotal,
  };
}

function computeSupplyDemandZones(candles, atrPeriod) {
  const len = candles.length;
  if (len < 30) return { supply: [], demand: [] };

  const high = candles.map(c => parseFloat(c[2]));
  const low = candles.map(c => parseFloat(c[3]));
  const close = candles.map(c => parseFloat(c[4]));
  const open = candles.map(c => parseFloat(c[1]));
  const volume = candles.map(c => parseFloat(c[5]));

  const atr = calculateATR(high, low, close, Math.min(atrPeriod, len - 1)) * 2;
  const volLookback = Math.min(200, len);
  const avgVol = volume.slice(-volLookback).reduce((a, b) => a + b, 0) / volLookback;

  const supply = [];
  const demand = [];

  for (let j = len - 1; j >= 2; j--) {
    const bear = close[j] < open[j];
    const bull = close[j] > open[j];
    const bear1 = close[j - 1] < open[j - 1];
    const bear2 = close[j - 2] < open[j - 2];
    const bull1 = close[j - 1] > open[j - 1];
    const bull2 = close[j - 2] > open[j - 2];
    const extraVolPrev = volume[j - 1] > avgVol;

    if (bear && bear1 && bear2 && extraVolPrev) {
      let delta = 0;
      for (let k = 0; k <= 5 && (j - k) >= 0; k++) {
        const idx = j - k;
        const isBull = close[idx] > open[idx];
        if (isBull) {
          const bottom = low[idx];
          const top = low[idx] + atr;
          supply.push({ top, bottom, delta });
          break;
        }
        const isBear = close[idx] < open[idx];
        delta += isBear ? -volume[idx] : volume[idx];
      }
    }

    if (bull && bull1 && bull2 && extraVolPrev) {
      let delta = 0;
      for (let k = 0; k <= 5 && (j - k) >= 0; k++) {
        const idx = j - k;
        const isBear = close[idx] < open[idx];
        if (isBear) {
          const top = high[idx];
          const bottom = high[idx] - atr;
          demand.push({ top, bottom, delta });
          break;
        }
        const isBull = close[idx] > open[idx];
        delta += isBull ? volume[idx] : -volume[idx];
      }
    }

    if (supply.length >= 8 && demand.length >= 8) break;
  }

  const last = close[len - 1];
  const cleanSupply = dedupeZones(supply.filter(z => !(last > z.top))).slice(0, 5);
  const cleanDemand = dedupeZones(demand.filter(z => !(last < z.bottom))).slice(0, 5);

  return { supply: cleanSupply, demand: cleanDemand };
}

function dedupeZones(zones) {
  const out = [];
  for (const z of zones) {
    let overlapped = false;
    for (const o of out) {
      const overlap = z.bottom < o.top && z.top > o.bottom;
      if (overlap) {
        overlapped = true;
        if (Math.abs(z.delta) > Math.abs(o.delta)) {
          o.top = z.top;
          o.bottom = z.bottom;
          o.delta = z.delta;
        }
      }
    }
    if (!overlapped) out.push({ ...z });
  }
  return out;
}

function pickEntryFromZones(sd, side, currentPrice) {
  const order = ["1d", "4h", "1h", "15m"];
  let best = null;
  for (const tf of order) {
    const z = sd[tf];
    if (!z) continue;
    const list = side === "ABAJO" ? z.demand : z.supply;
    if (!list || !list.length) continue;

    let candidate = null;
    let bestDist = Infinity;
    for (const zone of list) {
      const price = side === "ABAJO" ? zone.top : zone.bottom;
      const dist = Math.abs(currentPrice - price);
      if (dist < bestDist) {
        bestDist = dist;
        candidate = { tf, price };
      }
    }
    if (candidate) {
      best = candidate;
      break;
    }
  }
  return best;
}

function stdev(arr, period) {
  const p = Math.max(2, Math.min(period, arr.length));
  const slice = arr.slice(-p);
  const mean = slice.reduce((a, b) => a + b, 0) / p;
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / p;
  return Math.sqrt(variance);
}

function computeDeltaDivergence(candles, window) {
  const len = candles.length;
  const w = Math.max(5, Math.min(window, len - 1));
  if (len < w + 1) {
    return { status: "NEUTRAL", delta: 0, deltaChange: 0, priceChangePct: 0 };
  }

  let deltaSum = 0;
  let deltaPrevSum = 0;
  const start = len - w;
  const prevStart = len - 2 * w;
  const prevOk = prevStart >= 0;

  for (let i = start; i < len; i++) {
    const o = parseFloat(candles[i][1]);
    const c = parseFloat(candles[i][4]);
    const v = parseFloat(candles[i][5]);
    deltaSum += (c >= o ? 1 : -1) * v;
  }

  if (prevOk) {
    for (let i = prevStart; i < start; i++) {
      const o = parseFloat(candles[i][1]);
      const c = parseFloat(candles[i][4]);
      const v = parseFloat(candles[i][5]);
      deltaPrevSum += (c >= o ? 1 : -1) * v;
    }
  }

  const deltaChange = prevOk ? (deltaSum - deltaPrevSum) : deltaSum;

  const pNow = parseFloat(candles[len - 1][4]);
  const pPast = parseFloat(candles[start][4]);
  const priceChangePct = pPast !== 0 ? ((pNow - pPast) / pPast) * 100 : 0;

  let status = "NEUTRAL";
  if (priceChangePct < -0.15 && deltaChange > 0) status = "BULLISH_ABSORPTION";
  if (priceChangePct > 0.15 && deltaChange < 0) status = "BEARISH_ABSORPTION";

  return {
    status,
    delta: deltaSum,
    deltaChange,
    priceChangePct
  };
}

function computeSlippagePredictor(depth, midPrice, side, notional) {
  const bid0 = depth.bids && depth.bids.length ? parseFloat(depth.bids[0][0]) : null;
  const ask0 = depth.asks && depth.asks.length ? parseFloat(depth.asks[0][0]) : null;
  const mid = (bid0 != null && ask0 != null) ? (bid0 + ask0) / 2 : midPrice;
  const spreadPct = (bid0 != null && ask0 != null && mid) ? ((ask0 - bid0) / mid) * 100 : 0;

  const qtyTarget = mid ? (notional / mid) : 0;
  let qtyFilled = 0;
  let cost = 0;
  let avg = mid;

  const book = side === "BUY" ? (depth.asks || []) : (depth.bids || []);
  for (let i = 0; i < book.length && qtyFilled < qtyTarget; i++) {
    const px = parseFloat(book[i][0]);
    const q = parseFloat(book[i][1]);
    const take = Math.min(q, qtyTarget - qtyFilled);
    qtyFilled += take;
    cost += take * px;
  }
  if (qtyFilled > 0) avg = cost / qtyFilled;

  const slippagePct = mid ? (side === "BUY" ? ((avg - mid) / mid) * 100 : ((mid - avg) / mid) * 100) : 0;
  const maxAllowedPct = 0.05;
  const abort = slippagePct > maxAllowedPct || spreadPct > 0.08;

  return {
    side,
    notional,
    spreadPct,
    slippagePct,
    maxAllowedPct,
    abort
  };
}

function computeVolumeCluster1D(candles, price, bins) {
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
  if (!tps.length) {
    return { level: "N/D", strength: 0, clusterPrice: null, distancePct: null };
  }
  let min = tps[0], max = tps[0];
  for (const tp of tps) {
    if (tp < min) min = tp;
    if (tp > max) max = tp;
  }
  const range = max - min;
  if (range <= 0) {
    return { level: "N/D", strength: 0, clusterPrice: null, distancePct: null };
  }
  const binCount = Math.max(40, bins || 120);
  const step = range / binCount;
  const vb = Array(binCount).fill(0);
  for (let i = 0; i < tps.length; i++) {
    const idx = Math.max(0, Math.min(binCount - 1, Math.floor((tps[i] - min) / step)));
    vb[idx] += vols[i];
  }
  let maxVol = 0;
  for (const v of vb) if (v > maxVol) maxVol = v;
  if (maxVol <= 0) {
    return { level: "N/D", strength: 0, clusterPrice: null, distancePct: null };
  }

  const idxPrice = Math.max(0, Math.min(binCount - 1, Math.floor((price - min) / step)));
  const localVol = vb[idxPrice];
  const strength = localVol / maxVol;
  const clusterPrice = min + step * (idxPrice + 0.5);
  const distancePct = clusterPrice ? Math.abs(price - clusterPrice) / clusterPrice * 100 : null;

  let level = "BAJO";
  if (strength >= 0.75) level = "ALTO";
  else if (strength >= 0.45) level = "MEDIO";

  return { level, strength, clusterPrice, distancePct };
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

function buildLiquidationHeatmap({ mtf, chartPrime, supplyDemand, lastPrice, dp }) {
  const tfWeight = { "15m": 0.35, "1h": 0.55, "4h": 0.8, "1d": 1.0 };
  const points = [];
  const zones = [];

  const addPoint = (tf, kind, side, price, strength) => {
    if (price == null || !Number.isFinite(price)) return;
    points.push({
      tf,
      kind,
      side,
      price,
      strength: clamp01(strength),
    });
  };

  const addZone = (tf, kind, side, top, bottom, strength) => {
    if (top == null || bottom == null) return;
    const t = Number(top);
    const b = Number(bottom);
    if (!Number.isFinite(t) || !Number.isFinite(b)) return;
    const zTop = Math.max(t, b);
    const zBottom = Math.min(t, b);
    zones.push({
      tf,
      kind,
      side,
      top: zTop,
      bottom: zBottom,
      mid: (zTop + zBottom) / 2,
      strength: clamp01(strength),
    });
  };

  for (const tf of ["15m", "1h", "4h", "1d"]) {
    const w = tfWeight[tf] || 0.5;
    const cp = chartPrime && chartPrime[tf] ? chartPrime[tf] : null;
    if (cp) {
      addPoint(tf, "BPOC", "DEMAND", cp.buyPoc, 0.65 * w);
      addPoint(tf, "POC", "NEUTRAL", cp.poc, 0.5 * w);
      addPoint(tf, "SPOC", "SUPPLY", cp.sellPoc, 0.65 * w);
    }

    const sd = supplyDemand && supplyDemand[tf] ? supplyDemand[tf] : null;
    if (sd) {
      const demand = Array.isArray(sd.demand) ? sd.demand.slice(0, 2) : [];
      const supply = Array.isArray(sd.supply) ? sd.supply.slice(0, 2) : [];
      for (const d of demand) addZone(tf, "DEMAND_ZONE", "DEMAND", d.top, d.bottom, 0.55 * w);
      for (const s of supply) addZone(tf, "SUPPLY_ZONE", "SUPPLY", s.top, s.bottom, 0.55 * w);
    }

    const p = mtf && mtf[tf] ? mtf[tf] : null;
    if (p) {
      addPoint(tf, "MAGNET_UP", "SUPPLY", p.magnetUp, 0.35 * w);
      addPoint(tf, "MAGNET_DOWN", "DEMAND", p.magnetDown, 0.35 * w);
    }
  }

  const allPrices = [lastPrice]
    .concat(points.map(p => p.price))
    .concat(zones.map(z => z.top))
    .concat(zones.map(z => z.bottom))
    .filter(v => v != null && Number.isFinite(v));

  if (!allPrices.length) {
    return { min: null, max: null, last: lastPrice, points: [], zones: [] };
  }

  let min = allPrices[0];
  let max = allPrices[0];
  for (const v of allPrices) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const pad = (max - min) * 0.06 || (lastPrice * 0.01);
  min -= pad;
  max += pad;

  return { min, max, last: lastPrice, dp: typeof dp === "number" ? dp : 6, points, zones };
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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
        
        .search-box { background: #2b3139; border: 4px solid var(--yellow); color: #fff; padding: 18px 30px; border-radius: 60px; width: min(450px, 100%); font-size: 1.1rem; outline: none; box-shadow: 0 0 20px rgba(240, 185, 11, 0.2); }
        .search-box::placeholder { color: rgba(255,255,255,0.65); }
        
        .liq-zone { padding: 25px; border-radius: 20px; margin-top: 20px; border: 4px solid; position: relative; overflow: hidden; }
        .liq-shorts { background: rgba(14, 203, 129, 0.15); border-color: var(--green); }
        .liq-longs { background: rgba(246, 70, 93, 0.15); border-color: var(--red); }
        
        .chart-container { height: min(600px, 60vh); border-radius: 20px; overflow: hidden; border: 3px solid #474d57; }
        #idea-pill { background: var(--yellow); color: #000; padding: 12px 25px; border-radius: 12px; font-size: 1.3rem; font-weight: 900; box-shadow: 0 5px 15px rgba(240, 185, 11, 0.4); }
        
        .gravity-bar { height: 12px; background: #2b3139; border-radius: 10px; margin-top: 10px; overflow: hidden; border: 1px solid #474d57; }
        .gravity-fill { height: 100%; background: var(--yellow); transition: 0.5s; box-shadow: 0 0 10px var(--yellow); }
        .mtf-table { width: 100%; margin-top: 10px; font-size: 0.95rem; }
        .mtf-table td { padding: 10px 8px; border-bottom: 1px solid rgba(71, 77, 87, 0.6); color: #ffffff; }
        .mtf-tag { font-weight: 900; color: #fff; }
        .mono { font-variant-numeric: tabular-nums; letter-spacing: 0.3px; color: #ffffff; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        #funding, #oi, #oiChange, #obImb { color: #ffffff; font-weight: 900; font-size: 1.25rem; }
        #sentimentBox { color: #ffffff; font-weight: 900; font-size: 1.25rem; }
        .mtf-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .heatmap { height: clamp(220px, 30vh, 320px); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; background: radial-gradient(1200px 400px at 50% 0%, rgba(246,70,93,0.10) 0%, rgba(0,0,0,0) 55%), radial-gradient(1200px 400px at 50% 100%, rgba(14,203,129,0.12) 0%, rgba(0,0,0,0) 55%), linear-gradient(180deg, rgba(246,70,93,0.06) 0%, rgba(240,185,11,0.04) 50%, rgba(14,203,129,0.06) 100%); position: relative; overflow: hidden; }
        .heat-frame { position:absolute; inset: 10px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.20); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15); pointer-events:none; }
        .heat-band { position: absolute; left: 12px; right: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); }
        .heat-line { position: absolute; left: 12px; right: 12px; height: 3px; border-radius: 10px; }
        .heat-last { position: absolute; left: 10px; right: 10px; height: 2px; background: rgba(255,255,255,0.95); box-shadow: 0 0 14px rgba(255,255,255,0.25); }
        .heat-label { position: absolute; right: 16px; transform: translateY(-50%); font-size: clamp(0.70rem, 1.1vw, 0.85rem); font-weight: 900; color: rgba(255,255,255,0.98); text-shadow: 0 2px 12px rgba(0,0,0,0.85); pointer-events: none; padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.10); max-width: calc(100% - 32px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .heat-label.left { right: auto; left: 16px; }
        .heat-legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; font-size: 0.82rem; color: #d5d9e0; font-weight: 800; }
        .pill { display:flex; align-items:center; justify-content:center; padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.18); }
        .heat-list { margin-top: 12px; display: grid; grid-template-columns: 1fr; gap: 10px; }
        .heat-item { display:flex; align-items:center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.10); background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.22)); color: #fff; font-weight: 900; font-size: 1rem; }
        .heat-left { display:flex; align-items:center; gap: 10px; min-width: 0; }
        .tag { display:inline-flex; align-items:center; gap:6px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.10); background: rgba(0,0,0,0.25); font-size: 0.80rem; color: #fff; }
        .tag.tf { background: rgba(240,185,11,0.16); border-color: rgba(240,185,11,0.20); }
        .tag.kind { background: rgba(255,255,255,0.06); }
        .tag.side-demand { background: rgba(14,203,129,0.14); border-color: rgba(14,203,129,0.22); }
        .tag.side-supply { background: rgba(246,70,93,0.14); border-color: rgba(246,70,93,0.22); }
        .heat-price { font-weight: 950; font-size: 1.05rem; }
        .heat-sub { color: #d5d9e0; font-weight: 800; font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        @media (min-width: 1200px) {
          .heatmap { height: 360px; }
          .heat-list { grid-template-columns: 1fr 1fr; }
          .heat-price { font-size: 1.12rem; }
        }

        @media (max-width: 992px) {
          .card { padding: 18px; border-radius: 16px; }
          .metric-value { font-size: 2.2rem; }
          .plan-val { font-size: 1.7rem; }
          #idea-pill { font-size: 1.05rem; padding: 10px 16px; }
          .chart-container { height: 52vh; }
        }

        @media (max-width: 576px) {
          .metric-label { font-size: 0.85rem; }
          .metric-value { font-size: 1.9rem; }
          .plan-val { font-size: 1.45rem; }
          .chart-container { height: 46vh; }
          .search-box { font-size: 1rem; padding: 14px 18px; border-width: 3px; }
          .mtf-table { font-size: 0.85rem; }
        }
    </style>
</head>
<body>
    <div class="container-fluid p-4">
        <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
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
                            <hr>
                            <div class="row">
                                <div class="col-12">
                                    <div class="metric-label">SPOT-FUTURES ARB (BASIS)</div>
                                    <div id="arbBasis" class="h5" style="color:#fff;">---</div>
                                    <div id="arbDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-6">
                                    <div class="metric-label">SOPORTE</div>
                                    <div id="srSupport" class="h5" style="color:#fff;">---</div>
                                </div>
                                <div class="col-6">
                                    <div class="metric-label">RESISTENCIA</div>
                                    <div id="srResistance" class="h5" style="color:#fff;">---</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">FILTROS V6 (PRECISIÓN)</h5>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <div class="metric-label">Delta Divergence</div>
                                    <div id="deltaStatus" class="h5" style="color:#fff;"></div>
                                    <div id="deltaDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-12">
                                    <div class="metric-label">Slippage Predictor</div>
                                    <div id="slipStatus" class="h5" style="color:#fff;"></div>
                                    <div id="slipDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-12">
                                    <div class="metric-label">Volume Cluster 1D</div>
                                    <div id="clusterLevel" class="h5" style="color:#fff;"></div>
                                    <div id="clusterDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">HEATMAP DE LIQUIDACIÓN (V8)</h5>
                            <div id="heatmap" class="heatmap"></div>
                            <div class="heat-legend">
                                <span class="pill">Arriba = Supply</span>
                                <span class="pill">Centro = POC</span>
                                <span class="pill">Abajo = Demand</span>
                            </div>
                            <div id="heatmapList" class="heat-list"></div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">HFT / V-SHAPE (TIEMPO REAL)</h5>
                            <div class="row mt-3">
                                <div class="col-6">
                                    <div class="metric-label">TPS</div>
                                    <div id="hftTps" class="h4" style="color:#fff;">---</div>
                                </div>
                                <div class="col-6">
                                    <div class="metric-label">MS/TRADE</div>
                                    <div id="hftMs" class="h4" style="color:#fff;">---</div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-6">
                                    <div class="metric-label">RATIO BUY/SELL</div>
                                    <div id="hftRatio" class="h4" style="color:#fff;">---</div>
                                </div>
                                <div class="col-6">
                                    <div class="metric-label">V-SHAPE</div>
                                    <div id="vshape" class="h4" style="color:#fff;">---</div>
                                </div>
                            </div>
                            <hr>
                            <div class="row">
                                <div class="col-12">
                                    <div class="metric-label">DECISIÓN</div>
                                    <div id="decision" class="h4" style="color:#fff;">---</div>
                                    <div id="decisionDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <div class="metric-label">ESTADO HFT</div>
                                    <div id="hftStatus" class="h5" style="color:#fff;">---</div>
                                    <div id="hftStatusDetails" style="color:#d5d9e0; font-size:0.95rem;"></div>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-12">
                                    <div class="metric-label">AUTO BREAKEVEN</div>
                                    <div id="breakeven" class="h5" style="color:#fff;">---</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-12">
                        <div class="card">
                            <h5 class="metric-label text-center">NIVELES DE ENTRADA ALGORÍTMICA (IMANES)</h5>
                            <div class="mtf-wrap">
                              <table class="mtf-table">
                                  <tbody>
                                      <tr><td class="mtf-tag">15M</td><td>BPOC</td><td id="buy15m" class="mono"></td><td>POC</td><td id="poc15m" class="mono"></td><td>SPOC</td><td id="sell15m" class="mono"></td></tr>
                                      <tr><td class="mtf-tag">1H</td><td>BPOC</td><td id="buy1h" class="mono"></td><td>POC</td><td id="poc1h" class="mono"></td><td>SPOC</td><td id="sell1h" class="mono"></td></tr>
                                      <tr><td class="mtf-tag">4H</td><td>BPOC</td><td id="buy4h" class="mono"></td><td>POC</td><td id="poc4h" class="mono"></td><td>SPOC</td><td id="sell4h" class="mono"></td></tr>
                                      <tr><td class="mtf-tag">1D</td><td>BPOC</td><td id="buy1d" class="mono"></td><td>POC</td><td id="poc1d" class="mono"></td><td>SPOC</td><td id="sell1d" class="mono"></td></tr>
                                  </tbody>
                              </table>
                            </div>
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

        let hftWs = null;
        let hftMode = "FUTURES";
        let hftTrades = [];
        let hftPriceSeries = [];
        let hftLastTs = null;
        let hftIntervals = [];
        let lastAnalysis = null;

        function resetHft() {
            hftTrades = [];
            hftPriceSeries = [];
            hftLastTs = null;
            hftIntervals = [];
            setText('hftTps', '---');
            setText('hftMs', '---');
            setText('hftRatio', '---');
            setText('vshape', '---');
            setText('hftStatus', 'INACTIVO');
            setText('hftStatusDetails', 'Esperando precio cerca del imán para activar WebSocket');
            setText('breakeven', '---');
        }

        function setText(id, v) {
            const el = document.getElementById(id);
            if (el) el.innerText = v;
        }

        function closeHft() {
            try { if (hftWs) hftWs.close(); } catch (e) {}
            hftWs = null;
        }

        function startHft(symbol, prefer) {
            closeHft();
            resetHft();
            const s = symbol.toLowerCase();
            hftMode = prefer || "FUTURES";
            const url = hftMode === "FUTURES"
                ? ("wss://fstream.binance.com/ws/" + s + "@aggTrade")
                : ("wss://stream.binance.com:9443/ws/" + s + "@trade");

            try {
                hftWs = new WebSocket(url);
            } catch (e) {
                hftWs = null;
                return;
            }

            setText('hftStatus', 'CONECTANDO (' + hftMode + ')');
            setText('hftStatusDetails', 'Activado porque el precio está cerca del imán');

            hftWs.onopen = function() {
                setText('hftStatus', 'CONECTADO (' + hftMode + ')');
                setText('hftStatusDetails', 'Midiendo TPS, ratio Buy/Sell y V-Shape en tiempo real');
            };

            hftWs.onmessage = function(ev) {
                try {
                    const msg = JSON.parse(ev.data);
                    const ts = msg.T || msg.E || Date.now();
                    const price = parseFloat(msg.p || msg.P || msg.a || msg.c);
                    const qty = parseFloat(msg.q || msg.Q || msg.v);
                    const m = !!msg.m;
                    const buyAgg = !m;
                    if (!Number.isFinite(price) || !Number.isFinite(qty)) return;

                    if (hftLastTs != null) {
                        const dt = ts - hftLastTs;
                        if (dt > 0 && dt < 20000) {
                            hftIntervals.push(dt);
                            if (hftIntervals.length > 300) hftIntervals.shift();
                        }
                    }
                    hftLastTs = ts;

                    hftTrades.push({ ts: ts, price: price, qty: qty, buy: buyAgg });
                    if (hftTrades.length > 5000) hftTrades.shift();

                    hftPriceSeries.push({ ts: ts, price: price });
                    while (hftPriceSeries.length && (ts - hftPriceSeries[0].ts) > 70000) hftPriceSeries.shift();

                    updateHftMetrics();
                } catch (e) {}
            };

            hftWs.onclose = function() {
                if (hftMode === "FUTURES") {
                    startHft(symbol, "SPOT");
                    return;
                }
                setText('hftStatus', 'DESCONECTADO');
                setText('hftStatusDetails', 'No se pudo mantener WebSocket. Puede ser bloqueo de red.');
            };

            hftWs.onerror = function() {
                try { if (hftWs) hftWs.close(); } catch (e) {}
            };
        }

        function updateHftMetrics() {
            const now = Date.now();
            const t1s = now - 1000;
            const t5s = now - 5000;
            const t60s = now - 60000;

            let c1 = 0;
            let buyV = 0;
            let sellV = 0;
            for (let i = hftTrades.length - 1; i >= 0; i--) {
                const tr = hftTrades[i];
                if (tr.ts < t60s) break;
                if (tr.ts >= t1s) c1++;
                if (tr.ts >= t5s) {
                    const notional = tr.price * tr.qty;
                    if (tr.buy) buyV += notional; else sellV += notional;
                }
            }

            const tps = c1;
            const ratio = sellV > 0 ? (buyV / sellV) : (buyV > 0 ? 999 : 1);
            const ms = hftIntervals.length
                ? (hftIntervals.reduce((a, b) => a + b, 0) / hftIntervals.length)
                : null;

            setText('hftTps', String(tps));
            setText('hftMs', ms != null ? ms.toFixed(0) : '---');
            setText('hftRatio', ratio >= 999 ? '∞' : ratio.toFixed(2));

            const v = detectVShape(tps, ratio);
            setText('vshape', v);

            if (lastAnalysis) {
                updateDecision(lastAnalysis, { tps: tps, ratio: ratio, vshape: v, ms: ms, buyV: buyV, sellV: sellV });
            }
        }

        function detectVShape(tps, ratio) {
            if (hftPriceSeries.length < 5) return '---';
            const now = Date.now();
            const recent = hftPriceSeries.filter(p => p.ts >= (now - 60000));
            if (recent.length < 5) return '---';
            let min = recent[0].price;
            let minTs = recent[0].ts;
            for (let i = 1; i < recent.length; i++) {
                if (recent[i].price < min) {
                    min = recent[i].price;
                    minTs = recent[i].ts;
                }
            }
            const cur = recent[recent.length - 1].price;
            const reboundPct = min > 0 ? ((cur - min) / min) * 100 : 0;
            const ready = reboundPct >= 0.18 && (now - minTs) <= 60000 && tps >= 60 && ratio >= 2.2;
            return ready ? 'READY' : 'NO';
        }

        function updateDecision(d, live) {
            const entry = d && d.plan && d.plan.entry ? parseFloat(d.plan.entry) : null;
            const price = d && d.price ? parseFloat(d.price) : null;
            if (entry == null || price == null) return;

            const distPct = entry ? (Math.abs(price - entry) / entry) * 100 : 999;
            const nearMagnet = distPct <= 0.25;

            const dd = d.delta || {};
            const deltaOk = dd.status === 'BULLISH_ABSORPTION' || dd.status === 'BEARISH_ABSORPTION';

            const sp = d.slippage || {};
            const slipOk = sp.abort === false;

            const cl = d.cluster1d || {};
            const clusterOk = cl.level === 'ALTO' || cl.level === 'MEDIO';

            const arb = d.arb || {};
            const arbOk = arb.ok === true;

            const tpsOk = live && live.tps != null ? live.tps >= 80 : false;
            const ratioOk = live && live.ratio != null ? live.ratio >= 3.0 : false;
            const vReady = live && live.vshape === 'READY';

            const ok = nearMagnet && deltaOk && slipOk && clusterOk && (arbOk || true) && tpsOk && ratioOk && vReady;

            const reasons = [];
            if (!nearMagnet) reasons.push('Lejos del imán (' + distPct.toFixed(2) + '%)');
            if (!deltaOk) reasons.push('Sin absorción (Delta)');
            if (!slipOk) reasons.push('Slippage/Spread alto');
            if (!clusterOk) reasons.push('Cluster 1D débil');
            if (!tpsOk) reasons.push('TPS bajo');
            if (!ratioOk) reasons.push('Ratio bajo');
            if (!vReady) reasons.push('V-Shape no');

            setText('decision', ok ? 'OPERAR' : 'NO OPERAR');
            setText('decisionDetails', ok ? 'Cumple reglas (HFT + Absorción + Imán)' : reasons.join(' | '));

            if (ok) {
                setText('breakeven', 'Mover SL a ENTRADA si +0.35% a favor o en 2 min');
            } else {
                setText('breakeven', '---');
            }
        }

        async function loadData() {
            const d = await (await fetch(\`/api/pro-analysis?symbol=\${currentSymbol}\`)).json();
            lastAnalysis = d;
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

            const cp = d.chartPrime || {};
            const setCp = (tf, key) => {
                const v = cp[tf] && cp[tf][key] != null ? cp[tf][key] : null;
                return v == null ? '---' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 });
            };

            document.getElementById('buy15m').innerText = setCp('15m','buyPoc');
            document.getElementById('poc15m').innerText = setCp('15m','poc');
            document.getElementById('sell15m').innerText = setCp('15m','sellPoc');

            document.getElementById('buy1h').innerText = setCp('1h','buyPoc');
            document.getElementById('poc1h').innerText = setCp('1h','poc');
            document.getElementById('sell1h').innerText = setCp('1h','sellPoc');

            document.getElementById('buy4h').innerText = setCp('4h','buyPoc');
            document.getElementById('poc4h').innerText = setCp('4h','poc');
            document.getElementById('sell4h').innerText = setCp('4h','sellPoc');

            document.getElementById('buy1d').innerText = setCp('1d','buyPoc');
            document.getElementById('poc1d').innerText = setCp('1d','poc');
            document.getElementById('sell1d').innerText = setCp('1d','sellPoc');

            const dd = d.delta || {};
            document.getElementById('deltaStatus').innerText = dd.status || '---';
            document.getElementById('deltaDetails').innerText = 'Δ: ' + (dd.deltaChange != null ? Number(dd.deltaChange).toLocaleString() : '---') + ' | Precio: ' + (dd.priceChangePct != null ? dd.priceChangePct.toFixed(2) : '---') + '%';

            const sp = d.slippage || {};
            document.getElementById('slipStatus').innerText = (sp.abort ? 'ABORTAR ENTRADA' : 'OK') + ' (' + (sp.side || '---') + ')';
            document.getElementById('slipDetails').innerText = 'Spread: ' + (sp.spreadPct != null ? sp.spreadPct.toFixed(3) : '---') + '% | Slippage: ' + (sp.slippagePct != null ? sp.slippagePct.toFixed(3) : '---') + '% | Max: ' + (sp.maxAllowedPct != null ? sp.maxAllowedPct.toFixed(2) : '---') + '%';

            const cl = d.cluster1d || {};
            document.getElementById('clusterLevel').innerText = (cl.level || '---') + ' (Strength: ' + (cl.strength != null ? (cl.strength * 100).toFixed(0) : '---') + '%)';
            document.getElementById('clusterDetails').innerText = 'Centro: ' + (cl.clusterPrice != null ? Number(cl.clusterPrice).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '---') + ' | Dist: ' + (cl.distancePct != null ? cl.distancePct.toFixed(2) : '---') + '%';

            renderHeatmap(d.heatmap);

            const arb = d.arb || {};
            if (arb.ok) {
                document.getElementById('arbBasis').innerText = (arb.basisPct != null ? arb.basisPct.toFixed(3) : '---') + '%';
                document.getElementById('arbDetails').innerText = 'Spot: ' + (arb.spotMid != null ? Number(arb.spotMid).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '---') + ' | Fut: ' + (arb.futuresMid != null ? Number(arb.futuresMid).toLocaleString(undefined, { maximumFractionDigits: 6 }) : '---');
            } else {
                document.getElementById('arbBasis').innerText = '---';
                document.getElementById('arbDetails').innerText = '';
            }

            const sr = d.supportResistance || {};
            document.getElementById('srSupport').innerText = sr.support ? (sr.support.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' (' + sr.support.tf.toUpperCase() + ')') : '---';
            document.getElementById('srResistance').innerText = sr.resistance ? (sr.resistance.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) + ' (' + sr.resistance.tf.toUpperCase() + ')') : '---';

            const entry = d && d.plan && d.plan.entry ? parseFloat(d.plan.entry) : null;
            const price = d && d.price ? parseFloat(d.price) : null;
            if (entry != null && price != null) {
                const distPct = entry ? (Math.abs(price - entry) / entry) * 100 : 999;
                if (distPct <= 0.35) {
                    if (!hftWs) startHft(d.symbol, "FUTURES");
                    setText('hftStatusDetails', 'Cerca del imán (' + distPct.toFixed(2) + '%)');
                } else {
                    if (hftWs) closeHft();
                    resetHft();
                    setText('hftStatus', 'INACTIVO');
                    setText('hftStatusDetails', 'Lejos del imán (' + distPct.toFixed(2) + '%). El modo HFT se activa cerca del nivel.');
                }

                updateDecisionBaseline(d, distPct);
            }
        }

        initChart(currentSymbol); loadData(); setInterval(loadData, 10000);

        function updateDecisionBaseline(d, distPct) {
            const entry = d && d.plan && d.plan.entry ? parseFloat(d.plan.entry) : null;
            const price = d && d.price ? parseFloat(d.price) : null;
            if (entry == null || price == null) return;

            const nearMagnet = distPct <= 0.25;
            const dd = d.delta || {};
            const deltaOk = dd.status === 'BULLISH_ABSORPTION' || dd.status === 'BEARISH_ABSORPTION';
            const sp = d.slippage || {};
            const slipOk = sp.abort === false;
            const cl = d.cluster1d || {};
            const clusterOk = cl.level === 'ALTO' || cl.level === 'MEDIO';

            if (!nearMagnet) {
                setText('decision', 'ESPERAR');
                setText('decisionDetails', 'Esperando llegada al imán (' + distPct.toFixed(2) + '%)');
                return;
            }

            if (!deltaOk || !slipOk || !clusterOk) {
                const reasons = [];
                if (!deltaOk) reasons.push('Sin absorción (Delta)');
                if (!slipOk) reasons.push('Slippage/Spread alto');
                if (!clusterOk) reasons.push('Cluster 1D débil');
                setText('decision', 'NO OPERAR');
                setText('decisionDetails', reasons.join(' | '));
                return;
            }

            setText('decision', 'VALIDADO (V6)');
            setText('decisionDetails', 'Falta confirmación HFT/V-Shape para timing exacto');
        }

        function renderHeatmap(hm) {
            const root = document.getElementById('heatmap');
            const list = document.getElementById('heatmapList');
            if (!root) return;
            if (!hm || hm.min == null || hm.max == null || !isFinite(hm.min) || !isFinite(hm.max) || hm.min === hm.max) {
                root.innerHTML = '';
                if (list) list.innerHTML = '';
                return;
            }
            const min = hm.min, max = hm.max;
            const h = root.clientHeight || 260;
            const w = root.clientWidth || 420;
            const toY = (p) => {
                const t = (p - min) / (max - min);
                const y = (1 - t) * h;
                return Math.max(0, Math.min(h, y));
            };
            const dp = (hm.dp != null && isFinite(hm.dp)) ? hm.dp : 6;
            const fmt = (v) => Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
            const bands = [];
            bands.push('<div class="heat-frame"></div>');

            const zones = Array.isArray(hm.zones) ? hm.zones : [];
            for (const z of zones) {
                const yTop = toY(z.top);
                const yBot = toY(z.bottom);
                const y1 = Math.min(yTop, yBot);
                const y2 = Math.max(yTop, yBot);
                const height = Math.max(8, y2 - y1);
                const base = z.side === 'DEMAND' ? '14,203,129' : (z.side === 'SUPPLY' ? '246,70,93' : '240,185,11');
                const alpha = 0.08 + 0.35 * (z.strength || 0.3);
                bands.push('<div class="heat-band" style="top:' + y1 + 'px;height:' + height + 'px;background:rgba(' + base + ',' + alpha + ');"></div>');
            }

            const points = Array.isArray(hm.points) ? hm.points : [];
            const labelCandidates = [];
            for (const p of points) {
                const y = toY(p.price);
                const base = p.side === 'DEMAND' ? '14,203,129' : (p.side === 'SUPPLY' ? '246,70,93' : '240,185,11');
                const alpha = 0.25 + 0.55 * (p.strength || 0.4);
                bands.push('<div class="heat-line" style="top:' + (y - 1) + 'px;background:rgba(' + base + ',' + alpha + ');"></div>');
                if (p.kind === 'POC' || p.kind === 'BPOC' || p.kind === 'SPOC') labelCandidates.push({ y, tf: p.tf, kind: p.kind, price: p.price });
            }

            const yLast = toY(hm.last);
            bands.push('<div class="heat-last" style="top:' + yLast + 'px;"></div>');
            bands.push('<div class="heat-label left" style="top:' + yLast + 'px;">LAST • ' + fmt(hm.last) + '</div>');

            const showInlineLabels = w >= 420;
            if (showInlineLabels) {
                const important = labelCandidates.filter(x => x.tf === '4h' || x.tf === '1d');
                important.sort((a, b) => a.y - b.y);
                let lastPlaced = -9999;
                const minGap = 18;
                for (const it of important) {
                    if (Math.abs(it.y - lastPlaced) < minGap) continue;
                    bands.push('<div class="heat-label" style="top:' + it.y + 'px;">' + it.tf.toUpperCase() + ' ' + it.kind + ' • ' + fmt(it.price) + '</div>');
                    lastPlaced = it.y;
                }
            }

            root.innerHTML = bands.join('');

            if (list) {
                const tfRank = { "1d": 0, "4h": 1, "1h": 2, "15m": 3 };
                const kindRank = { "BPOC": 0, "POC": 1, "SPOC": 2 };
                const maxItems = w >= 900 ? 12 : 6;

                const ordered = points
                    .filter(p => p.kind === 'BPOC' || p.kind === 'POC' || p.kind === 'SPOC')
                    .sort((a, b) => {
                        const ta = tfRank[a.tf] != null ? tfRank[a.tf] : 9;
                        const tb = tfRank[b.tf] != null ? tfRank[b.tf] : 9;
                        if (ta !== tb) return ta - tb;
                        const ka = kindRank[a.kind] != null ? kindRank[a.kind] : 9;
                        const kb = kindRank[b.kind] != null ? kindRank[b.kind] : 9;
                        if (ka !== kb) return ka - kb;
                        return (b.strength || 0) - (a.strength || 0);
                    })
                    .slice(0, maxItems);

                list.innerHTML = ordered.map(p => {
                    const sideClass = p.side === 'DEMAND' ? 'side-demand' : (p.side === 'SUPPLY' ? 'side-supply' : '');
                    const sideText = p.side === 'DEMAND' ? 'DEMANDA' : (p.side === 'SUPPLY' ? 'OFERTA' : 'NEUTRAL');
                    return '<div class="heat-item">'
                      + '<div class="heat-left">'
                      + '<span class="tag tf">' + p.tf.toUpperCase() + '</span>'
                      + '<span class="tag kind">' + p.kind + '</span>'
                      + '<span class="tag ' + sideClass + '">' + sideText + '</span>'
                      + '</div>'
                      + '<div style="text-align:right;min-width:120px;">'
                      + '<div class="heat-price mono">' + fmt(p.price) + '</div>'
                      + '<div class="heat-sub">Fuerza: ' + Math.round((p.strength || 0) * 100) + '%</div>'
                      + '</div>'
                      + '</div>';
                }).join('');
            }
        }
    </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=UTF-8" } });
}

addEventListener("fetch", event => event.respondWith(handleRequest(event.request)));
