# 🚀 Volumen-369 - Escáner de Oportunidades Binance

Bot web **avanzado** para análisis y ejecución de órdenes en Binance con capacidad de **escanear todo el mercado** en busca de explosiones y colapsos.

## 🌟 Características Principales

### 🔍 Escaneo de Mercado Completo
- **Analiza todos los pares USDT** de Binance automáticamente
- **Detección de oportunidades explosivas** (💥) con RVOL ≥ 2.0
- **Identificación de colapsos bajistas** (💣) con alta confiabilidad
- **Sistema de confianza** basado en tendencias, rupturas y volumen

### 📊 Análisis Técnico Avanzado
- Indicadores: VWAP, RVOL, SMAs (50 y 200)
- Detección de rupturas con confirmación de volumen
- Multi-timeframe support
- Gráficos interactivos con Plotly

### 💼 Gestión de Operaciones
- Ejecución de órdenes (Buy/Sell) en tiempo real
- Modo testnet/mainnet
- Gestión de riesgo integrada
- Auto-refresh configurable

## 🚀 Despliegue en Streamlit Community Cloud

### 1. Sube este proyecto a GitHub
```bash
git add .
git commit -m "feat: implementar escáner avanzado de Binance"
git push origin main
```

### 2. Crea la app en Streamlit
- Entra a [https://share.streamlit.io/](https://share.streamlit.io/)
- **New app**
  - **Repository**: `templario-777/Volumen-369`
  - **Branch**: `main`
  - **Main file path**: `web_binance_bot.py`

### 3. Configura Secrets (opcional)
En `Advanced settings > Secrets`:
```python
API_KEY="tu_api_key"
API_SECRET="tu_api_secret"
TESTNET=True  # Solo si usas testnet
```

## ⚙️ Requisitos Locales

### Instalación de dependencias
```bash
pip install ccxt pandas streamlit plotly numpy
```

### Ejecución local
```bash
streamlit run web_binance_bot.py
```

## 🎯 Cómo Usar

### 1. Configuración Inicial
- Ingresa tus credenciales de Binance
- Selecciona el par principal para análisis
- Ajusta parámetros: timeframe, RVOL threshold, etc.

### 2. Escaneo Mercado
- Activa **"Modo Escaneo Completo"**
- Espera a que el escáner analice todos los pares
- Revisa las **oportunidades detectadas** (top 20)

### 3. Oportunidades Detectadas
- **💥 EXPLOSIÓN ALCISTA**: Compra fuerte con volumen alto
- **💣 COLAPSO BAJISTA**: Venta con volumen explosivo
- Cada oportunidad muestra:
  - Confianza (0-100%)
  - RVOL actual
  - Cambio 24h
  - Tendencia actual

### 4. Ejecución de Órdenes
- Usa los botones **"COMPRAR"** / **"VENDER"**
- La cantidad se ajusta automáticamente según el riesgo
- Mensajes de confirmación/error instantáneos

## ⚡ Características Avanzadas

### Sistema de Confianza
- Basado en 4 factores clave:
  1. Tendencia (30%): SMA50 > SMA200
  2. Volumen (30%): RVOL ≥ 2.0
  3. Alineación (20%): Precio vs VWAP
  4. Ruptura (20%): Confirmación de volumen

### Rate Limit Optimizado
- Respeta los límites de Binance API
- Sleep entre pares para evitar bloqueos
- Manejo de errores robusto

### Interfaz Profesional
- Diseño responsivo y moderno
- Alertas con colores y emojis
- Gráficos interactivos
- Métricas en tiempo real

## 📈 Estrategia de Trading

### Señales de Compra (🚀)
```
✓ Tendencia alcista (SMA50 > SMA200)
✓ Ruptura de máximos
✓ RVOL ≥ 2.0
✓ Precio sobre VWAP
✓ Confianza ≥ 70%
```

### Señales de Venta (💣)
```
✓ Tendencia bajista (SMA50 < SMA200)
✓ Ruptura de mínimos
✓ RVOL ≥ 2.0
✓ Precio bajo VWAP
✓ Confianza ≥ 70%
```

## 🔐 Seguridad

- **Nunca subas tus API keys** al repositorio
- Usa **testnet** para pruebas
- Los datos de API se manejan en memoria local
- En producción: usa Secrets en Streamlit

## 🚀 Mejas Próximas

- [ ] Alertas via Telegram/WhatsApp
- [ ] Backtesting integrado
- [ ] Soporte para más exchanges
- [ ] Advanced risk management
- [ ] Historical data analysis

---

**Nota**: Este bot está diseñado para análisis educativo y operación responsable. Siempre prueba en testnet antes de operar con capital real.

**Co-Authored-By**: Claude Opus 4.7 <noreply@anthropic.com>
