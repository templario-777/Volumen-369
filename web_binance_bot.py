import time
from dataclasses import dataclass
from typing import Tuple, Dict, List, Any
import ccxt
import pandas as pd
import streamlit as st
import plotly.graph_objects as go

# ============================================
# SISTEMA DE ESCANEO DE MERCADO AVANZADO
# ============================================

def show_alert(message: str, severity: str = "info"):
    """Muestra alertas con estilos visuales mejorados"""
    styles = {
        "info": {"bg": "#e2e3e5", "text": "#383d41", "emoji": "ℹ️"},
        "buy": {"bg": "#d4edda", "text": "#155724", "emoji": "✅"},
        "sell": {"bg": "#f8d7da", "text": "#721c24", "emoji": "❌"},
        "urgent": {"bg": "#ffc107", "text": "#856404", "emoji": "🚨"},
        "success": {"bg": "#28a745", "text": "white", "emoji": "💎"},
        "warning": {"bg": "#fd7e14", "text": "white", "emoji": "⚠️"}
    }
    style = styles.get(severity, styles["info"])
    st.markdown(
        f"""
        <div style='
            background-color: {style["bg"]};
            color: {style["text"]};
            padding: 15px;
            border-radius: 10px;
            margin: 10px 0;
            border-left: 5px solid {style["bg"]};
            font-weight: 500;
            text-align: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        '>
            <span style='font-size: 1.5em;'>{style["emoji"]}</span> <strong>{message}</strong>
        </div>
        """,
        unsafe_allow_html=True
    )

def signal_confidence_score(df: pd.DataFrame, vol_multiplier: float) -> float:
    """Calcula puntuación de confianza de la señal (0-100)"""
    row = df.iloc[-1]
    score = 0

    # Tendencia fuerte (30 puntos)
    if row['sma50'] > row['sma200']:
        score += 30

    # Volumen explosivo (30 puntos)
    if row['rvol'] >= vol_multiplier * 2:
        score += 30
    elif row['rvol'] >= vol_multiplier * 1.5:
        score += 25
    elif row['rvol'] >= vol_multiplier:
        score += 20

    # Alineación de precio con VWAP (20 puntos)
    price_vwap_diff = abs(row['close'] - row['vwap']) / row['vwap']
    if price_vwap_diff < 0.02:
        score += 20

    # Ruptura confirmada (20 puntos)
    if row['close'] > row['high']:
        score += 20

    return min(100, score)

def escanear_mercado_completo(exchange: ccxt.binance, config: AnalyzerConfig) -> List[Dict[str, Any]]:
    """
    ESCANER PRINCIPAL: Busca oportunidades explosivas o de colapso en TODO Binance

    Parámetros de búsqueda:
    - Señales BUY/SELL claras con alta confianza
    - RVOL >= 2.0 (volumen explosivo)
    - Tendencia confirmada por SMAs
    - Ruptura de máximos/mínimos
    """
    resultados = []

    # Obtener todos los pares USDT
    mercados = exchange.fetch_markets()
    simbolos_usdt = [m['symbol'] for m in mercados
                     if m['spot'] and m['active'] and m['quote'] == 'USDT']

    total = len(simbolos_usdt)
    barra_progreso = st.progress(0)
    estado_progreso = st.empty()

    for i, simbolo in enumerate(simbolos_usdt):
        try:
            # Actualizar barra de progreso
            progreso = (i + 1) / total
            barra_progreso.progress(progreso)
            estado_progreso.text(f"Escaneando: {simbolo} ({i+1}/{total})")

            # Obtener datos históricos
            velas = exchange.fetch_ohlcv(simbolo, timeframe=config.timeframe, limit=config.limit)

            if len(velas) < 250:  # Necesitamos suficiente historial
                continue

            df = pd.DataFrame(velas, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")

            # Calcular indicadores
            tipo = (df["high"] + df["low"] + df["close"]) / 3
            df["vwap"] = (tipo * df["volume"]).cumsum() / df["volume"].cumsum()
            df["vol_ma20"] = df["volume"].rolling(20).mean()
            df["rvol"] = df["volume"] / df["vol_ma20"]
            df["sma50"] = df["close"].rolling(50).mean()
            df["sma200"] = df["close"].rolling(200).mean()
            df = df.dropna()

            if len(df) < 50:
                continue

            # Evaluar condiciones de explosión/caída
            ultimo = df.iloc[-1]
            anterior = df.iloc[-2]

            # Condiciones BULL (explosión alcista)
            tendencia_alcista = ultimo['sma50'] > ultimo['sma200']
            ruptura_alcista = ultimo['close'] > anterior['high']
            volumen_explosivo = ultimo['rvol'] >= 2.0
            sobre_vwap = ultimo['close'] > ultimo['vwap']

            # Condiciones BEAR (colapso bajista)
            tendencia_bajista = ultimo['sma50'] < ultimo['sma200']
            ruptura_bajista = ultimo['close'] < anterior['low']
            bajo_vwap = ultimo['close'] < ultimo['vwap']

            confianza = signal_confidence_score(df, config.vol_multiplier)

            # Detectar OPORTUNIDADES ALTAMENTE PROBABLES
            if (tendencia_alcista and ruptura_alcista and volumen_explosivo and
                sobre_vwap and confianza >= 70):
                resultados.append({
                    "simbolo": simbolo,
                    "tipo": "💥 EXPLOSIÓN ALCISTA",
                    "precio": round(ultimo['close'], 6),
                    "rvol": round(ultimo['rvol'], 2),
                    "confianza": confianza,
                    "cambio_24h": round((ultimo['close'] - df.iloc[-24]['close']) / df.iloc[-24]['close'] * 100, 2),
                    "tendencia": "FUERTEMENTE ALCISTA"
                })

            elif (tendencia_bajista and ruptura_bajista and volumen_explosivo and
                  bajo_vwap and confianza >= 70):
                resultados.append({
                    "simbolo": simbolo,
                    "tipo": "💣 COLAPSO BAJISTA",
                    "precio": round(ultimo['close'], 6),
                    "rvol": round(ultimo['rvol'], 2),
                    "confianza": confianza,
                    "cambio_24h": round((ultimo['close'] - df.iloc[-24]['close']) / df.iloc[-24]['close'] * 100, 2),
                    "tendencia": "CRÍTICAMENTE BAJISTA"
                })

            # Respetar rate limit
            time.sleep(0.15)

        except Exception as e:
            continue

    barra_progreso.empty()
    estado_progreso.empty()

    # Ordenar por confianza descendente
    resultados.sort(key=lambda x: x['confianza'], reverse=True)
    return resultados


# ============================================
# CONFIGURACIÓN Y ANÁLISIS PRINCIPAL
# ============================================

@dataclass
class AnalyzerConfig:
    symbol: str = "BTC/USDT"
    timeframe: str = "5m"
    limit: int = 300
    vol_multiplier: float = 1.8

def build_exchange(api_key: str, api_secret: str, testnet: bool) -> ccxt.binance:
    """Construye la conexión con Binance"""
    exchange = ccxt.binance({
        "apiKey": api_key.strip(),
        "secret": api_secret.strip(),
        "enableRateLimit": True,
        "options": {"defaultType": "spot"},
        "timeout": 30000
    })
    if testnet:
        exchange.set_sandbox_mode(True)
    return exchange

def fetch_ohlcv(exchange: ccxt.binance, symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    """Obtiene datos OHLCV"""
    velas = exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    df = pd.DataFrame(velas, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df

def calcular_indicadores(df: pd.DataFrame) -> pd.DataFrame:
    """Calcula todos los indicadores técnicos"""
    df = df.copy()
    tipo = (df["high"] + df["low"] + df["close"]) / 3
    df["vwap"] = (tipo * df["volume"]).cumsum() / df["volume"].cumsum()
    df["vol_ma20"] = df["volume"].rolling(20).mean()
    df["rvol"] = df["volume"] / df["vol_ma20"]
    df["sma50"] = df["close"].rolling(50).mean()
    df["sma200"] = df["close"].rolling(200).mean()
    return df.dropna()

def generar_señal(df: pd.DataFrame, vol_multiplier: float) -> str:
    """Genera señal basada en estrategia mejorada"""
    ultimo = df.iloc[-1]
    anterior = df.iloc[-2]

    # Tendencias
    alcista = ultimo['sma50'] > ultimo['sma200']
    bajista = ultimo['sma50'] < ultimo['sma200']

    # Rupturas con confirmación de volumen
    ruptura_alcista = ultimo['close'] > anterior['high'] and ultimo['volume'] > anterior['volume'] * 1.5
    ruptura_bajista = ultimo['close'] < anterior['low'] and ultimo['volume'] > anterior['volume'] * 1.5

    # Condiciones BUY
    condiciones_buy = [
        alcista,
        ruptura_alcista,
        ultimo['rvol'] >= vol_multiplier,
        ultimo['close'] > ultimo['vwap'],
        ultimo['close'] > ultimo['sma50']
    ]

    # Condiciones SELL
    condiciones_sell = [
        bajista,
        ruptura_bajista,
        ultimo['rvol'] >= vol_multiplier,
        ultimo['close'] < ultimo['vwap'],
        ultimo['close'] < ultimo['sma50']
    ]

    if all(condiciones_buy):
        return "BUY"
    elif all(condiciones_sell):
        return "SELL"
    return "HOLD"

def crear_grafico_interactivo(df: pd.DataFrame) -> go.Figure:
    """Crea gráfico interactivo con Plotly"""
    fig = go.Figure()

    # Precio y VWAP
    fig.add_trace(go.Scatter(
        x=df['timestamp'], y=df['close'],
        mode='lines', name='Precio',
        line=dict(color='#007bff', width=2)
    ))

    fig.add_trace(go.Scatter(
        x=df['timestamp'], y=df['vwap'],
        mode='lines', name='VWAP',
        line=dict(color='#28a745', width=2, dash='dash')
    ))

    # Bandas de volumen
    fig.add_trace(go.Bar(
        x=df['timestamp'], y=df['volume'],
        name='Volumen',
        marker_color='#6c757d',
        opacity=0.3,
        yaxis='y2'
    ))

    fig.update_layout(
        title='Análisis de Precio y Volumen',
        xaxis_title='Tiempo',
        yaxis_title='Precio (USDT)',
        yaxis2=dict(title='Volumen', overlaying='y', side='right', showgrid=False),
        template='plotly_white',
        hovermode='x unified',
        height=500
    )

    return fig


def main():
    """Función principal de la aplicación"""

    # Configuración de página
    st.set_page_config(
        page_title="🚀 Bot Escáner Binance",
        page_icon="🚀",
        layout="wide",
        initial_sidebar_state="expanded"
    )

    # Tema dinámico
    st.markdown("""
    <style>
    .stApp { background-color: #f8f9fa; }
    .stButton>button {
        background-color: #007bff;
        color: white;
        border-radius: 8px;
        border: none;
        padding: 10px 20px;
        font-weight: 600;
    }
    .stButton>button:hover { background-color: #0056b3; }
    .metric-card {
        background: white;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        margin: 10px 0;
    }
    .header-section {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 30px;
        border-radius: 15px;
        margin-bottom: 20px;
    }
    .signal-card-buy {
        background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
        border-left: 5px solid #28a745;
    }
    .signal-card-sell {
        background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%);
        border-left: 5px solid #dc3545;
    }
    .signal-card-hold {
        background: linear-gradient(135deg, #e2e3e5 0%, #d6d8db 100%);
        border-left: 5px solid #6c757d;
    }
    </style>
    """, unsafe_allow_html=True)

    # Header
    st.markdown("""
    <div class="header-section">
        <h1 style='margin:0;'>🚀 Escáner de Oportunidades Binance</h1>
        <p style='margin:5px 0 0 0; opacity:0.9;'>Análisis en tiempo real de señales explosivas y colapsos</p>
    </div>
    """, unsafe_allow_html=True)

    # Sidebar
    with st.sidebar:
        st.image("https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Binance_Logo.svg/256px-Binance_Logo.svg.png", width=150)
        st.title("⚙️ Configuración")

        st.subheader("🔐 Conexión")
        api_key = st.text_input("🔑 API Key", type="password", placeholder="Tu API Key")
        api_secret = st.text_input("🔒 API Secret", type="password", placeholder="Tu API Secret")
        testnet = st.checkbox("🌐 Usar Testnet", value=False)

        st.subheader("🎯 Parámetros de Escaneo")
        symbol = st.text_input("📈 Par Principal", value="BTC/USDT")
        timeframe = st.selectbox("⏱️ Timeframe",
                                ["1m", "5m", "15m", "1h", "4h"], index=1)
        limit = st.slider("📊 Velas a analizar", 100, 500, 300, 50)
        vol_multiplier = st.slider("💥 Umbral RVOL", 1.0, 4.0, 1.8, 0.1)
        order_amount = st.number_input("💰 Cantidad por operación", 0.0, 10.0, 0.001, 0.001)

        st.subheader("⚡ Automatización")
        auto_refresh = st.checkbox("🔄 Auto-refresh (10s)", value=False)
        scan_mode = st.checkbox("🔍 Modo Escaneo Completo", value=False)

        st.subheader("📊 Opciones Visuales")
        theme = st.selectbox("🎨 Tema", ["Claro", "Oscuro"], index=0)

        st.markdown("---")
        st.info("💡 Escanea todo Binance para encontrar")
        st.info("💡 oportunidades con alta probabilidad")

    # Estado de sesión
    if "last_refresh" not in st.session_state:
        st.session_state.last_refresh = 0.0
    if "scan_results" not in st.session_state:
        st.session_state.scan_results = []

    # Verificación de API
    if not api_key or not api_secret:
        st.warning("⚠️ Por favor ingresa tus credenciales de Binance para comenzar")
        return

    # Conexión
    try:
        exchange = build_exchange(api_key, api_secret, testnet)
        exchange.load_markets()
        st.success("✅ Conexión con Binance establecida")
    except Exception as err:
        show_alert(f"Error de conexión: {err}", "urgent")
        return

    config = AnalyzerConfig(
        symbol=symbol,
        timeframe=timeframe,
        limit=limit,
        vol_multiplier=vol_multiplier
    )

    # Auto-refresh
    if auto_refresh and time.time() - st.session_state.last_refresh >= 10:
        refresh_triggered = True
    else:
        refresh_triggered = False

    # Botones de acción
    col1, col2, col3, col4 = st.columns([1, 1, 1, 2])
    with col1:
        refresh_btn = st.button("🔄 Actualizar Análisis", type="primary", use_container_width=True)
    with col2:
        scan_btn = st.button("🔍 Escanear Mercado", type="secondary", use_container_width=True)
    with col3:
        clear_btn = st.button("🧹 Limpiar", use_container_width=True)
    with col4:
        st.info(f"Última actualización: {time.strftime('%H:%M:%S', time.localtime(st.session_state.last_refresh))}")

    if clear_btn:
        st.session_state.scan_results = []

    # Modo escaneo completo
    if scan_btn or scan_mode:
        with st.spinner("🔍 Escaneando todo el mercado de Binance..."):
            st.session_state.scan_results = escanear_mercado_completo(exchange, config)

    # Obtener datos del par principal
    try:
        data = fetch_ohlcv(exchange, symbol, timeframe, limit)
        data = calcular_indicadores(data)
        signal = generar_señal(data, vol_multiplier)
        st.session_state.last_refresh = time.time()
        st.session_state.data = data
        st.session_state.signal = signal
    except Exception as err:
        show_alert(f"Error al cargar datos: {err}", "urgent")
        return

    # ============================================
    # INTERFAZ PRINCIPAL
    # ============================================

    # Panel de métricas principales
    last = data.iloc[-1]
    confidence = signal_confidence_score(data, vol_multiplier)

    st.markdown("### 📊 Métricas del Par Principal")
    mcol1, mcol2, mcol3, mcol4, mcol5 = st.columns(5)

    with mcol1:
        st.markdown(f"""
        <div class="metric-card">
            <h3 style='color:#6c757d; margin:0;'>💰 Precio</h3>
            <p style='font-size:24px; margin:5px 0; color:#007bff;'>{last['close']:.6f}</p>
        </div>
        """, unsafe_allow_html=True)

    with mcol2:
        st.markdown(f"""
        <div class="metric-card">
            <h3 style='color:#6c757d; margin:0;'>📈 RVOL</h3>
            <p style='font-size:24px; margin:5px 0; color:#{'28a745' if last['rvol'] > 2 else '#dc3545'};'>{last['rvol']:.2f}x</p>
        </div>
        """, unsafe_allow_html=True)

    with mcol3:
        st.markdown(f"""
        <div class="metric-card">
            <h3 style='color:#6c757d; margin:0;'>🎯 VWAP</h3>
            <p style='font-size:24px; margin:5px 0; color:#007bff;'>{last['vwap']:.6f}</p>
        </div>
        """, unsafe_allow_html=True)

    with mcol4:
        st.markdown(f"""
        <div class="metric-card">
            <h3 style='color:#6c757d; margin:0;'>📊 Confianza</h3>
            <p style='font-size:24px; margin:5px 0; color:#{'28a745' if confidence > 70 else '#fd7e14' if confidence > 50 else '#dc3545'};'>{confidence}%</p>
        </div>
        """, unsafe_allow_html=True)

    with mcol5:
        signal_class = "buy" if signal == "BUY" else "sell" if signal == "SELL" else "hold"
        st.markdown(f"""
        <div class="metric-card signal-card-{signal_class}">
            <h3 style='color:#6c757d; margin:0;'>🎯 Señal</h3>
            <p style='font-size:24px; margin:5px 0;'>{signal}</p>
        </div>
        """, unsafe_allow_html=True)

    # Mostrar alerta de señal
    if signal == "BUY":
        show_alert(f"🚀 ¡SEÑAL DE COMPRA DETECTADA! Confianza: {confidence}%", "buy")
    elif signal == "SELL":
        show_alert(f"💣 ¡SEÑAL DE VENTA DETECTADA! Confianza: {confidence}%", "sell")

    # Gráficos interactivos
    st.markdown("### 📈 Gráfico de Precios y VWAP")
    fig = crear_grafico_interactivo(data)
    st.plotly_chart(fig, use_container_width=True)

    # Historial de escaneo
    if st.session_state.scan_results:
        st.markdown("### 💎 Oportunidades Encontradas en el Escaneo")

        for oportunidad in st.session_state.scan_results[:20]:  # Mostrar top 20
            color_class = "signal-card-buy" if "EXPLOSIÓN" in oportunidad['tipo'] else "signal-card-sell"
            icon = "🚀" if "EXPLOSIÓN" in oportunidad['tipo'] else "💣"

            st.markdown(f"""
            <div class="metric-card {color_class}">
                <div style='display: flex; justify-content: space-between; align-items: center;'>
                    <div>
                        <h4 style='margin:0;'>{icon} {oportunidad['simbolo']}</h4>
                        <p style='margin:5px 0; font-size:18px;'>{oportunidad['tipo']}</p>
                    </div>
                    <div style='text-align: right;'>
                        <p style='margin:0; font-size:20px; font-weight: bold;'>{oportunidad['precio']}</p>
                        <p style='margin:0; color:{'#28a745' if oportunidad['cambio_24h'] > 0 else '#dc3545'};'>
                            {oportunidad['cambio_24h']:+.2f}% (24h)
                        </p>
                    </div>
                </div>
                <div style='display: flex; justify-content: space-between; margin-top:10px;'>
                    <span>🤖 Confianza: {oportunidad['confianza']}%</span>
                    <span>📊 RVOL: {oportunidad['rvol']}x</span>
                    <span>📈 {oportunidad['tendencia']}</span>
                </div>
            </div>
            """, unsafe_allow_html=True)

    # Volumen
    st.markdown("### 📊 Historial de Volumen")
    fig_vol = go.Figure()
    fig_vol.add_trace(go.Bar(
        x=data['timestamp'], y=data['volume'],
        marker_color=['#28a745' if data['close'].iloc[i] > data['open'].iloc[i] else '#dc3545'
                     for i in range(len(data))],
        name='Volumen'
    ))
    fig_vol.update_layout(
        title='Volumen por Velas',
        xaxis_title='Tiempo',
        yaxis_title='Volumen',
        template='plotly_white',
        height=300
    )
    st.plotly_chart(fig_vol, use_container_width=True)

    # Operaciones
    st.markdown("### 💼 Ejecutar Operación")
    op_col1, op_col2 = st.columns([1, 1])

    with op_col1:
        if st.button("🟢 COMPRAR", type="primary", use_container_width=True):
            with st.spinner("Ejecutando orden de compra..."):
                ok, msg = create_order(exchange, symbol, "buy", order_amount)
                if ok:
                    show_alert(f"Compra exitosa: {msg}", "success")
                else:
                    show_alert(f"Error en compra: {msg}", "urgent")

    with op_col2:
        if st.button("🔴 VENDER", type="secondary", use_container_width=True):
            with st.spinner("Ejecutando orden de venta..."):
                ok, msg = create_order(exchange, symbol, "sell", order_amount)
                if ok:
                    show_alert(f"Venta exitosa: {msg}", "success")
                else:
                    show_alert(f"Error en venta: {msg}", "urgent")


def create_order(exchange: ccxt.binance, symbol: str, side: str, amount: float) -> Tuple[bool, str]:
    """Ejecuta una orden de mercado"""
    try:
        order = exchange.create_order(
            symbol=symbol,
            type='market',
            side=side.lower(),
            amount=amount
        )
        return True, f"ID: {order.get('id', 'N/A')} | Precio: {order.get('price', 'N/A')}"
    except Exception as err:
        return False, str(err)


if __name__ == "__main__":
    main()