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
  } else {
    event.respondWith(new Response("Bot Volumen-369 activo (vía Cron)."));
  }
});

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
    const resp = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!resp.ok) throw new Error(`Binance API error: ${resp.status}`);
    const data = await resp.json();
    return data
      .filter(t => t.symbol && t.symbol.endsWith("USDT"))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, topN)
      .map(t => t.symbol);
  } catch (e) {
    console.error("Error getTopSymbols:", e.message);
    return [];
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
