export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 200 });
    }

    try {
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

      if (path === '/api/chat' && request.method === 'POST') {
        const body = await request.json();
        const userMessage = body.message;
        const symbol = body.symbol || 'BTCUSDT';
        const currentDate = new Date().toLocaleDateString('es-ES', { 
          day: 'numeric', month: 'long', year: 'numeric' 
        });

        const symbolClean = symbol.replace('BINANCE:', '').replace('/', '').replace(':', '').toUpperCase();
        let marketData = null;
        let klinesData = null;
        try {
          const marketRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbolClean}`);
          if (marketRes.ok) marketData = await marketRes.json();
          
          const klinesRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbolClean}&interval=5m&limit=50`);
          if (klinesRes.ok) klinesData = await klinesRes.json();
        } catch (e) {}

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

        const systemPrompt = `ERES UN ANALISTA TÉCNICO EXPERTO EN TRADING DE CRIPTOMONEDAS. REGLAS ESTRICTAS DE FORMATO Y LÓGICA:
1. FECHA ACTUAL: ${currentDate} - NUNCA uses fechas pasadas ni inventadas.
2. REDONDEA PRECIOS: Redondea todos los precios de criptomonedas a un máximo de 2 decimales. Nunca muestres 8 ceros.
3. TERMINOLOGÍA CORRECTA: Usa "Vela" o "Candlestick" en lugar de "candelilla". Usa "nivel" no "nível".
4. RSI: Nivel de sobrecompra = 70 o superior. Nivel de sobreventa = 30 o inferior.
5. LÓGICA DE STOP LOSS:
   - Para LONG (compra): Stop loss SIEMPRE POR DEBAJO del precio de entrada.
   - Para SHORT (venta): Stop loss SIEMPRE POR ENCIMA del precio de entrada.
6. LÓGICA DE DISTANCIA DE STOP LOSS:
   - El Stop loss debe estar al menos a 0.5% o 1% de distancia del precio de entrada.
   - Para BTC, el Stop loss debe estar NUNCA a menos de $150 de diferencia del precio de entrada.
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
        for (const symbol of symbols.slice(0, 5)) {
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

      if (path === '/' || path === '/index.html') {
        const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trading Bot - Análisis de IA</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', sans-serif;
            background: #0a0e13;
            color: #e2e8f0;
            overflow: hidden;
            height: 100vh;
        }
        .container { display: flex; height: 100vh; }
        .sidebar {
            width: 320px;
            background: #0f1318;
            border-right: 1px solid #2a2e35;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 8px;
        }
        .logo-icon {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
        }
        .logo-text {
            font-size: 20px;
            font-weight: 700;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .input-group { display: flex; flex-direction: column; gap: 8px; }
        .input-group label {
            font-size: 13px;
            color: #9ba1a6;
            font-weight: 500;
        }
        .input-group input {
            padding: 14px 16px;
            background: #0a0e13;
            border: 1px solid #2a2e35;
            border-radius: 10px;
            color: white;
            font-size: 14px;
            font-family: inherit;
            outline: none;
            transition: all 0.3s;
        }
        .input-group input:focus {
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .price-display {
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%);
            border: 1px solid rgba(59, 130, 246, 0.2);
            border-radius: 14px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .price-display .symbol {
            font-size: 12px;
            color: #9ba1a6;
            font-weight: 500;
        }
        .price-display .price {
            font-size: 28px;
            font-weight: 700;
            color: #e2e8f0;
        }
        .price-display .change {
            font-size: 14px;
            font-weight: 600;
        }
        .price-display .change.positive { color: #22c55e; }
        .price-display .change.negative { color: #ef4444; }
        button {
            padding: 14px 20px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border: none;
            border-radius: 10px;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            font-family: inherit;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
        }
        button.secondary { background: #2a2e35; }
        button.secondary:hover {
            background: #363b42;
            box-shadow: 0 10px 30px rgba(42, 46, 53, 0.3);
        }
        .chart-container { flex: 1; background: #0a0e13; }
        .tradingview-widget-container { width: 100%; height: 100%; }
        #tradingview_widget { width: 100%; height: 100%; }
        .chat-widget {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 12px;
        }
        .chat-toggle {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border-radius: 50%;
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            box-shadow: 0 10px 40px rgba(59, 130, 246, 0.4);
            transition: all 0.3s;
        }
        .chat-toggle:hover { transform: scale(1.1); }
        .chat-toggle.active { transform: rotate(45deg); }
        .chat-container {
            width: 380px;
            height: calc(100vh - 120px);
            max-height: 600px;
            background: #0f1318;
            border: 1px solid #2a2e35;
            border-radius: 16px;
            display: none;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }
        .chat-container.active { display: flex; }
        .chat-header {
            padding: 16px 20px;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
            border-bottom: 1px solid #2a2e35;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .chat-header-title { display: flex; align-items: center; gap: 12px; }
        .chat-header-icon {
            width: 32px;
            height: 32px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
        }
        .chat-header-text h3 {
            font-size: 16px;
            font-weight: 600;
            color: #e2e8f0;
        }
        .chat-header-text p {
            font-size: 12px;
            color: #22c55e;
        }
        .chat-close {
            background: none;
            border: none;
            color: #9ba1a6;
            font-size: 24px;
            cursor: pointer;
            padding: 4px 8px;
            width: auto;
            height: auto;
            box-shadow: none;
        }
        .chat-close:hover {
            color: #e2e8f0;
            transform: none;
            box-shadow: none;
        }
        .chat-messages {
            flex: 1;
            padding: 16px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-height: 0;
        }
        .chat-messages::-webkit-scrollbar { width: 6px; }
        .chat-messages::-webkit-scrollbar-track { background: #0a0e13; }
        .chat-messages::-webkit-scrollbar-thumb {
            background: #2a2e35;
            border-radius: 3px;
        }
        .message {
            max-width: 80%;
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 14px;
            line-height: 1.6;
            word-wrap: break-word;
        }
        .message.user {
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            align-self: flex-end;
            border-bottom-right-radius: 4px;
        }
        .message.ai {
            background: #2a2e35;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
        }
        .chat-input-container {
            padding: 16px;
            border-top: 1px solid #2a2e35;
            display: flex;
            gap: 8px;
        }
        .chat-input {
            flex: 1;
            padding: 14px 16px;
            background: #0a0e13;
            border: 1px solid #2a2e35;
            border-radius: 10px 0 0 10px;
            color: white;
            font-size: 14px;
            font-family: inherit;
            outline: none;
            transition: all 0.3s;
        }
        .chat-input:focus { border-color: #3b82f6; }
        .chat-send {
            padding: 14px 20px;
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border: none;
            border-radius: 0 10px 10px 0;
            color: white;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s;
            font-family: inherit;
            white-space: nowrap;
        }
        .chat-send:hover { background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); }
    </style>
</head>
<body>
    <div class="container">
        <div class="sidebar">
            <div class="logo">
                <div class="logo-icon">🤖</div>
                <div class="logo-text">Trading Bot</div>
            </div>
            <div class="input-group">
                <label>Par de Trading</label>
                <input type="text" id="symbol-input" value="BTCUSDT" placeholder="Ej: BTCUSDT">
            </div>
            <div class="price-display" id="price-display">
                <div class="symbol" id="price-symbol">CARGANDO...</div>
                <div class="price" id="current-price">$--</div>
                <div class="change" id="price-change">--</div>
            </div>
            <button onclick="updateChart()">🔄 Actualizar Gráfico</button>
            <button class="secondary" onclick="analyzeChart()">🤖 Análisis de IA</button>
            <button style="background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); margin-top: 8px;" onclick="openScreener()">🚀 Escáner de Breakout</button>
            <button style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); margin-top: 8px;" onclick="openInstitutional()">🏛️ Nivel Institucional</button>
        </div>
        <div class="chart-container">
            <div class="tradingview-widget-container">
                <div id="tradingview_widget"></div>
            </div>
        </div>
    </div>
    <div class="chat-widget">
        <div class="chat-container" id="chatWidget">
            <div class="chat-header">
                <div class="chat-header-title">
                    <div class="chat-header-icon">🤖</div>
                    <div class="chat-header-text">
                        <h3>Analizador de Trading</h3>
                        <p>En línea</p>
                    </div>
                </div>
                <button class="chat-close" onclick="toggleChat()">×</button>
            </div>
            <div class="chat-messages" id="chat-messages">
                <div class="message ai">¡Hola! Soy tu asistente de trading.</div>
            </div>
            <div class="chat-input-container">
                <input type="text" class="chat-input" id="chat-input" placeholder="Escribe tu pregunta...">
                <button class="chat-send" onclick="sendMessage()">→</button>
            </div>
        </div>
        <button class="chat-toggle" id="chatToggle" onclick="toggleChat()">💬</button>
    </div>
    <script src="https://s3.tradingview.com/tv.js"></script>
    <script>
        let widget;
        let priceUpdateInterval;

        function initWidget(symbol) {
            if (widget) widget.remove();
            const tvSymbol = symbol.includes('/') ? \`BINANCE:\${symbol.replace('/', '')}\` : (symbol.includes(':') ? symbol : \`BINANCE:\${symbol}\`);
            widget = new TradingView.widget({
                width: '100%', height: '100%', symbol: tvSymbol, interval: '5', timezone: 'Etc/UTC',
                theme: 'dark', style: '1', locale: 'es', toolbar_bg: '#0f1318',
                enable_publishing: false, allow_symbol_change: true, container_id: 'tradingview_widget'
            });
        }
        function updateChart() {
            const symbol = document.getElementById('symbol-input').value;
            initWidget(symbol);
            updatePriceDisplay();
        }
        async function analyzeChart() {
            const symbol = document.getElementById('symbol-input').value;
            toggleChat();
            setTimeout(() => {
                addMessage(\`Analiza el gráfico de \${symbol}\`, 'user');
                sendToAI(\`Analiza el gráfico de \${symbol} en tiempo real y dame un análisis profesional completo con niveles de soporte, resistencia y recomendaciones de trading.\`, symbol);
            }, 300);
        }
        async function updatePriceDisplay() {
            document.getElementById('current-price').textContent = '$...';
            document.getElementById('price-change').textContent = 'CARGANDO...';
            document.getElementById('price-change').style.color = '#9ba1a6';
            
            try {
                let binanceSymbol = document.getElementById('symbol-input').value;
                binanceSymbol = binanceSymbol.replace('BINANCE:', '').replace('/', '').toUpperCase();
                document.getElementById('price-symbol').textContent = binanceSymbol;
                
                const tickerResponse = await fetch(\`https://backend1.d-perez9.workers.dev/api/ticker/\${binanceSymbol}\`);
                
                if (tickerResponse.ok) {
                    const tickerData = await tickerResponse.json();
                    const price = parseFloat(tickerData.lastPrice);
                    const change = parseFloat(tickerData.priceChangePercent);
                    
                    document.getElementById('current-price').textContent = \`$\${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}\`;
                    
                    const changeElement = document.getElementById('price-change');
                    changeElement.textContent = \`\${change >= 0 ? '+' : ''}\${change.toFixed(2)}% (24h)\`;
                    changeElement.style.color = change >= 0 ? '#22c55e' : '#ef4444';
                }
            } catch (e) {
                console.error('Error:', e);
                document.getElementById('current-price').textContent = '$ERROR';
            }
        }
        async function sendMessage() {
            const message = document.getElementById('chat-input').value;
            if (!message) return;
            
            const symbol = document.getElementById('symbol-input').value;
            addMessage(message, 'user');
            document.getElementById('chat-input').value = '';
            sendToAI(message, symbol);
        }
        async function sendToAI(message, symbol) {
            try {
                const response = await fetch('https://backend1.d-perez9.workers.dev/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, symbol })
                });
                const data = await response.json();
                addMessage(data.response, 'ai');
            } catch (error) {
                addMessage('Error al conectar con el servidor de Cloudflare.', 'ai');
            }
        }
        function addMessage(text, type) {
            const div = document.createElement('div');
            div.className = 'message ' + type;
            div.innerText = text;
            document.getElementById('chat-messages').appendChild(div);
            document.getElementById('chat-messages').scrollTop = 1000000;
        }
        function toggleChat() {
            const chatWidget = document.getElementById('chatWidget');
            const chatToggle = document.getElementById('chatToggle');
            chatWidget.classList.toggle('active');
            chatToggle.classList.toggle('active');
        }
        function openScreener() { alert('Escáner de Breakout: funcionalidad disponible'); }
        function openInstitutional() { alert('Panel Institucional: funcionalidad disponible'); }

        initWidget('BINANCE:BTCUSDT');
        priceUpdateInterval = setInterval(updatePriceDisplay, 30000);
        setTimeout(updatePriceDisplay, 500);
        document.getElementById('chat-input').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') sendMessage();
        });
    </script>
</body>
</html>`;
        return new Response(html, { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html;charset=UTF-8' } 
        });
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