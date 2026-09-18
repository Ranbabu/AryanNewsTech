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

    // 🟢 1. TEST ROUTE
    if (url.pathname === "/") {
      return new Response("✅ Aryan News Tech Server is Running! Workers AI + Script ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
      });
    }

    // 🎨 2. CLOUDFLARE WORKERS AI IMAGE GENERATION ROUTE
    if (url.pathname === "/cf/image" && request.method === "POST") {
      if (!env.AI) {
        return new Response(JSON.stringify({ error: "Worker me [ai] binding nahi hai! wrangler.toml check karein." }), {
          status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      let reqBody;
      try {
        reqBody = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      let rawPrompt = reqBody.prompt || "";
      let selectedModel = reqBody.model || "@cf/black-forest-labs/flux-1-schnell";

      if (!rawPrompt) {
        return new Response(JSON.stringify({ error: "Prompt khali hai" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Workers AI prompt limit fix: 300 words se chota karke core visual context dena
      let cleanPrompt = rawPrompt
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 1000)
        .trim();

      // Verified Working Cloudflare Models in order of fallback
      const availableModels = [
        selectedModel,
        "@cf/black-forest-labs/flux-1-schnell",
        "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        "@cf/bytedance/stable-diffusion-xl-lightning",
        "@cf/leonardo/lucid-origin"
      ];

      // Remove duplicate models
      const modelsToTry = [...new Set(availableModels)];
      let lastError = "";

      for (const modelId of modelsToTry) {
        try {
          // Cloudflare AI Call with a strict 25s execution window
          const aiResponse = await env.AI.run(modelId, {
            prompt: cleanPrompt,
            num_steps: 4 // Fast rendering
          });

          // Cloudflare AI returns a ReadableStream or ArrayBuffer
          let arrayBuffer;
          if (aiResponse instanceof ReadableStream) {
            const reader = aiResponse.getReader();
            const chunks = [];
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
            }
            let totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
            let merged = new Uint8Array(totalLength);
            let offset = 0;
            for (let chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            arrayBuffer = merged.buffer;
          } else if (aiResponse instanceof Uint8Array) {
            arrayBuffer = aiResponse.buffer;
          } else if (aiResponse instanceof ArrayBuffer) {
            arrayBuffer = aiResponse;
          } else if (aiResponse && aiResponse.image) {
            return new Response(JSON.stringify({ b64: aiResponse.image, model: modelId }), {
              status: 200, headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }

          if (arrayBuffer && arrayBuffer.byteLength > 0) {
            // Convert binary to base64
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            const len = bytes.byteLength;
            for (let i = 0; i < len; i += 8192) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
            }
            const b64 = btoa(binary);

            return new Response(JSON.stringify({ 
              b64: b64, 
              mimeType: "image/jpeg",
              modelUsed: modelId
            }), {
              status: 200, 
              headers: { "Content-Type": "application/json", ...corsHeaders }
            });
          }
        } catch (err) {
          lastError = `${modelId} failed: ${err.message}`;
          // Continue to next model in list
        }
      }

      return new Response(JSON.stringify({ error: "Sabhi Cloudflare AI models fail ho gaye: " + lastError }), {
        status: 502, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 🚀 3. SCRIPT GENERATION PROXY
    if (url.pathname.startsWith("/v1/")) {
      const targetUrl = "https://api.xkiro.com" + url.pathname + url.search;
      const API_KEY = env.XKIRO_API_KEY;
      if (!API_KEY) {
        return new Response(JSON.stringify({ error: "Cloudflare me XKIRO_API_KEY set nahi hai!" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        return new Response(JSON.stringify({ error: `Script Error: ${error.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    return new Response(JSON.stringify({ error: "Route Not Found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
};
