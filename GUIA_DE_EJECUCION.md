# 🚀 GUÍA RÁPIDA - Ejecutar la Plataforma

## 📋 Paso 1: Instalar dependencias del Backend

Abre una terminal en la carpeta del proyecto y ejecuta:

```bash
pip install -r requirements-backend.txt
```


## ⚙️ Paso 2: Configurar tu API Key de NVIDIA

1. Abre el archivo `backend.py`
2. Encuentra la línea:
   ```python
   NVIDIA_API_KEY = "TU_API_KEY_AQUI"
   ```
3. Reemplaza `TU_API_KEY_AQUI` con tu API Key real (obténla en [build.nvidia.com](https://build.nvidia.com/))


## 🏃 Paso 3: Ejecutar el Backend

En la terminal, ejecuta:

```bash
python backend.py
```

Deberías ver:
```
🚀 Backend iniciado en http://localhost:5000
```


## 📱 Paso 4: Abrir la Plataforma

Abre `preview.html` en tu navegador (o usa el servidor local que ya tienes corriendo).


## 🎉 ¡Listo!

- Ahora puedes escribir cualquier par de trading
- El chat de IA analizará el mercado usando NVIDIA
- El diseño es completamente responsive (se adapta a cualquier pantalla)
