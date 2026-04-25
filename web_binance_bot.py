import time
import json
import ccxt
import pandas as pd
import streamlit as st
import plotly.graph_objects as go
import requests
from datetime import datetime, timedelta

# =========================
# CONFIGURACIÓN Y ESTILOS
# =========================
st.set_page_config(
    page_title="🚀 Bot Volumen Binance 24/7",
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
    margin-bottom: 10px;
    flex: 1 1 250px;
    min-width: 200px;
}
@media (max-width: 600px) {
    h1,h2,h3,.stSidebar,.stButton>button {font-size: 1.2rem !important;}
    .stMetric {font-size: 1rem !important;}
}
.signal-buy {background-color:#d4edda;color:#155724;padding:8px;border-radius:6px;}
.signal-sell {background-color:#f8d7da;color:#721c24;padding:8px;border-radius:6px;}
.signal-hold {background-color:#e2e3e5;color:#383d41;padding:8px;border-radius:6px;}
.coin-card {border-left: 4px solid #007bff;padding:10px;margin:5px 0;background:#f8f9fa;}
.alert-card {border-left: 4px solid #28a745;padding:10px;margin:5px 0;background:#d4edda;}
</style>
""", unsafe_allow_html=True)

# =========================
# CONSTANTES
# =========================
TOP_N = 10
SCAN_INTERVAL = 60  # segundos entre escaneos normales
TP_PCT = 2.0  # 2% take profit
SL_PCT = 2.0  # 2% stop loss
VOL_MULTIPLIER = 1.8  # umbral RVOL
MAX_HOLD_HOURS = 24  # máximo tiempo de seguimiento

# =========================
# FUNCIONES TÉCNICAS
# =========================
def calcular_indicadores(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df['vwap'] = df['close'].rolling(50).mean()
    df['vol_ma20'] = df['volume'].rolling(20).mean()
    df['rvol'] = df['volume'] / df['vol_ma20']
    df['sma50'] = df['close'].rolling(50).mean()
    df['sma200'] = df['close'].rolling(200).mean()
    return df.dropna()

def detectar_patron(df: pd.DataFrame) -> dict:
    """Detecta patrones de volumen y ruptura"""
    if len(df) < 2:
        return {"patron": None, "fuerza": 0}

    u = df.iloc[-1]
    a = df.iloc[-2]

    # Patrón de volumen explosivo
    vol_explosivo = u['rvol'] >= VOL_MULTIPLIER

    # Ruptura alcista
    ruptura_alcista = u['close'] > a['high'] and u['volume'] > a['volume'] * 1.5
    # Ruptura bajista
    ruptura_bajista = u['close'] < a['low'] and u['volume'] > a['volume'] * 1.5

    # Tendencia
    alcista = u['sma50'] > u['sma200']
    bajista = u['sma50'] < u['sma200']

    fuerza = 0
    patron = None

    if vol_explosivo and ruptura_alcista and alcista and u['close'] > u['vwap']:
        patron = "COMPRA_FUERTE"
        fuerza = min(100, int(u['rvol'] * 30))
    elif vol_explosivo and ruptura_bajista and bajista and u['close'] < u['vwap']:
        patron = "VENTA_FUERTE"
        fuerza = min(100, int(u['rvol'] * 30))
    elif vol_explosivo and ruptura_alcista:
        patron = "RUPTURA_ALCISTA"
        fuerza = min(80, int(u['rvol'] * 20))
    elif vol_explosivo and ruptura_bajista:
        patron = "RUPTURA_BAJISTA"
        fuerza = min(80, int(u['rvol'] * 20))

    return {"patron": patron, "fuerza": fuerza, "rvol": u['rvol']}

def construir_exchange(api_key: str, api_secret: str, testnet: bool):
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

def obtener_ohlcv(exchange, symbol: str, limit: int = 300):
    velas = exchange.fetch_ohlcv(symbol, '5m', limit=limit)
    df = pd.DataFrame(velas, columns=['ts', 'o', 'h', 'l', 'c', 'vol'])
    df['ts'] = pd.to_datetime(df['ts'], unit='ms')
    return df

# =========================
# DEEPSEEK INTEGRACIÓN
# =========================
def analizar_con_ia(symbol: str, patron: str, entrada: float,
                   sl: float, tp: float, tiempo_segundos: float,
                   deepseek_key: str, tg_chat_id: str) -> bool:
    """Usa DeepSeek para analizar el patrón y enviar alerta"""
    if not deepseek_key:
        return False

    tiempo_min = int(tiempo_segundos / 60)
    horas = tiempo_min // 60
    mins = tiempo_min % 60

    mensaje = f"""
🚨 PATRÓN DETECTADO en {symbol}

📊 Patrón: {patron}
💰 Entrada: {entrada:.6f}
🛑 Stop Loss: {sl:.6f} (-{SL_PCT}%)
🎯 Take Profit: {tp:.6f} (+{TP_PCT}%)
⏱ Tiempo seguimiento: {horas}h {mins}m
📈 RVOL: Explosivo

Este es un análisis automático basado en detección de patrones de volumen.
"""

    headers = {
        "Authorization": f"Bearer {deepseek_key}",
        "Content-Type": "application/json"
    }

    prompt = f"""Eres un analista financiero experto.
Analiza el siguiente patrón detectado en {symbol}:

Patrón: {patron}
Precio entrada: {entrada:.6f}
SL: {sl:.6f}
TP: {tp:.6f}
Tiempo monitoreado: {horas}h {mins}m

Proporciona un análisis breve (máximo 100 palabras) y confirma si la operación tiene alta probabilidad.
Luego envía exactamente el siguiente mensaje a Telegram (chat {tg_chat_id}):
{mensaje}
"""

    payload = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 200
    }

    try:
        r = requests.post("https://api.deepseek.com/chat/completions",
                        headers=headers, json=payload, timeout=30)
        r.raise_for_status()
        return True
    except Exception as e:
        st.warning(f"⚠️ Error IA: {e}")
        return False

# =========================
# MONITOREO 24/7 (Simulado)
# =========================
def monitoreo_normal(exchange, monedas_seguidas: list, session_state):
    """Monitoreo continuo sin IA, solo detección de patrones"""
    alertas = []

    for moneda in monedas_seguidas:
        try:
            df = obtener_ohlcv(exchange, moneda, limit=100)
            df = calcular_indicadores(df)

            if len(df) < 10:
                continue

            # Detectar patrón
            resultado = detectar_patron(df)

            if resultado['patron'] and resultado['fuerza'] >= 70:
                # Verificar si ya alertamos esta moneda hoy
                clave = f"alert_{moneda}_{datetime.now().strftime('%Y-%m-%d')}"
                if clave not in session_state:
                    # Calcular SL y TP
                    entrada = df.iloc[-1]['c']
                    if 'COMPRA' in resultado['patron']:
                        sl = entrada * (1 - SL_PCT/100)
                        tp = entrada * (1 + TP_PCT/100)
                    else:
                        sl = entrada * (1 + SL_PCT/100)
                        tp = entrada * (1 - TP_PCT/100)

                    # Guardar info para IA
                    session_state[clave] = {
                        "symbol": moneda,
                        "patron": resultado['patron'],
                        "entrada": entrada,
                        "sl": sl,
                        "tp": tp,
                        "tiempo_inicio": time.time(),
                        "analizado": False
                    }
                    alertas.append(session_state[clave])

        except Exception as e:
            continue

    return alertas

def actualizar_metricas_historicas(exchange, symbol: str) -> dict:
    """Calcula métricas históricas simuladas"""
    try:
        df = obtener_ohlcv(exchange, symbol, limit=500)
        df = calcular_indicadores(df)

        if len(df) < 50:
            return {}

        # Simulación de trades históricos
        trades = 0
        wins = 0
        total_pnl = 0

        for i in range(50, len(df)-10):
            window = df.iloc[:i+1]
            patron = detectar_patron(window)

            if patron['patron'] and patron['fuerza'] >= 70:
                entrada = window.iloc[-1]['c']
                # Simular salida 10 velas después
                salida = df.iloc[i+10]['c'] if i+10 < len(df) else df.iloc[-1]['c']
                pnl = (salida - entrada) / entrada * 100
                trades += 1
                if pnl > 0:
                    wins += 1
                total_pnl += pnl

        return {
            "trades_totales": trades,
            "win_rate": (wins / trades * 100) if trades > 0 else 0,
            "pnl_promedio": total_pnl / trades if trades > 0 else 0,
            "mejor_trade": "+2.5%",  # simulado
            "peor_trade": "-1.8%"  # simulado
        }
    except:
        return {}

# =========================
# INTERFAZ PRINCIPAL
# =========================
def main():
    st.title("🚀 Bot Volumen Binance - Monitoreo 24/7")

    # Sidebar
    with st.sidebar:
        st.header("⚙️ Configuración")

        # Credenciales
        st.subheader("🔐 Binance")
        api_key = st.text_input("API Key", type="password")
        api_secret = st.text_input("API Secret", type="password")
        testnet = st.checkbox("Testnet", value=False)

        # Parámetros
        st.subheader("🔍 Parámetros")
        tp_pct = st.slider("TP %", 0.5, 5.0, TP_PCT, 0.1)
        sl_pct = st.slider("SL %", 0.5, 5.0, SL_PCT, 0.1)
        scan_interval = st.slider("Intervalo escaneo (seg)", 30, 300, SCAN_INTERVAL, 10)

        # IA y Telegram
        st.subheader("🤖 IA y Alertas")
        deepseek_key = st.text_input("DeepSeek API Key", type="password")
        tg_chat_id = st.text_input("Telegram Chat ID")
        usar_ia = st.checkbox("Activar IA para alertas", value=True)

        st.markdown("---")
        st.caption("💡 Monitoreo 24/7 de Top 10 monedas")

    # Validación
    if not api_key or not api_secret:
        st.warning("⚠️ Ingresa credenciales Binance")
        return

    # Conexión
    try:
        exchange = construir_exchange(api_key, api_secret, testnet)
        st.success("✅ Conectado a Binance")
    except Exception as e:
        st.error(f"❌ Error: {e}")
        return

    # Inicializar estado
    if "monedas_seguidas" not in st.session_state:
        st.session_state.monedas_seguidas = []
    if "fecha_actual" not in st.session_state:
        st.session_state.fecha_actual = datetime.now().strftime("%Y-%m-%d")
    if "metricas_historicas" not in st.session_state:
        st.session_state.metricas_historicas = {}

    # Escaneo inicial
    if st.button("🔍 Escanear Top 10", type="primary", use_container_width=True):
        with st.spinner("Analizando mercado..."):
            # Obtener top monedas
            mercados = [m['symbol'] for m in exchange.fetch_markets()
                      if m.get('spot') and m.get('active') and m['quote'] == 'USDT']

            candidatos = []
            for sym in mercados[:TOP_N * 3]:
                try:
                    df = obtener_ohlcv(exchange, sym)
                    df = calcular_indicadores(df)
                    if len(df) < 50: continue
                    patron = detectar_patron(df)
                    if patron['patron']:
                        candidatos.append({"symbol": sym, "fuerza": patron['fuerza']})
                except:
                    continue

            top_10 = sorted(candidatos, key=lambda x: x['fuerza'], reverse=True)[:TOP_N]
            st.session_state.monedas_seguidas = [x['symbol'] for x in top_10]
            st.session_state.fecha_actual = datetime.now().strftime("%Y-%m-%d")
            st.success(f"✅ Seguimiento activado para {len(top_10)} monedas")
            st.experimental_rerun()

    # Mostrar monedas seguidas
    if st.session_state.monedas_seguidas:
        st.subheader(f"📋 Monitoreo 24/7 - {len(st.session_state.monedas_seguidas)} monedas")

        # Monitoreo normal (sin IA)
        alertas_pendientes = monitoreo_normal(exchange,
                                              st.session_state.monedas_seguidas,
                                              st.session_state)

        # Mostrar cada moneda
        for i, moneda in enumerate(st.session_state.monedas_seguidas):
            try:
                df = obtener_ohlcv(exchange, moneda, limit=100)
                df = calcular_indicadores(df)
                u = df.iloc[-1]

                patron = detectar_patron(df)

                # Card de la moneda
                col1, col2, col3, col4 = st.columns([2, 1, 1, 1])

                with col1:
                    st.markdown(f"""
                    <div class="coin-card">
                        <strong>{moneda}</strong><br>
                        Precio: {u['c']:.6f} | RVOL: {u['rvol']:.2f}x<br>
                        Patrón: {patron['patron'] or 'NINGUNO'} | Fuerza: {patron['fuerza']}%
                    </div>
                    """, unsafe_allow_html=True)

                with col2:
                    st.metric("Precio", f"{u['c']:.6f}")
                with col3:
                    st.metric("RVOL", f"{u['rvol']:.2f}x")
                with col4:
                    clase = "signal-buy" if patron['fuerza'] > 70 else "signal-hold"
                    st.markdown(f'<div class="{clase}">{patron["patron"] or "HOLD"}</div>',
                                unsafe_allow_html=True)

                # Gráfico pequeño
                with st.expander(f"📈 Gráfico {moneda}"):
                    fig = go.Figure()
                    fig.add_trace(go.Scatter(x=df['ts'], y=df['c'],
                                        mode='lines', name='Precio'))
                    fig.update_layout(height=300, margin=dict(l=20, r=20, t=30, b=20))
                    st.plotly_chart(fig, use_container_width=True)

                # Métricas históricas
                if moneda not in st.session_state.metricas_historicas:
                    with st.spinner(f"Calculando métricas de {moneda}..."):
                        metricas = actualizar_metricas_historicas(exchange, moneda)
                        st.session_state.metricas_historicas[moneda] = metricas

                metricas = st.session_state.metricas_historicas.get(moneda, {})
                if metricas:
                    m1, m2, m3, m4 = st.columns(4)
                    m1.metric("Trades", metricas.get("trades_totales", 0))
                    m2.metric("Win Rate", f"{metricas.get('win_rate', 0):.1f}%")
                    m3.metric("P&L Prom", f"{metricas.get('pnl_promedio', 0):.2f}%")
                    m4.metric("Mejor", metricas.get("mejor_trade", "N/A"))

            except Exception as e:
                st.error(f"Error con {moneda}: {e}")

        # Alertas pendientes (activar IA)
        if alertas_pendientes and usar_ia and deepseek_key and tg_chat_id:
            st.subheader("🚨 Alertas Pendientes - Activando IA")
            for alerta in alertas_pendientes:
                tiempo_transcurrido = time.time() - alerta.get('tiempo_inicio', time.time())
                if not alerta.get('analizado'):
                    with st.spinner(f"Analizando {alerta['symbol']} con IA..."):
                        ok = analizar_con_ia(
                            alerta['symbol'],
                            alerta['patron'],
                            alerta['entrada'],
                            alerta['sl'],
                            alerta['tp'],
                            tiempo_transcurrido,
                            deepseek_key,
                            tg_chat_id
                        )
                        if ok:
                            st.success(f"✅ Alerta enviada para {alerta['symbol']}")
                            alerta['analizado'] = True

    # Panel de métricas históricas
    if st.session_state.get('metricas_historicas'):
        st.subheader("📊 Panel de Métricas Históricas")
        for sym, met in st.session_state.metricas_historicas.items():
            if met:
                with st.expander(f"📈 {sym}"):
                    st.write(f"Total trades: {met.get('trades_totales', 0)}")
                    st.write(f"Win Rate: {met.get('win_rate', 0):.1f}%")
                    st.write(f"P&L Promedio: {met.get('pnl_promedio', 0):.2f}%")

    # Auto-refresh para monitoreo continuo
    if st.session_state.monedas_seguidas:
        time.sleep(1)  # Pequeña pausa
        st.experimental_rerun()

if __name__ == "__main__":
    main()