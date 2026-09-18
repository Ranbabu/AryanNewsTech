// ☁️ CLOUDFLARE WORKERS AI — FLUX (free tier, कोई login/key नहीं)
    if (url.pathname === "/cf/image" && request.method === "POST") {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "Worker में AI binding नहीं है! wrangler.toml में [ai] binding = \"AI\" जोड़ें या Dashboard → Settings → Bindings → Workers AI (variable: AI) ऐड करें" }), {
          status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      let prompt = "";
      try { prompt = (await request.json()).prompt || ""; } catch (e) {
        return new Response(JSON.stringify({ error: "Bad JSON body" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }
      const models = ["@cf/flux-1-schnell", "@cf/stabilityai/stable-diffusion-xl-base-1.0"];
      let lastErr = null;
      for (const m of models) {
        try {
          const out = await env.AI.run(m, { prompt, width: 1024, height: 576 });
          const b64 = Array.isArray(out.images) ? out.images[0] : (out.image || null);
          if (b64) {
            return new Response(JSON.stringify({ b64, mimeType: "image/png" }), {
              status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
        } catch (e) { lastErr = e; }
      }
      return new Response(JSON.stringify({ error: `Workers AI error: ${lastErr ? lastErr.message : "image नहीं मिली"}` }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
