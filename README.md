# Volumen-369

Bot web de analisis y ejecucion de ordenes para Binance usando Streamlit.

## Requisitos

- Python 3.10+
- Dependencias en `requirements.txt`

## Ejecucion local

```bash
pip install -r requirements.txt
streamlit run web_binance_bot.py
```

## Deploy en Streamlit Community Cloud

1. Sube este proyecto a GitHub.
2. Entra a https://share.streamlit.io/
3. Crea una nueva app y selecciona:
   - Repositorio: `templario-777/Volumen-369`
   - Branch: `main`
   - Main file path: `web_binance_bot.py`
4. En `Advanced settings > Secrets`, agrega tus llaves de Binance si quieres usarlas fuera del navegador.

Notas:
- Nunca subas tus API keys al repositorio.
- Usa `testnet` para pruebas antes de operar en real.
