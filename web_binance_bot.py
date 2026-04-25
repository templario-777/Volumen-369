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
    .signal-buy {background:#d4edda;color:#155724;padding:8px;border-radius:6px;}
    .signal-sell {background:#f8d7da;color:#721c24;padding:8px;border-radius:6px;}
    .signal-hold {background:#e2e3e5;color:#383d41;padding:8px;border-radius:6px;}
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
if 'worker_url' not in st.session_state:
    st.session_state.worker_url = ""

# =========================
# CONSTANTES
# =========================
TOP_N = 10
TP_PCT = 4.0
SL_PCT = 2.0

# =========================
# FUNCIÓN: CREAR CLOUDFLARE WORKER AUTOMÁTICO
# =========================
def crear_cloudflare_worker():
    """Crea el Worker usando la API de Cloudflare"""
    try:
        api_token = st.secrets.get("CLOUDFLARE_API_TOKEN", "")
        account_id = st.secrets.get("CLOUDFLARE_ACCOUNT_ID", "")

        if not api_token or not account_id:
            st.sidebar.error("❌ Faltan CLOUDFLARE_API_TOKEN o CLOUDFLARE_ACCOUNT_ID en Secrets")
            return None

        worker_script = """
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");

    if (!target) {
      return new Response("Error: Falta el parámetro ?target=", { 
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    try {
      const targetUrl = new URL(target);
      const newSearch = new URLSearchParams(url.search);
      newSearch.delete("target");
      
      targetUrl.pathname = url.pathname === "/" ? targetUrl.pathname : url.pathname;
      targetUrl.search = newSearch.toString();

      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cf-connecting-ip");
      headers.delete("cf-worker");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");

      const init = {
        method: request.method,
        headers,
        redirect: "follow",
      };

      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }

      const response = await fetch(targetUrl.toString(), init);
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });

    } catch (e) {
      return new Response("Error de Proxy: " + e.message, { status: 500 });
    }
  }
}
"""

        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/binance-proxy"
        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/javascript"
        }

        with st.spinner("Creando Cloudflare Worker..."):
            resp = requests.put(url, headers=headers, data=worker_script, timeout=30)

        if resp.status_code in [200, 201]:
            worker_url = f"https://binance-proxy.{account_id}.workers.dev"
            st.session_state.worker_url = worker_url
            st.sidebar.success(f"✅ Worker creado: {worker_url}")
            return worker_url
        else:
            st.sidebar.error(f"❌ Error creando Worker: {resp.status_code} - {resp.text[:200]}")
            return None

    except Exception as e:
        st.sidebar.error(f"❌ Error: {str(e)}")
        return None

# =========================
# FUNCIÓN DE CONEXIÓN (CON WORKER)
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

        config = {
            'apiKey': api_key.strip(),
            'secret': api_secret.strip(),
            'enableRateLimit': True,
            'options': {'defaultType': 'spot'},
            'timeout': 30000,
        }

        # Usar Cloudflare Worker como proxy
        worker_url = st.secrets.get("CLOUDFLARE_WORKER_URL", "")
        if not worker_url:
            worker_url = st.session_state.get('worker_url', "")

        if worker_url:
            worker_url = worker_url.rstrip('/')
            # Para ccxt, la forma más limpia es usar proxyUrl que concatena con la URL final
            config['proxyUrl'] = f"{worker_url}?target="
            st.sidebar.success(f"🔗 Cloudflare Worker activo")
        else:
            st.sidebar.warning("⚠️ No hay Worker configurado. Usa el botón 'Crear Worker' en la barra lateral.")
            return None

        exchange = ccxt.binance(config)

        # Verificar conexión
        for intento in range(3):
            try:
                exchange.load_markets()
                return exchange
            except Exception as e:
                if intento < 2:
                    time.sleep(2 ** intento)
                else:
                    raise e

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
        st.error(f"Error con {symbol}: {str(e)}")
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

    alcista = row['sma50'] > row['sma200'] if 'sma50' in df.columns else False
    bajista = row['sma50'] < row['sma200'] if 'sma50' in df.columns else False

    ruptura_alcista = row['close'] > prev['high'] and row['volume'] > prev['volume'] * 1.5
    ruptura_bajista = row['close'] < prev['low'] and row['volume'] > prev['volume'] * 1.5

    vol_explosivo = row['rvol'] > 2.0 if 'rvol' in df.columns else False

    if alcista and ruptura_alcista and vol_explosivo:
        return "BUY", min(100, int(row['rvol'] * 30))
    if bajista and ruptura_bajista and vol_explosivo:
        return "SELL", min(100, int(row['rvol'] * 30))

    return "HOLD", 0

# =========================
# GESTIÓN DE OPERACIONES REALES
# =========================
def ejecutar_orden_real(exchange, symbol, side, amount_usd):
    try:
        ticker = exchange.fetch_ticker(symbol)
        precio = ticker['last']
        cantidad = amount_usd / precio

        market = exchange.market(symbol)
        cantidad = round(cantidad, market['precision']['amount'])

        orden = exchange.create_order(symbol, 'market', side, cantidad)

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
            'status': 'ABIERTA'
        }
        st.session_state.operaciones_activas.append(operacion)
        return True, precio, sl, tp
    except Exception as e:
        st.error(f"❌ Error ejecutando orden: {str(e)}")
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
                    motivo = "TAKE PROFIT ✅"
                    cerrar = True
                elif precio_actual <= op['sl']:
                    motivo = "STOP LOSS ❌"
                    cerrar = True
            else:
                if precio_actual <= op['tp']:
                    motivo = "TAKE PROFIT ✅"
                    cerrar = True
                elif precio_actual >= op['sl']:
                    motivo = "STOP LOSS ❌"
                    cerrar = True

            if cerrar:
                ops_a_cerrar.append((op, precio_actual, motivo))
        except Exception as e:
            st.warning(f"Error gestionando {op['symbol']}: {str(e)}")

    for op, precio, motivo in ops_a_cerrar:
        try:
            side_cierre = 'sell' if op['side'] == 'BUY' else 'buy'
            exchange.create_order(op['symbol'], 'market', side_cierre, op['cantidad'])

            ganancia_pct = ((precio - op['entrada']) / op['entrada'] * 100) if op['side']=='BUY' else ((op['entrada'] - precio) / op['entrada'] * 100)

            op['cierre'] = precio
            op['motivo'] = motivo
            op['ganancia_pct'] = ganancia_pct
            op['status'] = 'CERRADA'

            st.session_state.operaciones_activas.remove(op)
            st.session_state.historial.insert(0, op)

            # Enviar alerta
            enviar_alerta_telegram(
                f"🏁 *{motivo} {op['symbol']}*\n"
                f"Entrada: {op['entrada']:.4f}\n"
                f"Cierre: {precio:.4f}\n"
                f"Ganancia: {ganancia_pct:.2f}%"
            )
        except Exception as e:
            st.error(f"Error cerrando {op['symbol']}: {str(e)}")

# =========================
# TELEGRAM
# =========================
def enviar_alerta_telegram(mensaje):
    try:
        bot_token = st.secrets.get("TELEGRAM_BOT_TOKEN", "")
        chat_id = st.secrets.get("TELEGRAM_CHAT_ID", "")

        if not bot_token:
            bot_token = st.session_state.get('tg_bot_input', "")
        if not chat_id:
            chat_id = st.session_state.get('tg_chat_input', "")

        if not bot_token or not chat_id:
            return False

        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        
        # Usar el worker como proxy para Telegram también
        worker_url = st.secrets.get("CLOUDFLARE_WORKER_URL", st.session_state.get('worker_url', ""))
        if worker_url:
            worker_url = worker_url.rstrip('/')
            url = f"{worker_url}?target=https://api.telegram.org/bot{bot_token}/sendMessage"

        payload = {"chat_id": chat_id, "text": mensaje, "parse_mode": "Markdown"}
        r = requests.post(url, json=payload, timeout=10)
        return r.status_code == 200
    except Exception as e:
        st.warning(f"Error Telegram: {str(e)}")
        return False

# =========================
# INTERFAZ PRINCIPAL
# =========================
def main():
    st.title("🚀 Bot Trading Real Binance 24/7")

    # Sidebar
    with st.sidebar:
        st.header("⚙️ Configuración")

        # Cloudflare Worker (ÚNICO)
        st.subheader("🔗 Cloudflare Worker")
        worker_url_secret = st.secrets.get("CLOUDFLARE_WORKER_URL", "")
        worker_url_actual = st.session_state.get('worker_url', worker_url_secret)
        worker_url_input = st.text_input(
            "Worker URL",
            value=worker_url_actual,
            placeholder="https://binance-proxy.tu-cuenta.workers.dev",
            key="worker_url_sb"
        ).strip()
        if worker_url_input:
            st.session_state.worker_url = worker_url_input

        if st.button("🔧 Crear Worker", type="primary"):
            resultado = crear_cloudflare_worker()
            if resultado:
                st.success(f"✅ Worker listo: {resultado}")

        worker_status = st.session_state.get('worker_url', worker_url_secret)
        if worker_status:
            st.success(f"🔗 Worker: {worker_status[:40]}...")
        else:
            st.warning("⚠️ Pega tu Worker URL o crea uno con el botón")

        st.markdown("---")

        # Binance
        st.subheader("🔐 Binance")
        api_key_ui = st.text_input("API Key", type="password", key="api_key_sb")
        api_secret_ui = st.text_input("API Secret", type="password", key="api_secret_sb")
        st.session_state.api_key_ui = api_key_ui
        st.session_state.api_secret_ui = api_secret_ui

        # Telegram
        st.subheader("📢 Telegram")
        tg_bot = st.text_input("Bot Token", type="password", key="tg_bot_sb")
        tg_chat = st.text_input("Chat ID", key="tg_chat_sb")
        st.session_state.tg_bot_input = tg_bot
        st.session_state.tg_chat_input = tg_chat

        st.markdown("---")
        capital_usd = st.number_input("USD por operación", 10.0, 1000.0, 50.0)

    # Conectar
    exchange = crear_exchange()
    if not exchange:
        st.stop()

    st.success("✅ Conectado a Binance vía Cloudflare Worker")

    # Gestionar operaciones abiertas
    gestionar_operaciones_abiertas(exchange)

    # Seleccionar monedas
    if st.sidebar.button("🔍 Seleccionar Top 10", type="primary"):
        with st.spinner("Analizando mercado..."):
            try:
                markets = [m['symbol'] for m in exchange.fetch_markets()
                           if m.get('spot') and m.get('active') and m['quote'] == 'USDT']
                st.session_state.top_monedas = markets[:TOP_N]
                st.success(f"✅ Monitoreando {len(markets[:TOP_N])} monedas")
            except Exception as e:
                st.error(f"Error: {str(e)}")

    # Mostrar monedas
    if st.session_state.top_monedas:
        st.subheader(f"📋 Monitoreo 24/7 - {len(st.session_state.top_monedas)} monedas")

        for symbol in st.session_state.top_monedas:
            try:
                df = obtener_ohlcv(exchange, symbol)
                if df.empty:
                    continue
                df = calcular_indicadores(df)

                patron, fuerza = detectar_patron(df)

                col1, col2, col3, col4 = st.columns([2, 1, 1, 1])

                with col1:
                    st.markdown(f"""
                    <div class="coin-card">
                        <b>{symbol}</b><br>
                        Precio: {df.iloc[-1]['close']:.6f} |
                        RVOL: {df.iloc[-1]['rvol']:.2f}x<br>
                        Patrón: {patron} | Fuerza: {fuerza}%
                    </div>
                    """, unsafe_allow_html=True)
                    # Añadir gráfico pequeño
                    st.line_chart(df['close'].tail(20), height=100, use_container_width=True)

                with col2:
                    st.metric("Precio", f"{df.iloc[-1]['close']:.6f}")
                with col3:
                    st.metric("RVOL", f"{df.iloc[-1]['rvol']:.2f}x")
                with col4:
                    clase = "signal-buy" if patron == "BUY" else \
                             "signal-sell" if patron == "SELL" else "signal-hold"
                    st.markdown(f'<div class="{clase}">{patron}</div>', unsafe_allow_html=True)

                # Ejecutar si hay señal fuerte
                if patron in ["BUY", "SELL"] and fuerza >= 80:
                    side = 'buy' if patron == "BUY" else 'sell'
                    if st.button(f"Ejecutar {patron}", key=f"btn_{symbol}"):
                        ok, precio, sl, tp = ejecutar_orden_real(exchange, symbol, side, capital_usd)
                        if ok:
                            st.success(f"✅ Orden ejecutada: {patron} @ {precio:.4f}")
                            enviar_alerta_telegram(
                                f"🚨 *{patron} EJECUTADA*\n"
                                f"{symbol}\n"
                                f"Entrada: {precio:.4f}\n"
                                f"SL: {sl:.4f} | TP: {tp:.4f}"
                            )

            except Exception as e:
                st.error(f"Error con {symbol}: {str(e)}")

    # Operaciones activas
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
        st.subheader("📊 Historial")
        for hist in st.session_state.historial[:10]:
            color = "operacion-cerrada" if hist.get('ganancia_pct', 0) > 0 else "signal-sell"
            st.markdown(f"""
            <div class="{color}">
                <b>{hist['symbol']}</b> | {hist['motivo']}<br>
                Entrada: {hist['entrada']:.4f} |
                Cierre: {hist.get('cierre', 0):.4f}<br>
                <span style="color:{'green' if hist.get('ganancia_pct', 0) > 0 else 'red'}">
                Ganancia: {hist.get('ganancia_pct', 0):.2f}%
                </span>
            </div>
            """, unsafe_allow_html=True)

    # Auto-refresh
    if st.session_state.top_monedas:
        time.sleep(1)
        st.experimental_rerun()

if __name__ == "__main__":
    main()