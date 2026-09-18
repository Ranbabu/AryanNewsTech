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

    // 📋 CATALOG ROUTE (optional secrets हों तो)
    if (url.pathname === "/cf/models") {
      const tok = env.CF_API_TOKEN, acc = env.CF_ACCOUNT_ID;
      if (!tok || !acc) {
        return new Response(JSON.stringify({ error: "CF_API_TOKEN/CF_ACCOUNT_ID secrets सेट नहीं हैं। Dashboard → Workers AI → Models में IDs देखें" }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      try {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/models/search?per_page=200`, {
          headers: { Authorization: `Bearer ${tok}` }
        });
        const d = await r.json();
        const list = (d.result || [])
          .filter(m => ((m.task && m.task.name) || "") === "Text to Image" || /image|flux|diffusion|lucid|pruna|qwen|grok/i.test(m.name || ""))
          .map(m => m.name);
        return new Response(JSON.stringify({ models: list }), {
          status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "catalog fetch error: " + e.message }), {
          status: 502, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // ============================================================
    // ☁️ WORKERS AI IMAGE — आपके account वाली IDs (Hindi-text वाले पहले)
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

      const cfg = String(env.CF_IMAGE_MODELS || "").split(",").map(s => s.trim()).filter(Boolean);
      const defaults = [
        "openai/gpt-image-2.5-flare",
        "openai/gpt-image-2.5-sunburst",
        "alibaba/qwen-image-3.0-pro",
        "xai/grok-imagine-image-quality",
        "@cf/leonardo/lucid-origin",
        "pruna/p-image",
        "black-forest-labs/flux-1-kontext-max",
        "@cf/stabilityai/stable-diffusion-xl-base-1.0"
      ];
      const bases = cfg.length ? cfg : defaults;

      const candidates = [];
      for (const b of bases) {
        candidates.push(b);
        if (!b.startsWith("@cf/")) candidates.push("@cf/" + b);
      }

      let shortPrompt = prompt;
      if (shortPrompt.length > 400) shortPrompt = shortPrompt.slice(0, 400).replace(/\s+\S*$/, "");

      const errs = [];
      for (const m of candidates) {
        /* पहले 16:9 size से, fail हो तो default size से */
        const inputs = [{ prompt: shortPrompt, width: 1024, height: 576 }, { prompt: shortPrompt }];
        let got = false;
        for (const input of inputs) {
          try {
            const out = await env.AI.run(m, input);
            const b64 = extractB64(out);
            if (b64) {
              return new Response(JSON.stringify({ b64: b64, mimeType: "image/png" }), {
                status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
              });
            }
            errs.push(m + ": keys=[" + Object.keys(out || {}).join(",") + "]");
            got = true; /* model चला था, image खाली → default size आज़माओ */
          } catch (e) {
            errs.push(m + ": " + (e && e.message ? e.message : String(e)));
            if (/5007|no such model/i.test(e && e.message ? e.message : "")) break; /* यह ID exists ही नहीं → अगली ID */
          }
        }
        if (got) continue;
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
