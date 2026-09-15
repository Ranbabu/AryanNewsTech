export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let targetUrl = "";

    if (url.pathname === "/v1/chat/completions") {
      targetUrl = "https://api.xkiro.com/v1/chat/completions";
    } else if (url.pathname === "/v1/audio/speech") {
      targetUrl = "https://api.xkiro.com/v1/audio/speech";
    } else {
      return new Response("Not Found", { status: 404, headers: corsHeaders });
    }

    // API Key सीधे कोड में नहीं है, यह Cloudflare के Secrets (env) से आएगी
    const API_KEY = env.XKIRO_API_KEY;

    if (!API_KEY) {
      return new Response(JSON.stringify({ error: "API Key Cloudflare में सेट नहीं है!" }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }

    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`
      },
      body: request.body
    });

    try {
      const response = await fetch(newRequest);
      const responseHeaders = new Headers(response.headers);
      
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  }
};
