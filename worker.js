export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");

    if (!target) {
      return new Response("Falta ?target=https://api.binance.com (ejemplo)", { status: 400 });
    }

    // Eliminar el parámetro target de la URL para no pasarle a Binance
    url.searchParams.delete("target");

    const targetUrl = new URL(target);
    targetUrl.pathname = url.pathname;
    targetUrl.search = url.search;

    const headers = new Headers(request.headers);
    headers.delete("host");

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    };

    const response = await fetch(targetUrl.toString(), init);
    
    // Crear una nueva respuesta para modificar headers
    const newResponse = new Response(response.body, response);
    
    // Añadir headers CORS para que el frontend funcione
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newResponse.headers.set('Access-Control-Allow-Headers', '*');

    return newResponse;
  },
};
