import time
from dataclasses import dataclass
from typing import Tuple

import ccxt
import pandas as pd
import streamlit as st


@dataclass
class AnalyzerConfig:
    symbol: str = "BTC/USDT"
    timeframe: str = "5m"
    limit: int = 300
    vol_multiplier: float = 1.8


def build_exchange(api_key: str = "", api_secret: str = "", testnet: bool = False) -> ccxt.binance:
    exchange = ccxt.binance(
        {
            "apiKey": api_key.strip() if api_key else "",
            "secret": api_secret.strip() if api_secret else "",
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
    )
    if testnet:
        exchange.set_sandbox_mode(True)
    return exchange


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
        st.header("Conexion Binance (opcional para datos)")
        api_key = st.text_input("API Key", type="password")
        api_secret = st.text_input("API Secret", type="password")
        testnet = st.checkbox("Usar Testnet", value=False)
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

    c1, c2, c3 = st.columns([1, 1, 2])
    refresh_clicked = c1.button("Actualizar analisis", type="primary")
    buy_clicked = c2.button("Comprar mercado")
    sell_clicked = c3.button("Vender mercado")

    # Auto-refresh: trigger rerun when interval has passed
    if auto_refresh and time.time() - st.session_state.last_refresh >= 10:
        refresh_clicked = True

    config = AnalyzerConfig(symbol=symbol, timeframe=timeframe, limit=limit, vol_multiplier=vol_multiplier)

    # Build a public exchange for market data (no API keys needed for OHLCV)
    public_exchange = build_exchange()

    if refresh_clicked:
        try:
            data = fetch_ohlcv(public_exchange, config.symbol, config.timeframe, config.limit)
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

        if buy_clicked or sell_clicked:
            if not api_key or not api_secret:
                st.warning("Ingresa API Key y API Secret para ejecutar ordenes.")
            else:
                try:
                    auth_exchange = build_exchange(api_key, api_secret, testnet)
                    auth_exchange.load_markets()
                    if buy_clicked:
                        ok, msg = create_order(auth_exchange, symbol, "buy", order_amount)
                        st.success(msg) if ok else st.error(msg)
                    if sell_clicked:
                        ok, msg = create_order(auth_exchange, symbol, "sell", order_amount)
                        st.success(msg) if ok else st.error(msg)
                except Exception as err:
                    st.error(f"Error de conexion con Binance: {err}")
    else:
        st.info("Pulsa 'Actualizar analisis' para cargar datos.")

    # Schedule next rerun for auto-refresh
    if auto_refresh:
        time.sleep(max(0, 10 - (time.time() - st.session_state.last_refresh)))
        st.rerun()


if __name__ == "__main__":
    main()
