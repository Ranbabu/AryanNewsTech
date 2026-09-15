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

    // राउटिंग सेटअप
    let targetUrl = "";
    if (url.pathname === "/v1/chat/completions") {
      targetUrl = "https://api.xkiro.com/v1/chat/completions";
    } else if (url.pathname === "/v1/audio/speech") {
      targetUrl = "https://api.xkiro.com/v1/audio/speech";
    } else {
      return new Response(JSON.stringify({ error: "Route Not Found" }), { 
        status: 404, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // Cloudflare Secrets से API Key उठाना
    const API_KEY = env.XKIRO_API_KEY;

    if (!API_KEY) {
      return new Response(JSON.stringify({ error: "Cloudflare में XKIRO_API_KEY सेट नहीं है!" }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // xKiro को फाइनल रिक्वेस्ट भेजना
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
      
      // वापस जाते समय रिस्पॉन्स में CORS हेडर लगाना
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: `Worker Fetch Error: ${error.message}` }), { 
        status: 500, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }
  }
};
