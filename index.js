function extractB64(out) {
  if (!out) return null;
  if (typeof out === "string") return out;
  if (out instanceof ArrayBuffer) out = new Uint8Array(out);
  if (out instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < out.length; i += 8192) bin += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
    return btoa(bin);
  }
  if (Array.isArray(out)) { for (const x of out) { const b = extractB64(x); if (b) return b; } return null; }
  if (typeof out === "object") {
    if (Array.isArray(out.images)) { const b = extractB64(out.images[0]); if (b) return b; }
    if (out.image) { const b = extractB64(out.image); if (b) return b; }
    if (out.b64) return out.b64;
    if (out.result) { const b = extractB64(out.result); if (b) return b; }
    if (out.output) { const b = extractB64(out.output); if (b) return b; }
    // Handle standard CF AI response structure specifically
    if (out.data && Array.isArray(out.data) && out.data.length > 0) {
       return extractB64(out.data[0]);
    }
  }
  return null;
}

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
      return new Response("✅ Worker is running perfectly! xKiro chat + Cloudflare Workers AI ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
      });
    }

    // ============================================================
    // ☁️ WORKERS AI IMAGE — Optimized for Stability
    // POST /cf/image  {prompt}
    // ============================================================
    if (url.pathname === "/cf/image" && request.method === "POST") {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "Worker में AI binding नहीं है! wrangler.toml में [ai] binding = \"AI\" जोड़कर deploy करें" }), {
          status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      
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

      // Primary Model: Flux Schnell (Fastest & Most Stable Free Option)
      // Fallback Models if needed (commented out for speed/reliability focus as requested)
      const modelsToTry = [
        "@cf/black-forest-labs/flux-1-schnell"
        // If you want more fallbacks later, uncomment these:
        // "@cf/stabilityai/stable-diffusion-xl-base-1.0"
      ];

      const errs = [];
      
      for (const m of modelsToTry) {
        try {
          // Note: Some models require specific input formats. 
          // Flux usually accepts { prompt: string }
          const inputs = { prompt: prompt };
          
          // Add dimensions if supported by the model wrapper, otherwise keep simple
          // CF AI often handles resizing internally or ignores extra params gracefully
          
          const out = await env.AI.run(m, inputs);
          
          const b64 = extractB64(out);
          if (b64) {
            return new Response(JSON.stringify({ 
              b64: b64, 
              mimeType: "image/png", 
              model: m 
            }), {
              status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
          
          // Log detailed error if no b64 found
          errs.push(`${m}: No image data returned. Keys: ${Object.keys(out||{}).join(',')}`);
          
        } catch (e) {
          const msg = (e && e.message) ? e.message : String(e);
          errs.push(`${m}: ${msg}`);
          
          // If it's a "model not found" or quota error, we might break early 
          // but since we only have one main model now, we just log and exit loop
          if (/quota|limit/i.test(msg)) {
             return new Response(JSON.stringify({ error: `Cloudflare Quota Exceeded for ${m}. Try again after 1 hour.` }), {
               status: 429, headers: { "Content-Type": "application/json", ...corsHeaders }
             });
          }
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

    // 🚀 DYNAMIC PROXY — /v1/ routes xKiro पर (script chat)
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
