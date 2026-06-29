import ccxt
import time
import requests
import json
from datetime import datetime
import numpy as np

class TradingAgent:
    def __init__(self):
        self.exchange = ccxt.binance()
        self.nvidia_api_key = "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"
    
    def get_market_data(self, symbol):
        try:
            ohlcv = self.exchange.fetch_ohlcv(symbol, '1m', limit=500)
            ticker = self.exchange.fetch_ticker(symbol)
            orderbook = self.exchange.fetch_order_book(symbol, limit=20)
            
            prices = [x[4] for x in ohlcv]
            volumes = [x[5] for x in ohlcv]
            
            # Calcular indicadores básicos
            sma20 = np.mean(prices[-20:]) if len(prices) >=20 else None
            sma50 = np.mean(prices[-50:]) if len(prices) >=50 else None
            
            return {
                'symbol': symbol,
                'current_price': ticker['last'],
                'high_24h': ticker['high'],
                'low_24h': ticker['low'],
                'volume_24h': ticker['quoteVolume'],
                'change_24h': ticker['percentage'],
                'sma20': sma20,
                'sma50': sma50,
                'orderbook_bids': orderbook['bids'][:5],
                'orderbook_asks': orderbook['asks'][:5],
                'timestamp': datetime.now().isoformat()
            }
        except Exception as e:
            return {'error': str(e)}
    
    def analyze_with_ai(self, market_data):
        try:
            prompt = f"""
            ANÁLISIS DE TRADING PROFESIONAL - {market_data['symbol']}
            
            DATOS DEL MERCADO:
            - Precio Actual: ${market_data['current_price']}
            - Máximo 24h: ${market_data['high_24h']}
            - Mínimo 24h: ${market_data['low_24h']}
            - Volumen 24h: ${market_data['volume_24h']:,.0f}
            - Cambio 24h: {market_data['change_24h']:.2f}%
            - SMA20: ${market_data['sma20']:.6f}
            - SMA50: ${market_data['sma50']:.6f}
            
            ORDENES DE COMPRA (BIDS):
            {market_data['orderbook_bids']}
            
            ORDENES DE VENTA (ASKS):
            {market_data['orderbook_asks']}
            
            INSTRUCCIONES:
            1. Analiza el mercado y da una señal clara de COMPRA, VENTA o ESPERA
            2. Identifica niveles clave de SOPORTE y RESISTENCIA
            3. Calcula un posible punto de entrada y objetivos de toma de ganancias
            4. Define un stop loss adecuado
            5. Justifica tu análisis técnicamente
            
            Responde en español con emojis y estructura clara.
            """
            
            response = requests.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.nvidia_api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "meta/llama-3.1-405b-instruct",
                    "messages": [
                        {"role": "system", "content": "Eres un analista de trading profesional experto en criptomonedas."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.7,
                    "max_tokens": 1500
                }
            )
            
            if response.status_code == 200:
                return response.json()['choices'][0]['message']['content']
            else:
                return f"Error en API: {response.text}"
        except Exception as e:
            return f"Error: {str(e)}"
    
    def get_full_analysis(self, symbol):
        market_data = self.get_market_data(symbol)
        if 'error' in market_data:
            return market_data
        ai_analysis = self.analyze_with_ai(market_data)
        return {
            'market_data': market_data,
            'ai_analysis': ai_analysis
        }

# Ejemplo de uso
if __name__ == "__main__":
    agent = TradingAgent()
    result = agent.get_full_analysis('BTC/USDT')
    print(json.dumps(result, indent=2))
