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
      return new Response("✅ Worker is running perfectly! xKiro + Cloudflare FLUX (Workers AI) ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
      });
    }

    // ============================================================
    // ☁️ CLOUDFLARE WORKERS AI — multi-model + detailed errors
    // POST /cf/image  {prompt}
    // ============================================================
    if (url.pathname === "/cf/image" && request.method === "POST") {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "Worker में AI binding नहीं है! wrangler.toml में [ai] binding = \"AI\" जोड़कर deploy करें" }), {
          status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let prompt = "";
      try { prompt = (await request.json()).prompt || ""; } catch (e) {
        return new Response(JSON.stringify({ error: "Bad JSON body" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      if (!prompt) {
        return new Response(JSON.stringify({ error: "prompt खाली है" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      const tries = [
        ["@cf/flux-1-schnell", { prompt: prompt, width: 1024, height: 576 }],
        ["@cf/flux-1-schnell", { prompt: prompt }],
        ["@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt: prompt, width: 1024, height: 576 }],
        ["@cf/stabilityai/stable-diffusion-xl-base-1.0", { prompt: prompt }],
        ["@cf/lykon/dreamshaper-8-lcm", { prompt: prompt, width: 1024, height: 576 }]
      ];
      const errs = [];
      for (const [m, input] of tries) {
        try {
          const out = await env.AI.run(m, input);
          const b64 = (out && Array.isArray(out.images)) ? out.images[0] : (out && out.image ? out.image : null);
          if (b64) {
            return new Response(JSON.stringify({ b64: b64, mimeType: "image/png" }), {
              status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          errs.push(m + ": response में image नहीं थी");
        } catch (e) {
          errs.push(m + ": " + (e && e.message ? e.message : String(e)));
        }
      }
      return new Response(JSON.stringify({ error: "Workers AI सभी मॉडल fail: " + errs.join(" | ") }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 🖼️ IMAGE PROXY
    if (url.pathname === "/proxy") {
      const target = url.searchParams.get("url");
      if (!target || !target.startsWith("https://")) {
        return new Response(JSON.stringify({ error: "Bad url" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      try {
        const r = await fetch(target);
        const headers = new Headers(r.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        ["content-encoding", "content-length", "cf-cache-status", "server"].forEach(h => headers.delete(h));
        return new Response(r.body, { status: r.status, headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Proxy fetch failed: ${e.message}` }), { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    // 🚀 DYNAMIC PROXY — /v1/ routes xKiro पर (सिर्फ़ chat के लिए)
    if (url.pathname.startsWith("/v1/")) {
      const targetUrl = "https://api.xkiro.com" + url.pathname + url.search;
      const API_KEY = env.XKIRO_API_KEY;
      if (!API_KEY) {
        return new Response(JSON.stringify({ error: "Cloudflare में XKIRO_API_KEY सेट नहीं है!" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
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
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
      } catch (error) {
        return new Response(JSON.stringify({ error: `Worker Fetch Error: ${error.message}` }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
    }

    return new Response(JSON.stringify({ error: "Route Not Found" }), { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};
