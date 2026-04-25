import time
import ccxt
import pandas as pd
import os
import requests
from datetime import datetime

# =========================
# CONFIGURACIÓN (Headless)
# =========================
# Se intenta cargar de variables de entorno o un archivo .env si existiera
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "TU_API_KEY")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "TU_API_SECRET")
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
USD_PER_TRADE = float(os.getenv("USD_PER_TRADE", 50))
TOP_N = 10
TP_PCT = 4.0
SL_PCT = 2.0

def crear_exchange():
    config = {
        'apiKey': BINANCE_API_KEY,
        'secret': BINANCE_API_SECRET,
        'enableRateLimit': True,
        'options': {'defaultType': 'spot'},
    }
    
    worker_url = os.getenv("CLOUDFLARE_WORKER_URL")
    if worker_url:
        # Asegurarse de que la URL no termine en / para evitar dobles //
        worker_url = worker_url.rstrip('/')
        proxy_url = f"{worker_url}?target=https://api.binance.com"
        config['proxies'] = {
            'http': proxy_url,
            'https': proxy_url,
        }
        print(f"🌐 Usando Cloudflare Worker como proxy: {worker_url}")
    
    return ccxt.binance(config)

def obtener_ohlcv(exchange, symbol):
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe='5m', limit=100)
        if not ohlcv:
            print(f"⚠️ No se recibieron datos OHLCV para {symbol}")
            return pd.DataFrame()
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        return df
    except Exception as e:
        print(f"❌ Error obteniendo OHLCV para {symbol}: {e}")
        return pd.DataFrame()

def calcular_indicadores(df):
    if len(df) < 50: return df
    df = df.copy()
    df['vol_ma20'] = df['volume'].rolling(20).mean()
    df['rvol'] = df['volume'] / df['vol_ma20']
    df['sma50'] = df['close'].rolling(50).mean()
    df['sma200'] = df['close'].rolling(200).mean()
    return df.dropna()

def detectar_patron(df):
    if len(df) < 2: return "HOLD", 0
    row = df.iloc[-1]
    prev = df.iloc[-2]
    alcista = row['sma50'] > row['sma200']
    bajista = row['sma50'] < row['sma200']
    ruptura_alcista = row['close'] > prev['high'] and row['volume'] > prev['volume'] * 1.5
    ruptura_bajista = row['close'] < prev['low'] and row['volume'] > prev['volume'] * 1.5
    if alcista and ruptura_alcista and row['rvol'] > 2.0: return "BUY", 100
    if bajista and ruptura_bajista and row['rvol'] > 2.0: return "SELL", 100
    return "HOLD", 0

def enviar_telegram(mensaje):
    if not TELEGRAM_BOT_TOKEN: return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": mensaje})

def main():
    print(f"🚀 Bot Volumen-369 Headless Iniciado - {datetime.now()}")
    exchange = crear_exchange()
    
    while True:
        try:
            markets = exchange.fetch_markets()
            symbols = [m['symbol'] for m in markets if m['quote'] == 'USDT'][:TOP_N]
            
            for symbol in symbols:
                df = obtener_ohlcv(exchange, symbol)
                if df.empty: continue
                df = calcular_indicadores(df)
                patron, fuerza = detectar_patron(df)
                
                if patron != "HOLD":
                    msg = f"🚨 SEÑAL: {patron} en {symbol} (Fuerza: {fuerza}%)"
                    print(msg)
                    enviar_telegram(msg)
            
            time.sleep(300) # Esperar 5 minutos
        except Exception as e:
            print(f"Error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    main()
