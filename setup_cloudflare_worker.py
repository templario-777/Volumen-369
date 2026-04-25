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
    # Obtener credenciales de Streamlit Secrets o variable de entorno
    try:
        import streamlit as st
        api_token = st.secrets.get("CLOUDFLARE_API_TOKEN", os.getenv("CLOUDFLARE_API_TOKEN"))
        account_id = st.secrets.get("CLOUDFLARE_ACCOUNT_ID", os.getenv("CLOUDFLARE_ACCOUNT_ID"))
    except:
        api_token = os.getenv("CLOUDFLARE_API_TOKEN")
        account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID")

    if not api_token or not account_id:
        print("❌ Faltan credenciales:")
        print("   CLOUDFLARE_API_TOKEN")
        print("   CLOUDFLARE_ACCOUNT_ID")
        print("\nAñadelos en Streamlit Secrets o como variables de entorno.")
        return False

    # Código del Worker (proxy para Binance)
    worker_script = """
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
"""

    # URL de la API de Cloudflare
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/binance-proxy"

    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/javascript"
    }

    print(f"🔗 Creando Worker 'binance-proxy' en cuenta {account_id[:8]}...")

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
                worker_url = f"https://binance-proxy.{account_id}.workers.dev"
                print(f"✅ Worker creado exitosamente!")
                print(f"🌐 URL del Worker: {worker_url}")
                print(f"\n📋 Añade esto en Streamlit Secrets:")
                print(f"   CLOUDFLARE_WORKER_URL = {worker_url}")
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