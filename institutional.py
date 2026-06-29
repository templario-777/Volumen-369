
import sqlite3
import requests
import time
from datetime import datetime, timedelta
import statistics
from typing import Dict, List, Optional

# =====================
# 0. CONFIGURACIÓN DE WEBHOOKS
# =====================
# Puedes configurar webhooks para notificaciones (Telegram, Discord, Slack, etc.)
WEBHOOK_URL = None  # Ej: "https://api.telegram.org/botTOKEN/sendMessage" o URL de Discord/Slack

def send_webhook_notification(message: str) -> bool:
    """
    Envía una notificación via webhook (para alertas de señales).
    Para usar:
    - Telegram: Crea un bot con @BotFather, obtén token y chat ID
    - Discord: Crea un webhook en Server Settings → Integrations
    """
    if not WEBHOOK_URL:
        return False
        
    try:
        payload = {
            "content": message,  # Para Discord/Slack
            # Para Telegram usar {"chat_id": "TU_CHAT_ID", "text": message}
        }
        response = requests.post(WEBHOOK_URL, json=payload, timeout=10)
        return response.status_code in [200, 204]
    except Exception as e:
        print(f"Error enviando webhook: {e}")
        return False


# =====================
# 1. BASE DE DATOS (BITÁCORA DE AUDITORÍA)
# =====================
def init_db():
    """Inicializa la base de datos SQLite para la bitácora"""
    conn = sqlite3.connect('trading_audit.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            symbol TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            entry_price REAL,
            stop_loss REAL,
            take_profit REAL,
            risk_percent REAL,
            ai_analysis TEXT,
            news_included TEXT,
            market_climate TEXT,
            status TEXT DEFAULT 'PENDIENTE',
            result_24h TEXT,
            final_price REAL,
            pnl_percent REAL,
            checked_at DATETIME
        )
    ''')
    
    conn.commit()
    conn.close()


def save_signal(symbol: str, signal_type: str, entry_price: float, 
               stop_loss: float, take_profit: float, risk_percent: float,
               ai_analysis: str = "", news_included: str = "", 
               market_climate: str = "") -> int:
    """Guarda una nueva señal en la bitácora"""
    conn = sqlite3.connect('trading_audit.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        INSERT INTO signals 
        (symbol, signal_type, entry_price, stop_loss, take_profit, 
         risk_percent, ai_analysis, news_included, market_climate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (symbol, signal_type, entry_price, stop_loss, take_profit,
          risk_percent, ai_analysis, news_included, market_climate))
    
    signal_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return signal_id


def get_pending_signals() -> List[Dict]:
    """Obtiene todas las señales pendientes de revisión"""
    conn = sqlite3.connect('trading_audit.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM signals WHERE status = "PENDIENTE"')
    signals = []
    for row in cursor.fetchall():
        signals.append(dict(row))
    
    conn.close()
    return signals


def update_signal_status(signal_id: int, status: str, result_24h: str = "", 
                        final_price: float = None, pnl_percent: float = None):
    """Actualiza el estado de una señal (TP/SL/Cancelado)"""
    conn = sqlite3.connect('trading_audit.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        UPDATE signals 
        SET status = ?, result_24h = ?, final_price = ?, 
            pnl_percent = ?, checked_at = CURRENT_TIMESTAMP
        WHERE id = ?
    ''', (status, result_24h, final_price, pnl_percent, signal_id))
    
    conn.commit()
    conn.close()


def get_all_signals(limit: int = 100) -> List[Dict]:
    """Obtiene todas las señales de la bitácora"""
    conn = sqlite3.connect('trading_audit.db')
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM signals ORDER BY timestamp DESC LIMIT ?', (limit,))
    signals = []
    for row in cursor.fetchall():
        signals.append(dict(row))
    
    conn.close()
    return signals


# =====================
# 2. MÓDULO: CLIMA GENERAL DEL MERCADO
# =====================
def get_market_climate() -> Dict:
    """
    Analiza el clima general del mercado basado en:
    - Tendencia de BTC
    - Dominancia de BTC (BTC.D)
    - VIX de cripto (si disponible)
    """
    climate = {
        "btc_trend": "NEUTRO",
        "btc_dominance": 0,
        "btc_price": 0,
        "btc_change_24h": 0,
        "overall_climate": "NEUTRO",
        "block_long_signals": False
    }
    
    try:
        # Obtener datos de BTC
        btc_response = requests.get(
            'https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
            timeout=10
        )
        if btc_response.status_code == 200:
            btc_data = btc_response.json()
            climate["btc_price"] = float(btc_data["lastPrice"])
            climate["btc_change_24h"] = float(btc_data["priceChangePercent"])
        
        # Obtener velas de BTC para análisis de tendencia
        klines_response = requests.get(
            'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24',
            timeout=10
        )
        if klines_response.status_code == 200:
            klines = klines_response.json()
            closes = [float(k[4]) for k in klines]
            
            # Calcular tendencia simple (media móvil)
            if len(closes) >= 12:
                ma_long = statistics.mean(closes[-12:])
                ma_short = statistics.mean(closes[-6:])
                current_close = closes[-1]
                
                if ma_short > ma_long and current_close > ma_short:
                    climate["btc_trend"] = "ALCISTA"
                elif ma_short < ma_long and current_close < ma_short:
                    climate["btc_trend"] = "BAJISTA"
        
        # Determinar clima general
        btc_change = climate["btc_change_24h"]
        
        if btc_change < -5:
            climate["overall_climate"] = "PÁNICO"
            climate["block_long_signals"] = True
        elif btc_change < -2:
            climate["overall_climate"] = "PRECAUCIÓN"
            climate["block_long_signals"] = True
        elif btc_change > 2:
            climate["overall_climate"] = "SEGURO"
        else:
            climate["overall_climate"] = "NEUTRO"
            
    except Exception as e:
        print(f"Error obteniendo clima del mercado: {e}")
        climate["overall_climate"] = "ERROR"
    
    return climate


# =====================
# 3. MÓDULO: NOTICIAS (CATALIZADOR)
# =====================
def get_crypto_news(symbol: str, limit: int = 3) -> List[Dict]:
    """
    Obtiene noticias recientes de una criptomoneda usando CryptoPanic
    (Nota: Requiere API key de CryptoPanic - https://cryptopanic.com/developers/api/)
    """
    news = []
    
    # Mapeo de símbolos a códigos de CryptoPanic
    symbol_map = {
        "BTC": "BTC",
        "ETH": "ETH",
        "SOL": "SOL",
        "AVAX": "AVAX",
        "LINK": "LINK",
        "PEPE": "PEPE",
        "RNDR": "RNDR",
        "DOGE": "DOGE",
        "XRP": "XRP",
        "ADA": "ADA"
    }
    
    # Extraer el símbolo base (quitar USDT)
    base_symbol = symbol.replace("USDT", "").upper()
    
    try:
        # Por ahora usamos un placeholder hasta que el usuario agregue su API key
        # Para producción, registrarse en CryptoPanic y agregar la key
        news = [
            {
                "title": f"Noticia de ejemplo para {base_symbol}",
                "source": "Ejemplo",
                "published_at": datetime.now().isoformat()
            }
        ]
        
    except Exception as e:
        print(f"Error obteniendo noticias: {e}")
    
    return news


# =====================
# 4. MÓDULO: AUDITORÍA AUTOMÁTICA (Revisar señales después de 24h)
# =====================
def audit_signals():
    """Revisa automáticamente las señales pendientes después de 24 horas"""
    pending_signals = get_pending_signals()
    now = datetime.now()
    
    for signal in pending_signals:
        signal_time = datetime.fromisoformat(signal["timestamp"])
        time_diff = now - signal_time
        
        # Revisar solo si han pasado más de 24 horas
        if time_diff < timedelta(hours=24):
            continue
            
        symbol = signal["symbol"]
        try:
            # Obtener precio actual
            ticker_response = requests.get(
                f'https://api.binance.com/api/v3/ticker/24hr?symbol={symbol}',
                timeout=10
            )
            if ticker_response.status_code == 200:
                data = ticker_response.json()
                current_price = float(data["lastPrice"])
                
                # Determinar resultado
                entry = signal["entry_price"]
                sl = signal["stop_loss"]
                tp = signal["take_profit"]
                signal_type = signal["signal_type"]
                
                pnl = 0
                status = "CANCELADO"
                
                if signal_type == "COMPRA":
                    if current_price >= tp:
                        status = "TP"
                        pnl = ((tp - entry) / entry) * 100
                    elif current_price <= sl:
                        status = "SL"
                        pnl = ((sl - entry) / entry) * 100
                    else:
                        pnl = ((current_price - entry) / entry) * 100
                elif signal_type == "VENTA":
                    if current_price <= tp:
                        status = "TP"
                        pnl = ((entry - tp) / entry) * 100
                    elif current_price >= sl:
                        status = "SL"
                        pnl = ((entry - sl) / entry) * 100
                    else:
                        pnl = ((entry - current_price) / entry) * 100
                
                update_signal_status(
                    signal_id=signal["id"],
                    status=status,
                    result_24h=f"Precio final: {current_price}",
                    final_price=current_price,
                    pnl_percent=pnl
                )
                print(f"Auditoría actualizada para {symbol}: {status} ({pnl:.2f}%)")
                
        except Exception as e:
            print(f"Error auditando señal {signal['id']}: {e}")


# Inicializar DB al importar
init_db()

