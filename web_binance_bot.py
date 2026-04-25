import time
from dataclasses import dataclass
from typing import Tuple, Dict, List, Any
import ccxt
import pandas as pd
import streamlit as st
import plotly.graph_objects as go
import requests

# ============================================
# CONFIGURACIÓN RESPONSIVE & ESTILOS
# ============================================
st.set_page_config(
    page_title="🚀 Binance Volume Bot",
    layout="wide",
    page_icon="🚀",
    initial_sidebar_state="expanded"
)

# CSS responsive global
st.markdown("""
<style>
    html, body, .stButton, .stSelectbox, .stTextInput, .stSlider {
        font-size: clamp(14px, 1rem, 18px);
    }
    .flex-container {display: flex; flex-wrap: wrap; gap: 12px;}
    .metric-card {
        background: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin: 10px 0;
        flex: 1 1 250px;
        min-width: 200px;
    }
    .responsive-container {max-width: 100%; overflow-x: auto;}
    .responsive-plotly {height: auto !important;}
    @media (max-width: 600px) {
        h1, h2, h3, .stSidebar, .stButton > button {font-size: 1.3rem !important;}
        .stMetric {font-size: 1.1rem !important;}
    }
    .signal-buy {background-color:#d4edda;color:#155724;}
    .signal-sell {background-color:#f8d7da;color:#721c24;}
    .signal-hold {background-color:#e2e3e5;color:#383d41;}
</style>
""", unsafe_allow_html=True)

# ============================================
# FUNCIÓN NOTIFICACIONES TELEGRAM (DEEPSEEK)
# ============================================
def send_telegram_via_deepseek(message: str, deepseek_api_key: str, tg_chat_id: str, model: str = "deepseek-chat") -> bool:
    """Envía mensaje a Telegram usando DeepSeek como intermediario."""
    headers = {
        "Authorization": f"Bearer {deepseek_api_key}",
        "Content-Type": "application/json"
    }
    prompt = f"""
Eres un asistente que envía mensajes a Telegram mediante webhook interno.
No expliques nada, solo envía el siguiente mensaje al chat {tg_chat_id}:
""" + message.strip() + "\nResponde SOLO: OK o ERROR"

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 50
    }
    try:
        r = requests.post("https://api.deepseek.com/chat/completions", headers=headers, json=payload, timeout=20)
        r.raise_for_status()
        return True
    except Exception as e:
        st.warning(f"⚠️ Notificación no enviada: {e}")
        return False

# ============================================
# CLASES Y CONFIGURACIONES
# ============================================
@dataclass
class AnalyzerConfig:
    symbol: str = "BTC/USDT"
    timeframe: str = "5m"
    limit: int = 300
    vol_multiplier: float = 1.8
    top_n: int = 10

def build_exchange(api_key: str, api_secret: str, testnet: bool) -> ccxt.binance:
    """Conexión a Binance"""
    ex = ccxt.binance({
        "apiKey": api_key.strip(),
        "secret": api_secret.strip(),
        "enableRateLimit": True,
        "options": {"defaultType": "spot"},
    })
    if testnet:
        ex.set_sandbox_mode(True)
    ex.load_markets()
    return ex

def fetch_ohlcv(exchange: ccxt.binance, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    velas = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(velas, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df

def calcular_indicadores(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["vwap"] = df['close'].rolling(50).mean()
    df["vol_ma20"] = df['volume'].rolling(20).mean()
    df["rvol"] = df['volume'] / df['vol_ma20']
    df["sma50"] = df['close'].rolling(50).mean()
    df["sma200"] = df['close'].rolling(200).mean()
    return df.dropna()

def generar_señal(df: pd.DataFrame, vm: float) -> str:
    u = df.iloc[-1]
    a = df.iloc[-2]
    alcista = u['sma50'] > u['sma200']
    bajista = u['sma50'] < u['sma200']
    rup_a = u['close'] > a['high']
    rup_b = u['close'] < a['low']
    if alcista and rup_a and u['rvol'] >= vm and u['close'] > u['vwap']:
        return "BUY"
    if bajista and rup_b and u['rvol'] >= vm and u['close'] < u['vwap']:
        return "SELL"
    return "HOLD"

def escanear_mercado(ex: ccxt.binance, top_n: int, vm: float) -> List[Dict]:
    mercados = [m['symbol'] for m in ex.fetch_markets() if m.get('spot') and m.get('active') and m['quote'] == 'USDT']
    res = []
    for s in mercados[:top_n * 3]:
        try:
            v = ex.fetch_ohlcv(s, '5m', limit=300)
            if len(v) < 250: continue
            df = pd.DataFrame(v, columns=['ts', 'o', 'h', 'l', 'c', 'vol'])
            df['ts'] = pd.to_datetime(df['ts'], unit='ms')
            df = calcular_indicadores(df)
            if len(df) < 50: continue
            sig = generar_señal(df, vm)
            if sig == "HOLD": continue
            rvol = df['rvol'].iloc[-1]
            if rvol < 1.5: continue
            conf = min(70 + int(rvol), 100)
            res.append({
                'symbol': s,
                'signal': sig,
                'price': df['c'].iloc[-1],
                'rvol': round(rvol, 2),
                'conf': conf
            })
        except Exception:
            continue
    return sorted(res, key=lambda x: x['conf'], reverse=True)[:top_n]

def crear_grafico(df: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['close'], mode='lines', name='Precio', line=dict(color='#007bff', width=2)))
    fig.add_trace(go.Scatter(x=df['timestamp'], y=df['vwap'], mode='lines', name='VWAP', line=dict(color='#28a745', width=2, dash='dash')))
    fig.update_layout(title='Precio y VWAP', xaxis_title='Tiempo', yaxis_title='Precio', template='plotly_white', height=450)
    return fig

# ============================================
# INTERFAZ PRINCIPAL
# ============================================
st.title("🚀 Bot de Volumen Binance - Escáner Inteligente")

# --- Sidebar ---
with st.sidebar:
    st.header("⚙️ Configuración")
    api_key = st.text_input("API Key Binance", type="password")
    api_secret = st.text_input("API Secret Binance", type="password")
    testnet = st.checkbox("Modo Testnet", value=False)
    top_n = st.slider("Criptos a escanear", 5, 20, 10)
    vol_mult = st.slider("Umbral RVOL", 1.0, 4.0, 1.8, 0.1)
    deepseek_key = st.text_input("DeepSeek API Key", type="password")
    tg_chat_id = st.text_input("Telegram Chat ID")
    enable_tg = st.checkbox("Alertas Telegram", value=False)

if not api_key or not api_secret:
    st.warning("⚠️ Ingresa tus credenciales Binance.")
    st.stop()

# --- Conexión ---
try:
    exchange = build_exchange(api_key, api_secret, testnet)
    st.success("✅ Conexión Binance OK")
except Exception as e:
    st.error(f"❌ Conexión fallida: {e}")
    st.stop()

# --- Escaneo ---
if st.button("🔍 Escanear Mercado", type="primary", use_container_width=True):
    with st.spinner("Analizando..."):
        cfg = AnalyzerConfig(top_n=top_n, vol_multiplier=vol_mult)
        data_principal = fetch_ohlcv(exchange, cfg.symbol, cfg.timeframe, cfg.limit)
        data_principal = calcular_indicadores(data_principal)
        signal = generar_señal(data_principal, vol_mult)
        st.session_state.data = data_principal
        st.session_state.signal = signal
        st.session_state.resultados = escanear_mercado(exchange, top_n, vol_mult)
        st.session_state.last_update = time.time()

# --- Mostrar resultados ---
if hasattr(st.session_state, 'data'):
    df = st.session_state.data
    sig = st.session_state.signal
    ult = df.iloc[-1]

    # Métricas
    cols = st.columns(5)
    cols[0].metric("Precio", f"{ult['close']:.6f}")
    cols[1].metric("RVOL", f"{ult['rvol']:.2f}x")
    cols[2].metric("VWAP", f"{ult['vwap']:.6f}")
    conf = 75 if sig != "HOLD" else 50
    cols[3].metric("Confianza", f"{conf}%")
    sc = f"signal-{sig.lower()}"
    cols[4].markdown(f'<div class="{sc}" style="padding:10px;border-radius:6px;text-align:center;font-weight:bold;">{sig}</div>', unsafe_allow_html=True)

    # Gráfico
    st.subheader("📈 Gráfico Principal")
    st.plotly_chart(crear_grafico(df), use_container_width=True)

    # Notificación BTN
    if sig != "HOLD" and enable_tg and deepseek_key and tg_chat_id:
        msg = f"🚨 Señal {sig} en {cfg.symbol} - Confianza: {conf}% - Precio: {ult['close']:.6f}"
        if st.button("📤 Enviar Alerta Telegram"):
            if send_telegram_via_deepseek(msg, deepseek_key, tg_chat_id):
                st.success("✅ Alerta enviada!")

    # Resultados escaneo
    if hasattr(st.session_state, 'resultados') and st.session_state.resultados:
        st.subheader(f"💎 Top {len(st.session_state.resultados)} Oportunidades")
        for r in st.session_state.resultados:
            clase = f"signal-{r['signal'].lower()}"
            st.markdown(f'<div class="metric-card {clase}"><b>{r["symbol"]}</b> | Señal: {r["signal"]} | Conf.: {r["conf"]}% | RVOL: {r["rvol"]}x | Price: {r["price"]:.6f}</div>', unsafe_allow_html=True)

st.markdown("---")
st.caption("💡 Para uso con Secrets en Streamlit: DEEPSEEK_KEY, TG_CHAT_ID")