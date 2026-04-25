# 🚀 Volumen-369 - Bot Trading Real 24/7

Bot de trading real para Binance con monitoreo 24/7, detección de patrones de volumen, ejecución de órdenes REALES y alertas a Telegram vía Cloudflare Worker.

## ✨ Características

- 🔍 **Escáner 24/7**: Monitorea las 10 criptomonedas más líquidas automáticamente.
- 📊 **Detección de Patrones**: Identifica rupturas alcistas/bajistas con RVOL > 2.0.
- 💼 **Órdenes REALES**: Ejecuta compras/ventas en Binance (no simuladas).
- 🎯 **Gestión de Riesgo**: Take Profit (+4%) y Stop Loss (-2%) automáticos.
- 📱 **Alertas Telegram**: Envía notificaciones de entrada y salida vía Cloudflare Worker.
- 📈 **Panel de Métricas**: Historial de operaciones cerradas con ganancia/pérdida.

## 🛠️ Solución Única: Cloudflare Worker (Proxy)

Debido a que **Binance bloquea el acceso desde ciertas ubicaciones** (Error 451), la **única solución** es usar un **Cloudflare Worker** como proxy.

### Paso a paso para crear tu Worker:

1. **Entra a [Cloudflare Dashboard](https://dash.cloudflare.com/)**
2. Ve a **Workers & Pages → Create Application → Create Worker**
3. Nombra tu Worker: `binance-proxy`
4. **Pega este código** en el editor:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");
    if (!target) return new Response("Falta ?target=", {status: 400});

    const init = {
      method: request.method,
      headers: request.headers,
      redirect: "follow"
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }
    return fetch(target + url.pathname + url.search, init);
  }
}
```

5. **Deploy** → Tendrás una URL tipo:  
   `https://binance-proxy.tu-cuenta.workers.dev`

6. **En tu app de Streamlit** → **Settings → Secrets** añade:
   ```
   CLOUDFLARE_WORKER_URL=https://binance-proxy.tu-cuenta.workers.dev
   ```

## 📦 Requisitos

```bash
pip install ccxt pandas streamlit requests
```

## 🚀 Deploy en Streamlit Community Cloud

1. Sube este proyecto a GitHub (ya está en `templario-777/Volumen-369`)
2. En [share.streamlit.io](https://share.streamlit.io/):
   - **Repository**: `templario-777/Volumen-369`
   - **Branch**: `main`
   - **Main file path**: `web_binance_bot.py`
3. **Settings → Secrets** - Añade TODAS estas claves:

```
BINANCE_API_KEY=tu_api_key_real
BINANCE_API_SECRET=tu_api_secret_real
CLOUDFLARE_WORKER_URL=https://binance-proxy.tu-cuenta.workers.dev
TELEGRAM_BOT_TOKEN=8433576034:AAECY1icIrGo_wd_xfQZsMbDo2ofd6N2-9o
TELEGRAM_CHAT_ID=6674674335
```

4. **Deploy** y espera a que termine (aprox. 30 seg).

## 📈 Uso

1. **Abre tu app** en Streamlit Cloud.
2. **Rellena tus credenciales** Binance en la barra lateral.
3. Pulsa **"🔍 Seleccionar Top 10"** (se identifican las 10 criptos más líquidas).
4. El bot **monitorea 24/7** y cuando detecta un patrón:
   - Abre una orden REAL en Binance.
   - Envía alerta a Telegram con entrada, SL y TP.
5. **Gestión automática**: Cuando el precio toca TP o SL:
   - Cierra la orden automáticamente.
   - Envía alerta de cierre a Telegram con ganancia/pérdida.

## ⚠️ Seguridad

- **NUNCA subas tus API keys** al repositorio.
- **Usa Streamlit Secrets** para almacenar credenciales.
- **Prueba primero** con montos pequeños (ej. $10 USD por operación).

## 📊 Métricas Disponibles

| Métrica | Descripción |
|----------|--------------|
| Operaciones Activas | Posiciones abiertas con SL/TP en tiempo real |
| Historial | Últimas 10 operaciones cerradas con % ganancia |
| Señales | Detección de BUY/SELL con fuerza (0-100%) |
| RVOL | Volumen relativo vs media 20 períodos |

## 🚀 Avances Recientes

- ✅ Solución única Cloudflare Worker para Error 451
- ✅ Eliminadas otras opciones de proxy (Smartproxy, IPRoyal, etc.)
- ✅ Órdenes 100% REALES en Binance
- ✅ Gestión automática de TP/SL
- ✅ Alertas Telegram vía Cloudflare Worker
- ✅ Panel de historial de operaciones

---

**Repositorio**: https://github.com/templario-777/Volumen-369  
**Soporte**: Solo Cloudflare Worker como proxy

> ⚠️ *Este bot ejecuta órdenes REALES. Opera con precaución y gestiona tu riesgo.*

**Co-Authored-By**: Claude Opus 4.7 <noreply@anthropic.com>
