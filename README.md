# Aether Crypto - Bot Trading Binance 24/7

Este proyecto es un bot de trading para Binance que utiliza:
- Streamlit para la interfaz de usuario
- Cloudflare Worker como proxy
- CCXT para interactuar con la API de Binance
- Telegram para alertas

## Instalación de dependencias

Instala los paquetes necesarios con:
```bash
pip install -r requirements.txt
```

## Configuración

Crea un archivo `.streamlit/secrets.toml` con tus credenciales:
```toml
# Binance
BINANCE_API_KEY = "tu-api-key"
BINANCE_API_SECRET = "tu-api-secret"

# Cloudflare
CLOUDFLARE_API_TOKEN = "tu-token"
CLOUDFLARE_ACCOUNT_ID = "tu-account-id"
CLOUDFLARE_WORKER_URL = "https://binance-proxy.tu-cuenta.workers.dev"

# Telegram (opcional)
TELEGRAM_BOT_TOKEN = "tu-bot-token"
TELEGRAM_CHAT_ID = "tu-chat-id"
```

## Ejecución

Para iniciar el bot:
```bash
streamlit run web_binance_bot.py
```

## Cloudflare Worker

El archivo `wrangler.toml` y `worker.js` están listos para desplegar un proxy a la API de Binance usando Cloudflare Workers.
