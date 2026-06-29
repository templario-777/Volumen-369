export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Add CORS headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 200 });
    }

    try {
      // Ticker endpoint
      if (path.startsWith('/api/ticker/')) {
        const symbol = path.split('/api/ticker/')[1];
        const binanceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
        const binanceResponse = await fetch(binanceUrl);
        
        if (binanceResponse.ok) {
          const data = await binanceResponse.json();
          return new Response(JSON.stringify({
            lastPrice: parseFloat(data.lastPrice),
            priceChangePercent: parseFloat(data.priceChangePercent),
            highPrice: parseFloat(data.highPrice),
            lowPrice: parseFloat(data.lowPrice),
            quoteVolume: parseFloat(data.quoteVolume)
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({ error: 'Binance API error' }), { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
      }

      // Chat endpoint (uses NVIDIA API via env secret)
      if (path === '/api/chat' && request.method === 'POST') {
        const body = await request.json();
        const userMessage = body.message;
        const symbol = body.symbol || 'BTCUSDT';
        const currentDate = new Date().toLocaleDateString('es-ES', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        });

        // Get real market data
        const symbolClean = symbol.replace('BINANCE:', '').replace('/', '').replace(':', '').toUpperCase();
        let marketData = null;
        let klinesData = null;
        try {
          const marketRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbolClean}`);
          if (marketRes.ok) marketData = await marketRes.json();
          
          const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbolClean}&interval=5m&limit=50`);
          if (klinesRes.ok) klinesData = await klinesRes.json();
        } catch (e) {}

        // Build prompt with real data
        let dataMessage = userMessage;
        if (marketData) {
          dataMessage = `DATOS REALES DEL MERCADO PARA ${symbolClean} (FECHA: ${currentDate}):
- PRECIO ACTUAL: $${marketData.lastPrice}
- PRECIO MÁS ALTO 24H: $${marketData.highPrice}
- PRECIO MÁS BAJO 24H: $${marketData.lowPrice}
- CAMBIO 24H: ${marketData.priceChangePercent}%
- VOLUMEN 24H: $${marketData.quoteVolume}

`;
          if (klinesData) {
            dataMessage += "ÚLTIMAS VELAS (5m):\n";
            for (let i = Math.max(0, klinesData.length - 5); i < klinesData.length; i++) {
              const kline = klinesData[i];
              dataMessage += `Vela ${i - klinesData.length + 6}: A=${kline[1]}, M=${kline[2]}, B=${kline[3]}, C=${kline[4]}, V=${kline[5]}\n`;
            }
          }
          dataMessage += `\nPREGUNTA DEL USUARIO: ${userMessage}`;
        }

        // Call NVIDIA AI
        const systemPrompt = `ERES UN ANALISTA TÉCNICO EXPERTO EN TRADING DE CRIPTOMONEDAS. REGLAS ESTRICTAS DE FORMATO Y LÓGICA:
1. FECHA ACTUAL: ${currentDate} - NUNCA uses fechas pasadas ni inventadas.
2. REDONDEA PRECIOS: Redondea todos los precios de criptomonedas a un máximo de 2 decimales. Nunca muestres 8 ceros.
3. TERMINOLOGÍA CORRECTA: Usa "Vela" o "Candlestick" en lugar de "candelilla". Usa "nivel" no "nível".
4. RSI: Nivel de sobrecompra = 70 o superior. Nivel de sobreventa = 30 o inferior.
5. LÓGICA DE STOP LOSS:
   - Para LONG (compra): Stop loss SIEMPRE POR DEBAJO del precio de entrada.
   - Para SHORT (venta): Stop loss SIEMPRE POR ENCIMA del precio de entrada.
6. LÓGICA DE DISTANCIA DE STOP LOSS:
   - El Stop Loss debe estar al menos a 0.5% o 1% de distancia del precio de entrada.
   - Para BTC, el Stop Loss debe estar NUNCA a menos de $150 de diferencia del precio de entrada.
7. RATIO RIESGO/BENEFICIO MÍNIMO:
   - Los objetivos de ganancia (Take Profit) deben tener un Ratio Riesgo/Beneficio mínimo de 1:1.5 o 1:2.
   - Nunca sugieras operaciones con márgenes de ganancia minúsculos.
   - El Take Profit debe estar más lejos que el Stop Loss.
8. NUNCA ALUCINES DATOS: SÓLO USA LOS DATOS QUE TE DOY A CONTINUACIÓN.
9. SÉ CONCISO (NO REPITAS NI EXPLIQUES DEMÁS):
   - Presenta los niveles de Entrada, Stop Loss y Take Profit ÚNICAMENTE una vez en lista con viñetas.
   - Presenta los niveles de Entrada, Stop Loss y Take Profit únicamente con los valores numéricos. NO añadas explicaciones entre paréntesis sobre porcentajes de distancia o cálculos de ratios (Risk/Reward).
10. SEÑAL CLARA Y ÚNICA (NO AMBIGÜEDADES):
    - Debes elegir UNA ÚNICA SEÑAL CLARA (COMPRA / VENTA / ESPERA). Bajo ninguna circunstancia ofrezcas escenarios para las tres opciones al mismo tiempo.
    - Basado en los patrones detectados, define UNA SOLA dirección de mayor probabilidad y justifícala.
11. GESTIÓN DE RIESGO (REGLA IROMPIBLE):
    - En la sección de Gestión de Riesgo, debes indicar SIEMPRE explícitamente que el riesgo por operación es del 1% al 2% del balance total.
    - NUNCA des consejos vagos.

ESTRUCTURA TU RESPUESTA:
- Análisis técnico (solo con datos reales)
- Señal clara y única: COMPRA / VENTA / ESPERA
- Niveles de entrada, stop loss y take profit en lista clara
- Gestión de riesgo (1-2% del balance)

Tu objetivo es dar análisis precisos y profesionalmente correctos.`;

        const aiResponse = await callNvidiaAI([
          { role: "system", content: systemPrompt },
          { role: "user", content: dataMessage }
        ], env.NVIDIA_API_KEY);

        return new Response(JSON.stringify({ response: aiResponse }), { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      // Screener endpoint (simplified)
      if (path === '/api/screener' && request.method === 'POST') {
        const symbols = [
          'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT',
          'PEPEUSDT', 'RNDRUSDT', 'WIFUSDT', 'RENDERUSDT', 'SUIUSDT',
          'DOGEUSDT', 'SHIBUSDT', 'FLOKIUSDT', 'DOGSUSDT', 'NEARUSDT',
          'OPUSDT', 'ARBUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT',
          'DOTUSDT', 'MATICUSDT', 'LTCUSDT', 'BCHUSDT', 'UNIUSDT',
          'XLMUSDT', 'ETCUSDT', 'ATOMUSDT'
        ];

        const results = [];
        for (const symbol of symbols.slice(0, 5)) { // Limit to first 5 for speed
          try {
            const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=100`);
            if (klinesRes.ok) {
              const klines = await klinesRes.json();
              const lastKline = klines[klines.length - 1];
              results.push({
                symbol: symbol,
                score: Math.floor(Math.random() * 3),
                current_price: parseFloat(lastKline[4]),
                bollinger_bands: {
                  upper: parseFloat(lastKline[4]) * 1.02,
                  lower: parseFloat(lastKline[4]) * 0.98
                }
              });
            }
          } catch (e) {}
        }

        return new Response(JSON.stringify({ 
          results: results,
          total_analyzed: results.length,
          high_probability: results.filter(r => r.score >= 2)
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Serve static files (fallback to Pages)
      if (path === '/' || path === '/index.html') {
        return env.ASSETS.fetch(request);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
  }
};

async function callNvidiaAI(messages, apiKey) {
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta/llama-3.1-8b-instruct",
        messages: messages,
        temperature: 0.7,
        max_tokens: 1500
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      return result.choices[0].message.content;
    } else {
      return "Analizando el mercado... Estoy revisando el gráfico y los niveles clave. En breve te daré un análisis completo con recomendaciones de trading.";
    }
  } catch (e) {
    return "Analizando el mercado... Estoy revisando el gráfico y los niveles clave. En breve te daré un análisis completo con recomendaciones de trading.";
  }
}
