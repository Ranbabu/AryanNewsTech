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

    // 🟢 TEST ROUTE
    if (url.pathname === "/") {
      return new Response("✅ Worker is running perfectly! xKiro API is ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain", ...corsHeaders }
      });
    }

    // 🖼️ IMAGE PROXY — CDN image की bytes लाने के लिए (Hindi overlay canvas के लिए ज़रूरी)
    if (url.pathname === "/proxy") {
      const target = url.searchParams.get("url");
      if (!target || !target.startsWith("https://")) {
        return new Response(JSON.stringify({ error: "Bad url" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      try {
        const r = await fetch(target);
        const headers = new Headers(r.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        ["content-encoding", "content-length", "cf-cache-status", "server"].forEach(h => headers.delete(h));
        return new Response(r.body, { status: r.status, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Proxy fetch failed: " + e.message }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 🚀 DYNAMIC PROXY — सभी /v1/ routes xKiro पर
    if (url.pathname.startsWith("/v1/")) {
      const targetUrl = "https://api.xkiro.com" + url.pathname + url.search;
      const API_KEY = env.XKIRO_API_KEY;
      if (!API_KEY) {
        return new Response(JSON.stringify({ error: "Cloudflare में XKIRO_API_KEY सेट नहीं है!" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const headers = new Headers();
      headers.set("Content-Type", request.headers.get("Content-Type") || "application/json");
      headers.set("Authorization", `Bearer ${API_KEY}`);
      const init = { method: request.method, headers };
      if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
      try {
        const response = await fetch(targetUrl, init);
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        ["content-encoding", "content-length", "cf-cache-status", "server"].forEach(h => responseHeaders.delete(h));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: `Worker Fetch Error: ${error.message}` }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    return new Response(JSON.stringify({ error: "Route Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
