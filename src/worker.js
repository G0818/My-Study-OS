const allowedOrigins = [
  "https://g0818.github.io",
  "https://my-study-os-push.ganghealthy.workers.dev"
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");

  const allowOrigin = allowedOrigins.includes(origin)
    ? origin
    : "https://g0818.github.io";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    if (url.pathname === "/send") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method !== "POST") {
        return json(
          {
            ok: false,
            error: "POST only",
          },
          405,
          corsHeaders
        );
      }

      try {
        const data = await request.json();

        return json(
          {
            ok: true,
            message: "Worker /send reached successfully",
            received: {
              tokenExists: !!data.token,
              title: data.title || "",
              body: data.body || "",
            },
          },
          200,
          corsHeaders
        );
      } catch (err) {
        return json(
          {
            ok: false,
            error: String(err),
          },
          500,
          corsHeaders
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
