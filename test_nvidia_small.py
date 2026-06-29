import requests
import json

API_KEY = "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"

print("Probando API de NVIDIA con modelo pequeño...")

url = "https://integrate.api.nvidia.com/v1/chat/completions"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
payload = {
    "model": "meta/llama-3.1-8b-instruct",
    "messages": [
        {"role": "user", "content": "Hola, que tal?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
}

print(f"Enviando solicitud a {url} con modelo meta/llama-3.1-8b-instruct")
try:
    response = requests.post(url, headers=headers, json=payload, timeout=60)
    print(f"Status Code: {response.status_code}")
    print(f"Respuesta: {response.text}")
except Exception as e:
    print(f"Error: {str(e)}")
    import traceback
    traceback.print_exc()
