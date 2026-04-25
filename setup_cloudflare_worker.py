#!/usr/bin/env python3
"""
Script para crear/actualizar un Cloudflare Worker que actúa como proxy para Binance.
Uso: python setup_cloudflare_worker.py
Requiere: CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID en Streamlit Secrets o env vars.
"""
import os
import json
import requests
from datetime import datetime

def crear_worker():
    # Obtener credenciales explícitas o de variable de entorno
    api_token = os.getenv("CLOUDFLARE_API_TOKEN")
    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")

    if not api_token or not account_id or "Pega_aqui" in account_id:
        # Intentar leer del archivo .env directamente
        try:
            with open(".env", "r") as f:
                for line in f:
                    if "CLOUDFLARE_API_TOKEN=" in line:
                        api_token = line.split("=")[1].strip()
                    if "CLOUDFLARE_ACCOUNT_ID=" in line:
                        account_id = line.split("=")[1].strip()
        except:
            pass

    if not api_token or not account_id or "Pega_aqui" in account_id:
        print("❌ Error: No se encontraron las credenciales de Cloudflare.")
        print("   Asegúrate de que CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID")
        print("   estén configurados correctamente.")
        return False

    # Leer el código del Worker desde el archivo bot_worker.js
    try:
        with open("bot_worker.js", "r", encoding="utf-8") as f:
            worker_script = f.read()
    except Exception as e:
        print(f"❌ Error leyendo bot_worker.js: {e}")
        return False

    # URL de la API de Cloudflare
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/volumen-369-bot"

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/javascript"
    }

    print(f"🔗 Desplegando Bot Autónomo 'volumen-369-bot' en cuenta {account_id[:8]}...")

    try:
        resp = requests.put(
            url,
            headers=headers,
            data=worker_script,
            timeout=30
        )

        if resp.status_code in [200, 201]:
            result = resp.json()
            if result.get("success"):
                worker_url = f"https://volumen-369-bot.{account_id}.workers.dev"
                print(f"✅ Bot desplegado exitosamente!")
                print(f"🌐 URL del Bot: {worker_url}")
                print("\n🔔 PASO IMPORTANTE:")
                print("1. Ve a Cloudflare Dashboard -> Workers & Pages -> volumen-369-bot")
                print("2. Ve a 'Triggers' -> 'Cron Triggers' -> 'Add Cron Trigger'")
                print("3. Configura: */5 * * * * (Cada 5 minutos)")
                print("4. Asegúrate de añadir tus variables de entorno en 'Settings' -> 'Variables':")
                print("   - BINANCE_API_KEY")
                print("   - BINANCE_API_SECRET")
                print("   - TELEGRAM_BOT_TOKEN")
                print("   - TELEGRAM_CHAT_ID")
                return worker_url
            else:
                print(f"❌ Error de API: {result.get('errors', 'Desconocido')}")
                return False
        else:
            print(f"❌ Error HTTP {resp.status_code}: {resp.text}")
            return False

    except Exception as e:
        print(f"❌ Excepción: {e}")
        return False

if __name__ == "__main__":
    print(f"🚀 Configurando Cloudflare Worker - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("-" * 50)
    result = crear_worker()
    if result:
        print("-" * 50)
        print("🎉 ¡Listo! Ahora añade la URL en tus Streamlit Secrets.")
    else:
        print("\n⚠️ Revisa tus credenciales e intenta de nuevo.")