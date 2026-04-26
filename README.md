# 🚀 Volumen-369 — Dashboard Algorítmico “Magnet Gravity” (Cloudflare Worker)

Dashboard de análisis y ejecución manual asistida para Binance (Spot/Futuros) con:
- Mapa de “imanes” por Perfil de Volumen multi‑timeframe (15m/1h/4h/1d).
- Filtros V6 de precisión (Delta Divergence, Slippage Predictor, Volume Cluster 1D).
- Filtros V7 de confirmación (HFT speed + V‑Shape en tiempo real, Spot‑Futures basis, Soporte/Resistencia).

Este proyecto está pensado para ayudarte a operar de forma sistemática: el panel te dice “OPERAR / NO OPERAR” según reglas, pero la orden la colocas tú en Binance.

## ✅ URL

- Worker: `https://volumen-369-bot.<tu-id>.workers.dev`

## ✨ Qué hace (resumen)

- **Imanes (MTF)**: calcula BPOC/POC/SPOC en 15m/1h/4h/1d y selecciona el imán dominante para la entrada.
- **Order Book Gravity**: mide desequilibrio de bids/asks para saber hacia dónde “tira” el dinero en ese momento.
- **Delta Divergence**: confirma absorción (precio baja pero delta sube = compradores ganan).
- **Slippage Predictor**: estima spread/slippage en el libro; si es caro entrar, aborta.
- **Volume Cluster 1D**: valida que tu entrada coincide con una zona macro donde hubo dinero real.
- **HFT/V‑Shape (websocket)**: cuando el precio está cerca del imán, se activa un modo HFT en el navegador:
  TPS, ms/trade, ratio buy/sell y “V‑Shape READY”.
- **Spot‑Futures Arb (basis)**: compara spot vs futuros para detectar divergencias de liquidez.
- **Soporte/Resistencia**: zonas derivadas de Supply/Demand (rebotes típicos).

## 🧠 Estrategia (cómo usarlo)

### 1) Elige el símbolo (spot o perp)
- Puedes buscar en la barra superior o cambiar el símbolo desde el gráfico.
- El panel se sincroniza automáticamente con el símbolo del gráfico.

### 2) Identifica el “IMÁN” de entrada (nivel clave)
- La **ENTRADA (IMÁN)** es el nivel algorítmico.
- No se entra “en cualquier sitio”: se espera a que el precio se acerque al imán.

Regla práctica:
- Si el precio está a más de ~0.25%–0.35% del imán, el sistema no activa HFT.
- Cuando se acerca, el HFT se activa y busca confirmación institucional.

### 3) Confirma con V6 (precisión)
Para considerar entrada, el panel debe estar sano:
- **Delta Divergence**: ideal que marque absorción (bullish/bearish).
- **Slippage Predictor**: debe estar en **OK** (si dice ABORTAR ENTRADA, se cancela la idea).
- **Volume Cluster 1D**: ideal **MEDIO/ALTO** (zona macro real).

### 4) Confirma con V7 (timing exacto)
El punto de giro se toma solo si:
- **TPS alto** (cinta rápida).
- **Ratio Buy/Sell alto** (ej. ≥ 3.0).
- **V‑Shape READY** (rebote detectado en <60s).

### 5) Ejecución y gestión
- Entrada: coloca tu orden en el **imán** (preferible limit).
- SL: usa el SL que da el panel.
- TP1: rebote al POC/retorno a equilibrio.
- TP2: “imán opuesto” (barrida total).
- **Auto‑Breakeven (manual)**: si el movimiento va a favor, mueve SL a entrada según la regla mostrada.

## 🛠️ Despliegue (Cloudflare Worker)

1. Cloudflare Dashboard → Workers & Pages → Create Worker
2. Nombre: `volumen-369-bot`
3. Copia el contenido de [bot_worker.js](file:///c:/Users/Alumno.LAPTOP-72MR2U1M/Music/Crypto/bot_worker.js) al editor del Worker
4. Deploy

## ⚠️ Seguridad

- No pegues API keys en el repositorio.
- Este dashboard usa endpoints públicos de Binance y websockets desde tu navegador.
- Si decides operar, hazlo con tamaño pequeño hasta validar reglas en tus activos.

## 📌 Notas técnicas

- El modo HFT corre en tu navegador (WebSocket), no dentro del Worker.
- El Worker hace “fallback” Spot/Futuros para que el símbolo del gráfico y el cálculo coincidan mejor.

---

Repositorio: https://github.com/templario-777/Volumen-369
