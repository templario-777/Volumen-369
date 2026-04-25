import time
import json
import ccxt
import pandas as pd
import streamlit as st
import requests
from datetime import datetime, timedelta

# =========================
# CONFIGURACIÓN Y ESTILOS
# =========================
st.set_page_config(
    page_title="🚀 Bot Trading Real 24/7",
    layout="wide",
    page_icon="🚀",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    html, body, .stButton, .stSelectbox, .stTextInput, .stSlider {
        font-size: clamp(14px, 1rem, 18px);
    }
    .metric-card {
        background: white;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        margin-bottom: 12px;
    }
    @media (max-width: 600px) {
        .stMetric {font-size: 0.95rem;}
        h1, h2, h3, .stSidebar, .stButton>button {font-size: 1.2rem !important;}
    }
    .signal-buy {background-color:#d4edda;color:#155724;padding:8px;border-radius:6px;}
    .signal-sell {background-color:#f8d7da;color:#721c24;padding:8px;border-radius:6px;}
    .signal-hold {background-color:#e2e3e5;color:#383d41;padding:8px;border-radius:6px;}
    .coin-card {border-left: 4px solid #007bff; padding:10px; margin:5px 0; background:#f8f9fa;}
    .operacion-abierta {border-left: 5px solid #007bff; background: #e7f3ff; padding:10px; margin:5px 0;}
    .operacion-cerrada {border-left: 5px solid #28a745; background: #d4edda; padding:10px; margin:5px 0;}
</style>
""", unsafe_allow_html=True)

# =========================
# INICIALIZACIÓN DE ESTADO
# =========================
if 'operaciones_activas' not in st.session_state:
    st.session_state.operaciones_activas = []
if 'historial' not in st.session_state:
    st.session_state.historial = []
if 'top_monedas' not in st.session_state:
    st.session_state.top_monedas = []
if 'fecha_actual' not in st.session_state:
    st.session_state.fecha_actual = datetime.now().strftime("%Y-%m-%d")
if 'alertas_enviadas' not in st.session_state:
    st.session_state.alertas_enviadas = []

# =========================
# CONSTANTES
# =========================
TOP_N = 10
SCAN_INTERVAL = 60  # segundos
TP_PCT = 4.0  # Take Profit %
SL_PCT = 2.0  # Stop Loss %

# =========================
# FUNCIONES DE CONEXIÓN
# =========================
@st.cache_resource
def crear_exchange():
    try:
        api_key = st.secrets.get("BINANCE_API_KEY", "")
        api_secret = st.secrets.get("BINANCE_API_SECRET", "")

        if not api_key:
            if 'api_key_ui' in st.session_state:
                api_key = st.session_state.api_key_ui
                api_secret = st.session_state.api_secret_ui
            else:
                st.sidebar.warning("⚠️ Configura tus API Keys en Secrets")
                return None

        exchange = ccxt.binance({
            'apiKey': api_key.strip(),
            'secret': api_secret.strip(),
            'enableRateLimit': True,
            'options': {'defaultType': 'spot'}
        })
        exchange.load_markets()
        return exchange
    except Exception as e:
        st.error(f"❌ Error conectando a Binance: {str(e)}")
        return None

# =========================
# FUNCIONES TÉCNICAS
# =========================
def obtener_ohlcv(exchange, symbol, timeframe='5m', limit=100):
    try:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        return df
    except Exception as e:
        st.error(f"Error obteniendo datos de {symbol}: {str(e)}")
        return pd.DataFrame()

def calcular_indicadores(df):
    if len(df) < 50:
        return df
    df = df.copy()
    df['vwap'] = (df['close'] * df['volume']).cumsum() / df['volume'].cumsum()
    df['vol_ma20'] = df['volume'].rolling(20).mean()
    df['rvol'] = df['volume'] / df['vol_ma20']
    df['sma50'] = df['close'].rolling(50).mean()
    df['sma200'] = df['close'].rolling(200).mean()
    return df.dropna()

def detectar_patron(df):
    if len(df) < 2:
        return "HOLD", 0
    row = df.iloc[-1]
    prev = df.iloc[-2]

    # Condiciones de compra
    alcista = row['sma50'] > row['sma200'] if 'sma50' in df.columns else False
    ruptura_alcista = row['close'] > prev['high']
    vol_explosivo = row['rvol'] > 2.0 if 'rvol' in df.columns else False
    sobre_vwap = row['close'] > row['vwap'] if 'vwap' in df.columns else False

    if alcista and ruptura_alcista and vol_explosivo and sobre_vwap:
        return "BUY", min(100, int(row['rvol'] * 30) if 'rvol' in df.columns else 80)

    # Condiciones de venta
    bajista = row['sma50'] < row['sma200'] if 'sma50' in df.columns else False
    ruptura_bajista = row['close'] < prev['low']
    bajo_vwap = row['close'] < row['vwap'] if 'vwap' in df.columns else False

    if bajista and ruptura_bajista and vol_explosivo and bajo_vwap:
        return "SELL", min(100, int(row['rvol'] * 30) if 'rvol' in df.columns else 80)

    return "HOLD", 0

# =========================
# GESTIÓN DE OPERACIONES REALES
# =========================
def ejecutar_orden_real(exchange, symbol, side, amount_usd):
    try:
        ticker = exchange.fetch_ticker(symbol)
        precio = ticker['last']
        cantidad = amount_usd / precio

        # Obtener precisión del mercado
        market = exchange.market(symbol)
        cantidad = round(cantidad, market['precision']['amount'])

        # Ejecutar orden
        orden = exchange.create_order(symbol, 'market', side, cantidad)

        # Calcular SL y TP
        if side == 'buy':
            sl = precio * (1 - SL_PCT/100)
            tp = precio * (1 + TP_PCT/100)
        else:
            sl = precio * (1 + SL_PCT/100)
            tp = precio * (1 - TP_PCT/100)

        operacion = {
            'symbol': symbol,
            'side': side.upper(),
            'entrada': precio,
            'sl': sl,
            'tp': tp,
            'cantidad': cantidad,
            'timestamp': datetime.now(),
            'status': 'ABIERTA',
            'orden_id': orden['id']
        }
        st.session_state.operaciones_activas.append(operacion)
        return True, precio, sl, tp
    except Exception as e:
        return False, 0, 0, 0

def gestionar_operaciones_abiertas(exchange):
    if not st.session_state.operaciones_activas:
        return

    ops_a_cerrar = []
    for op in st.session_state.operaciones_activas:
        try:
            ticker = exchange.fetch_ticker(op['symbol'])
            precio_actual = ticker['last']

            cerrar = False
            motivo = ""

            if op['side'] == 'BUY':
                if precio_actual >= op['tp']:
                    cerrar = True
                    motivo = "TAKE PROFIT ✅"
                elif precio_actual <= op['sl']:
                    cerrar = True
                    motivo = "STOP LOSS ❌"
            else:  # SELL
                if precio_actual <= op['tp']:
                    cerrar = True
                    motivo = "TAKE PROFIT ✅"
                elif precio_actual >= op['sl']:
                    cerrar = True
                    motivo = "STOP LOSS ❌"

            if cerrar:
                # Cerrar orden
                side_cierre = 'sell' if op['side'] == 'BUY' else 'buy'
                exchange.create_order(op['symbol'], 'market', side_cierre, op['cantidad'])

                # Calcular ganancia
                if op['side'] == 'BUY':
                    ganancia_pct = (precio_actual - op['entrada']) / op['entrada'] * 100
                else:
                    ganancia_pct = (op['entrada'] - precio_actual) / op['entrada'] * 100

                op['cierre'] = precio_actual
                op['motivo'] = motivo
                op['ganancia_pct'] = ganancia_pct
                op['status'] = 'CERRADA'

                st.session_state.operaciones_activas.remove(op)
                st.session_state.historial.insert(0, op)

                # Enviar alerta de cierre
                enviar_alerta_telegram(
                    f"🏁 {motivo}\n{op['symbol']}\n"
                    f"Entrada: {op['entrada']:.4f}\n"
                    f"Cierre: {precio_actual:.4f}\n"
                    f"Ganancia: {ganancia_pct:.2f}%"
                )
        except Exception as e:
            st.warning(f"Error gestionando {op['symbol']}: {str(e)}")

# =========================
# TELEGRAM Y NOTIFICACIONES
# =========================
def enviar_alerta_telegram(mensaje):
    try:
        bot_token = st.secrets.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = st.secrets.get("TELEGRAM_CHAT_ID", "")

        if not bot_token:
            bot_token = st.session_state.get('tg_bot_token_input', "")
        if not chat_id:
            chat_id = st.session_state.get('tg_chat_id_input', "")

        if not bot_token or not chat_id:
            return False

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        payload = {"chat_id": chat_id, "text": mensaje, "parse_mode": "Markdown"}
        r = requests.post(url, json=payload, timeout=10)
        return r.status_code == 200
    except Exception as e:
        st.warning(f"Error enviando a Telegram: {str(e)}")
        return False

# =========================
# INTERFAZ PRINCIPAL
# =========================
def main():
    st.title("🚀 Bot Trading Real Binance 24/7")

    # Sidebar
    with st.sidebar:
        st.header("⚙️ Configuración")

        # Credenciales
        st.subheader("🔐 Binance")
        api_key = st.text_input("API Key", type="password", key="api_key_sb")
        api_secret = st.text_input("API Secret", type="password", key="api_secret_sb")
        st.session_state.api_key_ui = api_key
        st.session_state.api_secret_ui = api_secret

        # Telegram
        st.subheader("📢 Telegram")
        tg_token = st.text_input("Bot Token", type="password", key="tg_token_sb")
        tg_chat = st.text_input("Chat ID", key="tg_chat_sb")
        st.session_state.tg_bot_token_input = tg_token
        st.session_state.tg_chat_id_input = tg_chat

        st.markdown("---")
        st.caption("💡 Las claves sensibles se guardan en Streamlit Secrets")

    # Conexión
    exchange = crear_exchange()
    if not exchange:
        st.stop()

    st.success("✅ Conectado a Binance")

    # Seleccionar monedas
    if st.sidebar.button("🔍 Seleccionar Top 10", type="primary"):
        with st.spinner("Analizando mercado..."):
            try:
                markets = [m['symbol'] for m in exchange.fetch_markets()
                          if m.get('spot') and m.get('active') and m['quote'] == 'USDT']
                st.session_state.top_monedas = markets[:TOP_N]
                st.success(f"✅ Monitoreando {len(markets[:TOP_N])} monedas")
            except Exception as e:
                st.error(f"Error seleccionando monedas: {e}")

    # Mostrar monedas seleccionadas
    if st.session_state.top_monedas:
        st.subheader(f"📋 Monitoreo 24/7 - {len(st.session_state.top_monedas)} monedas")

        # Escaneo en tiempo real
        for i, symbol in enumerate(st.session_state.top_monedas):
            try:
                df = obtener_ohlcv(exchange, symbol)
                if df.empty:
                    continue
                df = calcular_indicadores(df)

                patron, fuerza = detectar_patron(df)

                col1, col2, col3, col4 = st.columns([3, 1, 1, 1])

                with col1:
                    st.markdown(f"""
                    <div class="coin-card">
                        <b>{symbol}</b><br>
                        Precio: {df.iloc[-1]['close']:.6f} |
                        RVOL: {df.iloc[-1]['rvol']:.2f}x<br>
                        Patrón: {patron} | Fuerza: {fuerza}%
                    </div>
                    """, unsafe_allow_html=True)

                with col2:
                    st.metric("Precio", f"{df.iloc[-1]['close']:.6f}")
                with col3:
                    st.metric("RVOL", f"{df.iloc[-1]['rvol']:.2f}x")
                with col4:
                    clase = "signal-buy" if patron == "BUY" else \
                            "signal-sell" if patron == "SELL" else "signal-hold"
                    st.markdown(f'<div class="{clase}">{patron}</div>', unsafe_allow_html=True)

                # Gráfico con Streamlit nativo
                with st.expander(f"📈 Gráfico {symbol}"):
                    chart_data = df[['timestamp', 'close', 'vwap']].set_index('timestamp')
                    st.line_chart(chart_data)

                # Ejecutar si hay señal fuerte
                if patron in ["BUY", "SELL"] and fuerza >= 80:
                    capital = st.sidebar.number_input("USD por operación", 10.0, 1000.0, 50.0, key=f"cap_{symbol}")
                    if st.button(f"Ejecutar {patron}", key=f"btn_{symbol}"):
                        side = 'buy' if patron == "BUY" else 'sell'
                        ok, precio, sl, tp = ejecutar_orden_real(exchange, symbol, side, capital)
                        if ok:
                            st.success(f"✅ Orden ejecutada: {patron} @ {precio:.4f}")
                            # Enviar alerta
                            enviar_alerta_telegram(
                                f"🚨 {patron} EJECUTADA\n{symbol}\n"
                                f"Precio: {precio:.4f}\n"
                                f"SL: {sl:.4f} | TP: {tp:.4f}"
                            )
            except Exception as e:
                st.error(f"Error con {symbol}: {str(e)}")

        # Gestionar operaciones abiertas
        gestionar_operaciones_abiertas(exchange)

    # Panel de operaciones activas
    if st.session_state.operaciones_activas:
        st.subheader("💼 Operaciones Abiertas")
        for op in st.session_state.operaciones_activas:
            st.markdown(f"""
            <div class="operacion-abierta">
                <b>{op['symbol']}</b> | {op['side']}<br>
                Entrada: {op['entrada']:.4f} |
                SL: {op['sl']:.4f} |
                TP: {op['tp']:.4f}<br>
                Estado: {op['status']}
            </div>
            """, unsafe_allow_html=True)

    # Historial
    if st.session_state.historial:
        st.subheader("📊 Historial de Operaciones")
        for hist in st.session_state.historial[:10]:
            color = "operacion-cerrada" if hist.get('ganancia_pct', 0) > 0 else "signal-sell"
            st.markdown(f"""
            <div class="{color}">
                <b>{hist['symbol']}</b> | {hist['motivo']}<br>
                Entrada: {hist['entrada']:.4f} | Cierre: {hist['cierre']:.4f}<br>
                Ganancia: {hist.get('ganancia_pct', 0):.2f}%
            </div>
            """, unsafe_allow_html=True)

    # Auto-refresh para monitoreo continuo
    if st.session_state.top_monedas:
        time.sleep(1)
        st.experimental_rerun()

if __name__ == "__main__":
    main()