from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
from datetime import datetime
import os

try:
    from pattern_detector import detect_patterns
    PATTERN_DETECTOR_AVAILABLE = True
except Exception as e:
    PATTERN_DETECTOR_AVAILABLE = False
    print(f"Pattern detector no disponible: {e}")

try:
    from breakout_screener import analyze_symbol
    BREAKOUT_SCREENER_AVAILABLE = True
except Exception as e:
    BREAKOUT_SCREENER_AVAILABLE = False
    print(f"Breakout screener no disponible: {e}")

try:
    import institutional
    INSTITUTIONAL_AVAILABLE = True
except Exception as e:
    INSTITUTIONAL_AVAILABLE = False
    print(f"Módulos institucionales no disponibles: {e}")

app = Flask(__name__)
CORS(app)

# Tu API Key de NVIDIA
NVIDIA_API_KEY = "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"

@app.route('/')
def index():
    return send_from_directory(os.path.dirname(__file__), 'preview.html')

@app.route('/api/ticker/<symbol>', methods=['GET'])
def get_ticker(symbol):
    """Endpoint para obtener datos de ticker desde Binance"""
    try:
        # Limpiar el símbolo
        symbol_clean = symbol.replace('BINANCE:', '').replace('/', '').replace(':', '').upper()
        print(f"Obteniendo datos para: {symbol_clean}")
        
        # Llamar a la API pública de Binance
        response = requests.get(f"https://api.binance.com/api/v3/ticker/24hr?symbol={symbol_clean}", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            print(f"Datos recibidos de Binance: {data}")
            return jsonify({
                'lastPrice': float(data['lastPrice']),
                'priceChangePercent': float(data['priceChangePercent']),
                'highPrice': float(data['highPrice']),
                'lowPrice': float(data['lowPrice']),
                'quoteVolume': float(data['quoteVolume'])
            })
        else:
            print(f"Error en API de Binance: {response.status_code}")
            # Fallback: intentar con BTCUSDT
            response_btc = requests.get("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT", timeout=10)
            if response_btc.status_code == 200:
                data = response_btc.json()
                return jsonify({
                    'lastPrice': float(data['lastPrice']),
                    'priceChangePercent': float(data['priceChangePercent']),
                    'highPrice': float(data['highPrice']),
                    'lowPrice': float(data['lowPrice']),
                    'quoteVolume': float(data['quoteVolume'])
                })
            
    except Exception as e:
        print(f"Error en ticker: {e}")
    
    # Último recurso: datos de ejemplo
    return jsonify({
        'lastPrice': 67500.0,
        'priceChangePercent': 2.3,
        'highPrice': 69000.0,
        'lowPrice': 66000.0,
        'quoteVolume': 15000000000
    }), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    print("Nueva solicitud de chat recibida")
    try:
        data = request.json
        user_message = data.get('message', '')
        symbol = data.get('symbol', 'BTCUSDT')
        current_date = datetime.now().strftime("%d de %B de %Y")
        
        print(f"Mensaje: {user_message}")
        print(f"Símbolo: {symbol}")
        
        # Obtener datos REALES del mercado
        symbol_clean = symbol.replace('BINANCE:', '').replace('/', '').replace(':', '').upper()
        print(f"Obteniendo datos reales para: {symbol_clean}")

        market_data = None
        klines_data = None
        pattern_data = None
        try:
            response = requests.get(f"https://api.binance.com/api/v3/ticker/24hr?symbol={symbol_clean}", timeout=10)
            if response.status_code == 200:
                market_data = response.json()
                print(f"Datos reales del mercado: {market_data}")

            # Obtener más velas para detección de patrones
            response_klines = requests.get(f"https://api.binance.com/api/v3/klines?symbol={symbol_clean}&interval=5m&limit=50", timeout=10)
            if response_klines.status_code == 200:
                klines_data = response_klines.json()
                print(f"Obtenidas {len(klines_data)} velas para análisis de patrones")

                # Convertir klines al formato del pattern detector
                candles_for_patterns = []
                for kline in klines_data:
                    candles_for_patterns.append({
                        "timestamp": kline[0],
                        "open": float(kline[1]),
                        "high": float(kline[2]),
                        "low": float(kline[3]),
                        "close": float(kline[4]),
                        "volume": float(kline[5])
                    })

                # Detectar patrones
                if PATTERN_DETECTOR_AVAILABLE:
                    pattern_data = detect_patterns(candles_for_patterns)
                    print(f"Patrón detectado: {pattern_data.get('name', 'ninguno')}")
        except Exception as e:
            print(f"Error obteniendo datos reales: {e}")

        # Construir prompt con datos REALES
        system_prompt = f"""ERES UN ANALISTA TÉCNICO EXPERTO EN TRADING DE CRIPTOMONEDAS. REGLAS ESTRICTAS DE FORMATO Y LÓGICA:

1. FECHA ACTUAL: {current_date} - NUNCA uses fechas pasadas ni inventadas.
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
9. SÉ CONCISO (NO REPITAS NI EXPLICAS DEMÁS):
   - Presenta los niveles de Entrada, Stop Loss y Take Profit ÚNICAMENTE una vez en lista con viñetas.
   - Presenta los niveles de Entrada, Stop Loss y Take Profit únicamente con los valores numéricos. NO añadas explicaciones entre paréntesis sobre porcentajes de distancia o cálculos de ratios (Risk/Reward).
10. SEÑAL CLARA Y ÚNICA (NO AMBIGUEDADES):
    - Debes elegir UNA ÚNICA SEÑAL CLARA (Compra, Venta o Espera). Bajo ninguna circunstancia ofrezcas escenarios para las tres opciones al mismo tiempo.
    - Basado en los patrones detectados, define UNA SOLA dirección de mayor probabilidad y justifícala.
    - Si hay un patrón alcista (Double Bottom, Inverse Head and Shoulders) → inclínate por COMPRA.
    - Si hay un patrón bajista (Head and Shoulders Top) → inclínate por VENTA.
11. GESTIÓN DE RIESGO (REGLA IROMPIBLE):
    - En la sección de Gestión de Riesgo, debes indicar SIEMPRE explícitamente que el riesgo por operación es del 1% al 2% del balance total.
    - NUNCA des consejos vagos.

ESTRUCTURA TU RESPUESTA:
- Análisis técnico (solo con datos reales)
- Patrones detectados (si los hay)
- Señal clara y única: COMPRA / VENTA / ESPERA
- Niveles de entrada, stop loss y take profit en lista clara
- Gestión de riesgo (1-2% del balance)

Tu objetivo es dar análisis precisos y profesionalmente correctos."""

        # Añadir datos reales al mensaje
        data_message = user_message
        if market_data:
            data_message = f"""DATOS REALES DEL MERCADO PARA {symbol_clean} (FECHA: {current_date}):
- PRECIO ACTUAL: ${market_data.get('lastPrice')}
- PRECIO MÁS ALTO 24H: ${market_data.get('highPrice')}
- PRECIO MÁS BAJO 24H: ${market_data.get('lowPrice')}
- CAMBIO 24H: {market_data.get('priceChangePercent')}%
- VOLUMEN 24H: ${market_data.get('quoteVolume')}

"""
            if pattern_data:
                pattern_name = pattern_data.get('name')
                if pattern_name:
                    data_message += "PATRONES DETECTADOS:\n"
                    data_message += f"- Patrón: {pattern_name.replace('_', ' ').title()}\n"
                    data_message += f"- Calidad de formación: {pattern_data.get('formation_quality', 'n/a')}\n"
                    data_message += f"- Tasa de fallo documentada: {pattern_data.get('documented_failure_rate_pct', 'n/a')}%\n"
                    data_message += f"- Confirmado: {'SÍ' if pattern_data.get('confirmation_condition_met') else 'NO'}\n"
                    if pattern_data.get('invalidation_price'):
                        data_message += f"- Precio de invalidación: ${pattern_data['invalidation_price']:.2f}\n"
                    if pattern_data.get('target_price'):
                        data_message += f"- Objetivo (target): ${pattern_data['target_price']:.2f}\n"
                    data_message += f"- Detalles: {' | '.join(pattern_data.get('details', []))}\n"
                else:
                    data_message += "PATRONES DETECTADOS: Ninguno\n"

            if klines_data:
                data_message += "\nÚLTIMAS VELAS (5m):\n"
                for i, kline in enumerate(klines_data[-5:], 1):
                    data_message += f"Vela {i}: A=${kline[1]}, M=${kline[2]}, B=${kline[3]}, C=${kline[4]}, V={kline[5]}\n"

            data_message += f"\nPREGUNTA DEL USUARIO: {user_message}"
        
        ai_response = call_nvidia_ai([
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": data_message}
        ])
        
        print(f"Respuesta AI generada: {ai_response[:100]}...")
        return jsonify({"response": ai_response})
    except Exception as e:
        print(f"Error general en chat: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"response": f"Error: {str(e)}"})

def call_nvidia_ai(messages):
    """Función para llamar a la API de NVIDIA"""
    print(f"Llamando a NVIDIA AI con {len(messages)} mensajes...")
    
    # Primero intentamos con requests directo (más robusto)
    try:
        print(f"   Intentando con requests POST...")
        response = requests.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {NVIDIA_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "meta/llama-3.1-8b-instruct",
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 1500
            },
            timeout=60
        )
        print(f"   Respuesta status: {response.status_code}")
        if response.status_code == 200:
            result = response.json()
            print(f"   Respuesta exitosa!")
            return result['choices'][0]['message']['content']
        else:
            print(f"   Error {response.status_code}: {response.text}")
    except Exception as e:
        print(f"   Error en requests: {str(e)}")
    
    # Último recurso
    print("   Usando fallback...")
    return "Analizando el mercado... Estoy revisando el gráfico y los niveles clave. En breve te daré un análisis completo con recomendaciones de trading."


@app.route('/api/screener', methods=['POST'])
def run_screener():
    """
    Endpoint del Escáner de Breakout.
    
    Analiza múltiples símbolos con los 3 filtros:
    1. Squeeze de Volatilidad (Bandas de Bollinger)
    2. Anomalía de Volumen Acumulativo
    3. Proximidad a Bloques de Órdenes (Resistencias)
    """
    try:
        data = request.json or {}
        symbols = data.get('symbols', [
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT', 'LINKUSDT',
            'PEPEUSDT', 'RNDRUSDT', 'WIFUSDT', 'RENDERUSDT', 'SUIUSDT',
            'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'PEPEUSDT', 'FLOKIUSDT',
            'DOGSUSDT', 'NEARUSDT', 'OPUSDT', 'ARBUSDT', 'BNBUSDT',
            'XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'MATICUSDT', 'LTCUSDT',
            'BCHUSDT', 'UNIUSDT', 'XLMUSDT', 'ETCUSDT', 'ATOMUSDT'
        ])
        
        timeframe = data.get('timeframe', '5m')
        limit = data.get('limit', 100)
        
        print(f"Ejecutando escáner para {len(symbols)} símbolos en timeframe {timeframe}...")
        
        results = []
        
        for symbol in symbols:
            try:
                # Obtener velas de Binance
                klines_response = requests.get(
                    f"https://api.binance.com/api/v3/klines?symbol={symbol}&interval={timeframe}&limit={limit}",
                    timeout=10
                )
                
                if klines_response.status_code == 200:
                    klines = klines_response.json()
                    # Analizar con el escáner
                    analysis = analyze_symbol(symbol, klines)
                    results.append(analysis)
                else:
                    results.append({
                        "symbol": symbol,
                        "passed": False,
                        "reason": f"Error en API Binance: {klines_response.status_code}"
                    })
            except Exception as e:
                print(f"Error con {symbol}: {e}")
                results.append({
                    "symbol": symbol,
                    "passed": False,
                    "reason": str(e)
                })
        
        # Ordenar por score (mejores primero
        results.sort(key=lambda x: x.get('score', 0), reverse=True)
        
        print(f"Escáner completado! Encontrados {len([r for r in results if r.get('score', 0) >= 2])} candidatos de alta probabilidad")
        
        return jsonify({
            "results": results,
            "total_analyzed": len(results),
            "high_probability": [r for r in results if r.get('score', 0) >= 2]
        })
        
    except Exception as e:
        print(f"Error en escáner: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# =====================
# ENDPOINTS INSTITUCIONALES
# =====================
@app.route('/api/market-climate', methods=['GET'])
def get_market_climate_endpoint():
    """Obtiene el clima general del mercado"""
    if not INSTITUTIONAL_AVAILABLE:
        return jsonify({"error": "Módulos institucionales no disponibles"}), 500
    
    climate = institutional.get_market_climate()
    return jsonify(climate)


@app.route('/api/news/<symbol>', methods=['GET'])
def get_news_endpoint(symbol):
    """Obtiene noticias recientes de un símbolo"""
    if not INSTITUTIONAL_AVAILABLE:
        return jsonify({"error": "Módulos institucionales no disponibles"}), 500
    
    news = institutional.get_crypto_news(symbol)
    return jsonify({"news": news})


@app.route('/api/audit/signals', methods=['GET'])
def get_audit_signals():
    """Obtiene todas las señales de la bitácora"""
    if not INSTITUTIONAL_AVAILABLE:
        return jsonify({"error": "Módulos institucionales no disponibles"}), 500
    
    signals = institutional.get_all_signals()
    return jsonify({"signals": signals})


@app.route('/api/audit/signals', methods=['POST'])
def save_audit_signal():
    """Guarda una nueva señal en la bitácora"""
    if not INSTITUTIONAL_AVAILABLE:
        return jsonify({"error": "Módulos institucionales no disponibles"}), 500
    
    data = request.json
    signal_id = institutional.save_signal(
        symbol=data.get("symbol"),
        signal_type=data.get("signal_type"),
        entry_price=data.get("entry_price"),
        stop_loss=data.get("stop_loss"),
        take_profit=data.get("take_profit"),
        risk_percent=data.get("risk_percent", 1.5),
        ai_analysis=data.get("ai_analysis", ""),
        news_included=data.get("news_included", ""),
        market_climate=data.get("market_climate", "")
    )
    return jsonify({"signal_id": signal_id})


@app.route('/api/audit/run', methods=['POST'])
def run_audit():
    """Ejecuta la auditoría automática de señales pendientes"""
    if not INSTITUTIONAL_AVAILABLE:
        return jsonify({"error": "Módulos institucionales no disponibles"}), 500
    
    institutional.audit_signals()
    return jsonify({"status": "Auditoría completada"})


if __name__ == '__main__':
    print("TRADING BOT INICIADO!")
    print("Backend corriendo en http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
