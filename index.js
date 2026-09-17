export default {
  async fetch(request, env) {
    // CORS Headers ताकि गिटहब वेबसाइट इसे बिना एरर के एक्सेस कर सके
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Preflight (CORS) Request को पास करना
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 🟢 TEST ROUTE: यह चेक करने के लिए कि सर्वर लाइव है या ब्लॉक हो गया है
    if (url.pathname === "/") {
      return new Response("✅ Worker is running perfectly! xKiro API is ready.", {
        status: 200,
        headers: { "Content-Type": "text/plain", ...corsHeaders }
      });
    }

    // ============================================================
    // 🚀 DYNAMIC PROXY — सभी /v1/ routes xKiro पर forward
    // ============================================================
    // यह तरीका पुराने if/else से बेहतर है क्योंकि:
    //   ✅ /v1/chat/completions   → Script generation
    //   ✅ /v1/audio/speech       → TTS audio
    //   ✅ /v1/audio/voices       → Live voice catalog (dropdown fill करने के लिए)
    //   ✅ /v1/images/generations → Thumbnail job create
    //   ✅ /v1/images/generations/{id} → Thumbnail job status check
    //   ✅ भविष्य के सभी xKiro endpoints automatic काम करेंगे
    // ============================================================
    if (url.pathname.startsWith("/v1/")) {
      const targetUrl = "https://api.xkiro.com" + url.pathname + url.search;

      // Cloudflare Secrets से API Key उठाना
      const API_KEY = env.XKIRO_API_KEY;

      if (!API_KEY) {
        return new Response(JSON.stringify({ error: "Cloudflare में XKIRO_API_KEY सेट नहीं है!" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // xKiro को भेजने के लिए headers तैयार करना
      const headers = new Headers();
      headers.set("Content-Type", request.headers.get("Content-Type") || "application/json");
      headers.set("Authorization", `Bearer ${API_KEY}`);

      // GET requests में body नहीं होता, इसलिए सिर्फ POST/PUT के लिए body ले जाना
      const init = {
        method: request.method,
        headers: headers,
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }

      try {
        const response = await fetch(targetUrl, init);
        const responseHeaders = new Headers(response.headers);

        // वापस जाते समय रिस्पॉन्स में CORS हेडर लगाना
        responseHeaders.set("Access-Control-Allow-Origin", "*");

        // Conflict वाले headers हटाएँ जो browser को परेशान कर सकते हैं
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        responseHeaders.delete("cf-cache-status");
        responseHeaders.delete("server");

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

    // Unknown route — 404
    return new Response(JSON.stringify({ error: "Route Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
};
