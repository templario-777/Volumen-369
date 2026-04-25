export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("target");

    if (!target) {
      return new Response("Error: Falta el parámetro ?target=", { 
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    try {
      const targetUrl = new URL(target);
      
      // Construir la URL de destino preservando el path del worker pero quitando el parámetro 'target'
      const newSearch = new URLSearchParams(url.search);
      newSearch.delete("target");
      
      targetUrl.pathname = url.pathname === "/" ? targetUrl.pathname : url.pathname;
      targetUrl.search = newSearch.toString();

      // Clonar headers y limpiar los que dan problemas
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cf-connecting-ip");
      headers.delete("cf-worker");
      headers.delete("cf-ray");
      headers.delete("cf-visitor");

      const init = {
        method: request.method,
        headers,
        redirect: "follow",
      };

      // Manejar el cuerpo de la petición si no es GET o HEAD
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }

      const response = await fetch(targetUrl.toString(), init);
      
      // Clonar la respuesta para poder modificar headers de CORS si fuera necesario
      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      newHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });

    } catch (e) {
      return new Response("Error de Proxy: " + e.message, { status: 500 });
    }
  },
};
