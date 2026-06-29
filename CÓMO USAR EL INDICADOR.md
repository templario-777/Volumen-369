# 📖 Cómo usar tu Indicador en TradingView

## Opción 1: Abre TradingView directamente con EDEN/USDT
1. Haz clic en este enlace: [TradingView - EDEN/USDT Binance](https://www.tradingview.com/chart/?symbol=BINANCE:EDENUSDT)
2. Sigue las instrucciones a continuación para agregar tu indicador

## Opción 2: Guarda tu indicador en TradingView para usar siempre

### Paso 1: Abre el Pine Editor
1. Abre [TradingView](https://www.tradingview.com)
2. Abre el gráfico de cualquier par (ej: EDEN/USDT)
3. Haz clic en el botón **"Pine Editor"** en la parte inferior (icono de 📝)

### Paso 2: Agrega tu código
1. Elimina TODO el código que aparece por defecto en el Pine Editor
2. Abre el archivo **`indicador para tradingview`** en tu carpeta
3. Copia TODO el código del archivo
4. Pega el código en el Pine Editor de TradingView

### Paso 3: Guarda tu indicador
1. Haz clic en el botón **"Save"** (💾) en la esquina superior derecha del Pine Editor
2. Nombra tu indicador: "Sistema Trading Crypto - Aether Connect Labs"
3. ¡Listo! Ahora podrás encontrar tu indicador en la sección **"Indicators"** > **"My Scripts"**

### Paso 4: Usa tu indicador siempre que quieras
1. En cualquier gráfico, haz clic en **"Indicators"** (📊)
2. Ve a la pestaña **"My Scripts"**
3. Haz clic en tu indicador para agregarlo al gráfico

---

## 🤖 Recuerda: El bot de Streamlit ya usa la lógica del indicador!
Tu bot de Streamlit (archivo `web_binance_bot.py`) ya implementa las reglas de tu indicador:
- Detecta Zonas de Demanda (3 velas alcistas + volumen extra)
- Detecta Zonas de Oferta (3 velas bajistas + volumen extra)
- Calcula ATR y RVOL
