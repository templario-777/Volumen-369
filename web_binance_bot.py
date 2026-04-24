import time
from dataclasses import dataclass
from typing import Optional, Tuple

import ccxt
import pandas as pd
import streamlit as st


@dataclass
class AnalyzerConfig:
    symbol: str = "BTC/USDT"
    timeframe: str = "5m"
    limit: int = 300
    vol_multiplier: float = 1.8


def build_public_exchange() -> ccxt.binance:
    """Exchange sin credenciales para datos publicos de mercado."""
    return ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "spot"}})


def build_exchange(api_key: str, api_secret: str, testnet: bool) -> ccxt.binance:
    exchange = ccxt.binance(
        {
            "apiKey": api_key.strip(),
            "secret": api_secret.strip(),
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
    )
    if testnet:
        exchange.set_sandbox_mode(True)
    return exchange


def get_or_create_exchange(api_key: str, api_secret: str, testnet: bool) -> ccxt.binance:
    """Devuelve el exchange cacheado en session_state, creandolo solo si cambian las credenciales."""
    cache_key = f"{api_key}|{api_secret}|{testnet}"
    if st.session_state.get("_exchange_cache_key") != cache_key:
        exchange = build_exchange(api_key, api_secret, testnet)
        exchange.load_markets()
        st.session_state["_exchange_cache_key"] = cache_key
        st.session_state["_exchange"] = exchange
    return st.session_state["_exchange"]


def get_or_create_public_exchange() -> ccxt.binance:
    """Devuelve un exchange publico cacheado para obtener datos de mercado."""
    if "_public_exchange" not in st.session_state:
        exchange = build_public_exchange()
        exchange.load_markets()
        st.session_state["_public_exchange"] = exchange
    return st.session_state["_public_exchange"]


def fetch_ohlcv(exchange: ccxt.binance, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    candles = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(
        candles,
        columns=["timestamp", "open", "high", "low", "close", "volume"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    typical_price = (out["high"] + out["low"] + out["close"]) / 3
    out["vwap"] = (typical_price * out["volume"]).cumsum() / out["volume"].cumsum()
    out["vol_ma20"] = out["volume"].rolling(20).mean()
    out["rvol"] = out["volume"] / out["vol_ma20"]
    out["sma50"] = out["close"].rolling(50).mean()
    out["sma200"] = out["close"].rolling(200).mean()
    return out.dropna()


def generate_signal(df: pd.DataFrame, vol_multiplier: float) -> str:
    row = df.iloc[-1]
    prev = df.iloc[-2]
    bullish_trend = row["sma50"] > row["sma200"]
    bearish_trend = row["sma50"] < row["sma200"]
    breakout_up = row["close"] > prev["high"]
    breakout_down = row["close"] < prev["low"]
    high_volume = row["rvol"] >= vol_multiplier
    above_vwap = row["close"] > row["vwap"]
    below_vwap = row["close"] < row["vwap"]

    if bullish_trend and breakout_up and high_volume and above_vwap:
        return "BUY"
    if bearish_trend and breakout_down and high_volume and below_vwap:
        return "SELL"
    return "HOLD"


def create_order(exchange: ccxt.binance, symbol: str, side: str, amount: float) -> Tuple[bool, str]:
    try:
        order = exchange.create_market_order(symbol=symbol, side=side.lower(), amount=amount)
        return True, f"Orden ejecutada: {order.get('id', 'sin_id')}"
    except Exception as err:
        return False, f"No se pudo ejecutar la orden: {err}"


def main():
    st.set_page_config(page_title="Bot de Volumen Binance", layout="wide")
    st.title("Bot de Trading por Volumen - Binance")
    st.caption("Analisis de mercado por volumen, VWAP y rupturas.")

    with st.sidebar:
        st.header("Conexion Binance")
        api_key = st.text_input("API Key", type="password")
        api_secret = st.text_input("API Secret", type="password")
        testnet = st.checkbox("Usar Testnet", value=True)
        st.divider()
        st.header("Parametros")
        symbol = st.text_input("Par", value="BTC/USDT")
        timeframe = st.selectbox("Timeframe", ["1m", "5m", "15m", "1h", "4h"], index=1)
        limit = st.slider("Velas", min_value=100, max_value=500, value=300, step=50)
        vol_multiplier = st.slider("Umbral RVOL", 1.0, 4.0, 1.8, 0.1)
        order_amount = st.number_input("Cantidad base para orden", min_value=0.0, value=0.001, step=0.001)
        auto_refresh = st.checkbox("Auto refresh (10s)", value=False)

    if "last_refresh" not in st.session_state:
        st.session_state.last_refresh = 0.0

    # Intentar conectar con credenciales si se han proporcionado.
    # Los datos de mercado (OHLCV) son publicos y no requieren API keys.
    private_exchange: Optional[ccxt.binance] = None
    has_credentials = bool(api_key and api_secret)

    if has_credentials:
        try:
            private_exchange = get_or_create_exchange(api_key, api_secret, testnet)
            st.sidebar.success("✅ Conectado a Binance")
        except Exception as err:
            # Limpiar cache para que el siguiente intento vuelva a conectar
            st.session_state.pop("_exchange_cache_key", None)
            st.session_state.pop("_exchange", None)
            st.sidebar.error(f"❌ Error de conexion: {err}")
            st.error(f"No se pudo conectar con Binance: {err}")
            return
    else:
        st.sidebar.info("ℹ️ Sin credenciales — solo datos publicos")

    # Exchange para datos de mercado (publico si no hay credenciales, privado si las hay)
    try:
        data_exchange = private_exchange if private_exchange is not None else get_or_create_public_exchange()
    except Exception as err:
        st.session_state.pop("_public_exchange", None)
        st.error(f"Error al inicializar conexion publica: {err}")
        return

    config = AnalyzerConfig(symbol=symbol, timeframe=timeframe, limit=limit, vol_multiplier=vol_multiplier)

    c1, c2, c3 = st.columns([1, 1, 2])
    refresh_clicked = c1.button("Actualizar analisis", type="primary")
    buy_clicked = c2.button("Comprar mercado", disabled=not has_credentials)
    sell_clicked = c3.button("Vender mercado", disabled=not has_credentials)

    # Comprobar si corresponde un auto-refresh en este ciclo
    if auto_refresh and time.time() - st.session_state.last_refresh >= 10:
        refresh_clicked = True

    if refresh_clicked:
        try:
            data = fetch_ohlcv(data_exchange, config.symbol, config.timeframe, config.limit)
            data = add_indicators(data)
            signal = generate_signal(data, config.vol_multiplier)
            st.session_state.last_refresh = time.time()
            st.session_state.data = data
            st.session_state.signal = signal
        except Exception as err:
            st.error(f"No se pudo cargar mercado: {err}")

    if "data" in st.session_state:
        data = st.session_state.data
        signal = st.session_state.signal
        last = data.iloc[-1]
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("Precio", f"{last['close']:.4f}")
        m2.metric("RVOL", f"{last['rvol']:.2f}")
        m3.metric("VWAP", f"{last['vwap']:.4f}")
        m4.metric("Senal", signal)
        st.subheader("Precio vs VWAP")
        st.line_chart(data.set_index("timestamp")[["close", "vwap"]])
        st.subheader("Volumen")
        st.bar_chart(data.set_index("timestamp")[["volume"]])

        if buy_clicked and private_exchange is not None:
            ok, msg = create_order(private_exchange, symbol, "buy", order_amount)
            st.success(msg) if ok else st.error(msg)
        if sell_clicked and private_exchange is not None:
            ok, msg = create_order(private_exchange, symbol, "sell", order_amount)
            st.success(msg) if ok else st.error(msg)
    else:
        st.info("Pulsa 'Actualizar analisis' para cargar datos.")

    # Auto-refresh: recheck cada segundo para no bloquear la UI mas de 1 segundo.
    # La actualizacion de datos ocurre cuando se cumplen los 10 s (linea de refresh_clicked arriba).
    if auto_refresh:
        time.sleep(1)
        st.rerun()


if __name__ == "__main__":
    main()
