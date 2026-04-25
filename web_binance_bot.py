import time
from dataclasses import dataclass
from typing import Tuple, Dict, List, Any
import ccxt
import pandas as pd
import streamlit as st
import plotly.graph_objects as go
import requests
import json

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
</style>
""", unsafe_allow_html=True)

# ============================================
# FUNCIÓN PARA ENVIAR NOTIFICACIONES A TELEGRAM A través de DEEPSEEK
# ============================================
def send_telegram_via_deepseek(message: str, deepseek_api_key: str, model: str = "deepseek-chat") -> str:
    """
    Envía un mensaje a Telegram usando la API de DeepSeek como puente.
    DeepSeek debe estar configurado para recibir el prompt y ejecutar una acción externa.
    Esta función supone que DeepSeek puede forward el mensaje a Telegram.
    """
    headers = {
        "Authorization": f"Bearer {deepseek_api_key}",
        "Content-Type": "application/json"
    }

    # Prompt que indica a DeepSeek que envíe el mensaje a Telegram
    prompt = f"""
    Eres un asistente que controla un bot de Telegram.
    Tu única tarea es enviar el siguiente texto como mensaje al chat ID especificado.
    No incluyas explicaciones, solo confirma que el mensaje fue enviado.
    Mensaje a enviar:
    {message}
    """

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 150
    }

    try:
        resp = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers=headers,
            json=payload,
            timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
        reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return reply.strip()
    except Exception as e:
        return f"⚠️ Error al notificar a Telegram vía DeepSeek: {e}"

# ============================================
# CONFIGURACIÓN Y CLASES
# ============================================
@dataclass
class AnalyzerConfig:
    symbol: str = "BTC/USDT"
    timeframe: str = "5m"
    limit: int = 300
    vol_multiplier: float = 1.8
    top_n: int = 10  # Número máximo de cripto a escanear por día

def build_exchange(api_key: str, api_secret: str, testnet: bool) -> ccxt.binance:
    """Construye la conexión con Binance"""
    exchange = ccxt.binance({
        "apiKey": api_key.strip(),
        "secret": api_secret.strip(),
        "enableRateLimit": True,
        "options": {"defaultType": "spot"},
        "timeout": 30000
    }
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

def create_price_vwap_chart(df: pd.DataFrame) -> go.Figure:
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

    # Volumen
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
        height=500,
        margin=dict(l=20, r=20, t=40, b=20)
    )

    return fig

def get_top_10_coins(exchange: ccxt.binance, config: AnalyzerConfig) -> List[Dict[str, Any]]:
    """
    Obtiene las 10 mejores criptomonedas para operar hoy
    (basado en volumen 24h y volatilidad)
    """
    markets = exchange.fetch_markets()
    # Filtrar solo pares USDT spot y activos
    simbolos_usdt = [
        m['symbol'] for m in markets
        if m['spot'] and m['active'] and m['quote'] == 'USDT'
    ]

    resultados = []
    for simbolo in_simbolos_usdt[:config.top_n * 3]:  # Tomamos un poco más para filtrar después
        try:
            # Obtener datos históricos
            velas = exchange.fetch_ohlcv(simbolo, timeframe=config.timeframe, limit=config.limit)
            if len(velas) < 100:  # Necesitamos suficiente historial
                continue

            df = pd.DataFrame(velas, columns=["timestamp", "open", "high", "low", "close", "volume"])
            df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")

            # Calcular indicadores
            df = calcular_indicadores(df)

            if len(df) < 50:
                continue

            ultimo = df.iloc[-1]
            anterior = df.iloc[-2]

            # Métricas clave
            rvol = ultimo['rvol']
            price_change_pct = ((ultimo['close'] - df.iloc[-24]['close']) / df.iloc[-24]['close']) * 100

            # Filtrar por confianza mínima
            confianza = signal_confidence_score(df, config.vol_multiplier)
            if confianza < 50:  # Umbral mínimo de confianza
                continue

            resultados.append({
                "symbol": simbolo,
                "price": ultimo['close'],
                "volume": ultimo['volume'],
                "rvol": rvol,
                "price_change_24h": price_change_pct,
                "confianza": confianza,
                "signal": generar_señal(df, config.vol_multiplier),
                "tendencia": "ALCISTA" if ultimo['sma50'] > ultimo['sma200'] else "BAJISTA"
            })
        except Exception as e:
            continue

    # Ordenar por confianza descendente
    resultados.sort(key=lambda x: x['confianza'], reverse=True)
    return resultados

# ============================================
# INTERFAZ DE USUARIO
# ============================================
def main():
    # Configuración de página
    st.set_page_config(
        page_title="🚀 Binance Volume Bot",
        layout="wide",
        page_icon="🚀",
        initial_sidebar_state="expanded"
    )

    # --- Sidebar ---
    with st.sidebar:
        st.header("⚙️ Configuración")

        # API de Binance
        st.subheader("🔑 Credenciales Binance")
        api_key = st.text_input("API Key", type="password", placeholder="Tu API Key")
        api_secret = st.text_input("API Secret", type="password", placeholder="Tu API Secret")
        testnet = st.checkbox("🌐 Usar Testnet", value=False)

        # Parámetros de escaneo
        st.subheader("🔍 Parámetros de Escaneo")
        symbol = st.text_input("📈 Par Principal", value="BTC/USDT")
        timeframe = st.selectbox("⏱️ Timeframe", ["1m", "5m", "15m", "1h", "4h"], index=1)
        limit = st.slider("📊 Velas a analizar", 100, 500, 300, 50)
        vol_multiplier = st.slider("💥 Umbral RVOL", 1.0, 4.0, 1.8, 0.1)
        top_n = st.slider("🔢 Top N monedas a escanear", 5, 20, 10)
        order_amount = st.number_input("💰 Cantidad por operación", 0.0, 10.0, 0.001, 0.001)

        # Notificaciones
        st.subheader("📢 Notificaciones")
        deepseek_key = st.text_input("🤖 DeepSeek API Key", type="password", help="Clave de DeepSeek")
        tg_token = st.text_input("📱 Bot Token (Telegram)", type="password", placeholder="Token del bot de Telegram")
        tg_chat_id = st.text_input("💬 Chat ID (Telegram)", help="ID del chat donde recibir notificaciones")
        enable_notif = st.checkbox("🔔 Habilitar notificaciones", value=False)

        st.markdown("---")
        st.info("💡 *Esta aplicación escanea automáticamente las 10 mejores criptomonedas y envía señales estratégicas.*")

    # --- Estado de sesión ---
    if "last_refresh" not in st.session_state:
        st.session_state.last_refresh = 0.0
    if "scan_results" not in st.session_state:
        st.session_state.scan_results = []

    # --- Verificación de API ---
    if not api_key or not api_secret:
        st.warning("⚠️ Por favor ingresa tus credenciales de Binance para continuar")
        return

    # Conexión
    try:
        exchange = build_exchange(api_key, api_secret, testnet)
        exchange.load_markets()
        st.success("✅ Conexión con Binance establecida")
    except Exception as err:
        st.error(f"Error de conexión: {err}")
        return

    # --- Escaneo de mercado (si está activado o hay refresco) ---
    auto_refresh = st.sidebar.checkbox("🔁 Auto-refresh (10s)", value=False)
    if auto_refresh or st.button("🔍 Escanear Mercado", type="primary"):
        with st.spinner("🔍 Escaneando monedas..."):
            # Obtener datos del par principal
            try:
                data = fetch_ohlcv(exchange, symbol, timeframe, limit)
                data = calcular_indicadores(data)
                signal = generar_señal(data, vol_multiplier)
                st.session_state.last_refresh = time.time()
                st.session_state.data = data
                st.session_state.signals = {"signal": signal}
            except Exception as err:
                st.error(f"Error al cargar datos: {err}")
                return

            # Escanear top 10 coins
            try:
                top_coins = get_top_10_coins(exchange, AnalyzerConfig(
                    symbol=symbol,
                    timeframe=timeframe,
                    limit=limit,
                    vol_multiplier=vol_multiplier,
                    top_n=top_n
                ))
                st.session_state.scan_results = top_coins
            except Exception as err:
                st.error(f"Error al escanear mercado: {err}")
                st.session_state.scan_results = []

    # ============================================
    # PANEL DE ANÁLISIS PRINCIPAL
    # ============================================
    st.title("📊 Binance Volume Bot - Análisis Avanzado")

    # Mostrar datos del par principal
    if "data" in st.session_state:
        data = st.session_state.data
        signal = st.session_state.signals.get("signal", "HOLD")
        last = data.iloc[-1]
        confidence = signal_confidence_score(data, vol_multiplier)

        # Mostrar métricas en columnas responsivas
        cols = st.columns(5)
        with cols[0]:
            st.metric("💰 Precio", f"{last['close']:.6f}")
        with cols[1]:
            st.metric("📈 RVOL", f"{last['rvol']:.2f}x")
        with cols[2]:
            st.metric("🎯 VWAP", f"{last['vwap']:.6f}")
        with cols[3]:
            st.metric("📊 Confianza", f"{confidence:.1f}%")
        with cols[4]:
            # Señal con color dinámico
            signal_color = "background-color: #2ecc71;" if signal == "BUY" else \
                           "background-color: #e74c3c;" if signal == "SELL" else \
                           "background-color: #e2e3e5;"
            st.markdown(
                f"""
                <div style="background-color:{signal_color};padding:12px;border-radius:8px;
                            color:#fff;font-weight:bold;text-align:center;margin:0;">
                    🎯 {signal}
                </div>
                """, unsafe_allow_html=True)

        # Gráfico interactivo
        st.subheader("📈 Precio vs VWAP")
        fig = crear_grafico_interactivo(data)
        st.plotly_chart(fig, use_container_width=True)

        # Volumen
        st.subheader("📊 Volumen Histórico")
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

        # Panel de señales del top 10
        if st.session_state.scan_results:
            st.subheader("💎 Oportunidades Detectadas (Top 10)")
            for oportunidad in st.session_state.scan_results[:10]:
                color_class = "background-color: #2ecc71;" if "EXPLOSIÓN" in oportunidad['tipo'] else \
                              "background-color: #e74c3c;" if "COLAPSO" in oportunidad['tipo'] else \
                              "background-color: #e2e3e5;"
                icon = "🚀" if "EXPLOSIÓN" in oportunidad['tipo'] else "💣" if "COLAPSO" in oportunidad['tipo'] else "🔍"
                col1, col2 = st.columns([3, 1])
                with col1:
                    st.markdown(f"""
                        <div style="background-color:{color_class};padding:12px;border-radius:8px;margin:5px 0;">
                            <strong>{icon} {oportunidad['symbol']}</strong><br>
                            <small>{oportunidad['tipo']}</small><br>
                            <small>Confianza: {oportunidad['confianza']:.0f}%</small>
                        </div>
                        """, unsafe_allow_html=True)
                with col2:
                    st.markdown(f"""
                        <div style="font-size:1.2rem;text-align:center;">
                            {oportunidad['price']:.6f}
                        </div>
                        """, unsafe_allow_html=True)

                    # Notificar vía Telegram si está habilitado
                    if enable_notif and deepseek_key and tg_token and tg_chat_id:
                        alert_text = f"{icon} {oportunidad['symbol']} - {oportunidad['tipo']}<br>Confianza: {oportunidad['confianza']:.0f}%"
                        result = send_telegram_via_deepseek(alert_text, deepseek_key)
                        st.caption(f"Telegram API response: {result}")

        # Panel de gestión de órdenes
        st.subheader("💼 Gestión de Órdenes")
        col1, col2 = st.columns(2)
        with col1:
            if st.button("🟢 COMPRAR", type="primary", use_container_width=True):
                with st.spinner("Ejecutando orden de compra..."):
                    # Aquí podrías integrar lógica real de creación de orden
                    st.success("✅ Orden de compra simulada (en producción usar API)")

        with col2:
            if st.button("🔴 VENDER", type="secondary", use_container_width=True):
                with st.spinner("Ejecutando orden de venta..."):
                    # Lógica de venta simulada
                    st.success("✅ Orden de venta simulada (en producción usar API)")

    # ============================================
    # NOTAS LEGALES Y PRÓXIMAS MEJORAS
    # ============================================
    st.markdown("---")
    st.caption("""
    **Nota de Seguridad**
    - Nunca subas tus claves API a repositorios públicos.
    - Usa el modo *Testnet* para pruebas antes de operar con dinero real.
    - Las notificaciones por Telegram se envían mediante DeepSeek como puente; la integración real dependerá de tu configuración de DeepSeek.

    **Próximas mejoras planeadas**
    - Backtesting histórico con resultados de rendimiento.
    - Alertas push a Telegram/WhatsApp.
    - Soporte multi-exchange.
    - Dashboard de monitoreo en tiempo real.
    """)

    # Footer
    st.markdown("<p style='text-align: center; color: #666;'>🚀 Binance Volume Bot - Powered by DeepSeek</p>", unsafe_allow_html=True)


if __name__ == "__main__":
    main()