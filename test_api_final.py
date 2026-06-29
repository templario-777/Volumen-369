import requests
import json
import time

print("Esperando 2 segundos...")
time.sleep(2)

url = "http://localhost:5000/api/chat"
payload = {
    "message": "Analiza el mercado de BTC y da recomendaciones",
    "symbol": "BINANCE:BTCUSDT"
}

print("Enviando solicitud al backend...")
try:
    response = requests.post(url, json=payload, timeout=60)
    print(f"Status Code: {response.status_code}")
    print(f"Respuesta: {response.text}")
except Exception as e:
    print(f"Error: {str(e)}")
    import traceback
    traceback.print_exc()
