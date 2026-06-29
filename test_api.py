import requests
import json

url = "http://localhost:5000/api/chat"
payload = {
    "message": "Hola, ¿qué puedes hacer?",
    "symbol": "BINANCE:BTCUSDT"
}

print("Probando API...")
response = requests.post(url, json=payload)
print(f"Status: {response.status_code}")
print(f"Respuesta: {response.text}")
