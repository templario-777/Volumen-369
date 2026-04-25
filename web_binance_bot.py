import time
import ccxt
import pandas as pd
import streamlit as st
import requests
from datetime import datetime

# =========================
# CONFIGURACIÓN Y ESTILOS
# =========================
st.set_page_config(
    page_title="🚀 Volumen-369 Bot Dashboard",
    layout="wide",
    page_icon="🚀"
)

st.markdown("""
<style>
    .metric-card { background: #f8f9fa; padding: 15px; border-radius: 10px; border-left: 5px solid #007bff; }
    .signal-buy { background: #d4edda; color: #155724; padding: 10px; border-radius: 5px; font-weight: bold; }
    .signal-sell { background: #f8d7da; color: #721c24; padding: 10px; border-radius: 5px; font-weight: bold; }
    .stButton>button { width: 100%; border-radius: 20px; }
</style>
""", unsafe_allow_html=True)

# =========================
# INICIALIZACIÓN
# =========================
if 'top_monedas' not in st.session_state:
    st.session_state.top_monedas = []

# =========================
# CONEXIÓN (VÍA WORKER)
# =========================
def crear_exchange():
    worker_url = st.secrets.get("CLOUDFLARE_WORKER_URL", "")
    if not worker_url or "tu-cuenta" in worker_url:
        st.sidebar.warning("⚠️ Configura 'CLOUDFLARE_WORKER_URL' en Secrets")
        return None
    
    config = {
        'enableRateLimit': True,
        'proxies': {
            'http': f"{worker_url}?target=https://api.binance.com",
            'https': f"{worker_url}?target=https://api.binance.com",
        }
    }
    return ccxt.binance(config)

def obtener_datos(exchange, symbol):
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe='5m', limit=100)
        df = pd.DataFrame(ohlcv, columns=['ts', 'open', 'high', 'low', 'close', 'vol'])
        df['ts'] = pd.to_datetime(df['ts'], unit='ms')
        # Indicadores simples
        df['sma50'] = df['close'].rolling(50).mean()
        df['sma200'] = df['close'].rolling(200).mean()
        df['vol_ma'] = df['vol'].rolling(20).mean()
        df['rvol'] = df['vol'] / df['vol_ma']
        return df.dropna()
    except:
        return pd.DataFrame()

# =========================
# INTERFAZ
# =========================
def main():
    st.title("🚀 Volumen-369 Bot Dashboard")
    
    with st.sidebar:
        st.header("⚙️ Configuración")
        st.info("Este Dashboard usa tu Cloudflare Worker como puente.")
        if st.button("🔍 Cargar Top 10 Monedas", type="primary"):
            exchange = crear_exchange()
            if exchange:
                markets = exchange.fetch_markets()
                st.session_state.top_monedas = [m['symbol'] for m in markets if m['quote'] == 'USDT'][:10]

    exchange = crear_exchange()
    if not exchange: st.stop()

    if not st.session_state.top_monedas:
        st.info("Haz clic en 'Cargar Top 10 Monedas' en la barra lateral para empezar.")
    else:
        for symbol in st.session_state.top_monedas:
            df = obtener_datos(exchange, symbol)
            if df.empty: continue
            
            row = df.iloc[-1]
            col1, col2, col3 = st.columns([2, 2, 1])
            
            with col1:
                st.subheader(symbol)
                st.line_chart(df.set_index('ts')['close'])
            
            with col2:
                st.write(f"**Precio:** {row['close']:.4f}")
                st.write(f"**RVOL:** {row['rvol']:.2f}x")
                st.write(f"**SMA 50/200:** {'✅ Alcista' if row['sma50'] > row['sma200'] else '❌ Bajista'}")
            
            with col3:
                # Lógica de señal
                if row['sma50'] > row['sma200'] and row['rvol'] > 2.0:
                    st.markdown('<div class="signal-buy">COMPRA 🚀</div>', unsafe_allow_html=True)
                elif row['sma50'] < row['sma200'] and row['rvol'] > 2.0:
                    st.markdown('<div class="signal-sell">VENTA 📉</div>', unsafe_allow_html=True)
                else:
                    st.write("Esperando...")
            st.divider()

    time.sleep(5)
    st.rerun()

if __name__ == "__main__":
    main()
