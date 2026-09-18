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
      return new Response("✅ Worker is running perfectly! xKiro + Gemini + Cloudflare FLUX (Workers AI) ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain", ...corsHeaders }
      });
    }

    // ============================================================
    // ☁️ CLOUDFLARE WORKERS AI — FLUX (FREE tier, कोई login/key नहीं)
    // POST /cf/image  {prompt}
    // ============================================================
    if (url.pathname === "/cf/image" && request.method === "POST") {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "Worker में AI binding नहीं है! wrangler.toml में [ai] binding = \"AI\" जोड़कर दोबारा deploy करें" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let prompt = "";
      try {
        prompt = (await request.json()).prompt || "";
      } catch (e) {
        return new Response(JSON.stringify({ error: "Bad JSON body" }), {
          status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      if (!prompt) {
        return new Response(JSON.stringify({ error: "prompt खाली है" }), {
          status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const models = ["@cf/flux-1-schnell", "@cf/stabilityai/stable-diffusion-xl-base-1.0"];
      let lastErr = null;
      for (const m of models) {
        try {
          const out = await env.AI.run(m, { prompt: prompt, width: 1024, height: 576 });
          const b64 = Array.isArray(out.images) ? out.images[0] : (out.image || null);
          if (b64) {
            return new Response(JSON.stringify({ b64: b64, mimeType: "image/png" }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          lastErr = new Error(m + ": image वापस नहीं मिली");
        } catch (e) {
          lastErr = e;
        }
      }
      return new Response(JSON.stringify({ error: `Workers AI error: ${lastErr ? lastErr.message : "unknown"}` }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // ============================================================
    // 🍌 GEMINI IMAGE ROUTE (Google AI Studio FREE tier)
    // POST /gemini/image?model=gemini-3.1-flash-image  {prompt}
    // ============================================================
    if (url.pathname === "/gemini/image" && request.method === "POST") {
      const GEMINI_KEY = env.GEMINI_API_KEY;
      if (!GEMINI_KEY) {
        return new Response(JSON.stringify({ error: "Cloudflare में GEMINI_API_KEY secret सेट नहीं है! (Google AI Studio से फ्री key लेकर secret जोड़ें)" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      const model = url.searchParams.get("model") || "gemini-3.1-flash-image";
      let prompt = "";
      try {
        const body = await request.json();
        prompt = body.prompt || "";
      } catch (e) {
        return new Response(JSON.stringify({ error: "Bad JSON body" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      if (!prompt) {
        return new Response(JSON.stringify({ error: "prompt खाली है" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      try {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": GEMINI_KEY,
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                imageConfig: { aspectRatio: "16:9" },
              },
            }),
          }
        );
        const d = await upstream.json();
        if (d.error) {
          return new Response(JSON.stringify({ error: d.error.message || "Gemini error" }), {
            status: upstream.status,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const cand = d.candidates && d.candidates[0];
        const parts = (cand && cand.content && cand.content.parts) || [];
        const imgPart = parts.find(p => p.inlineData && p.inlineData.data);
        if (!imgPart) {
          const reason = (cand && cand.finishReason) || "unknown";
          return new Response(JSON.stringify({ error: `Gemini ने image नहीं लौटाई (finishReason: ${reason})` }), {
            status: 502,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        return new Response(JSON.stringify({ b64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || "image/png" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Gemini fetch error: ${e.message}` }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 🖼️ IMAGE PROXY — CDN bytes के लिए
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

    // 🚀 DYNAMIC PROXY — सभी /v1/ routes xKiro पर (chat, images/generations, polling)
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
