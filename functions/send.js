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

export async function onRequest(context) {
  const { request } = context;
  const corsHeaders = getCorsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "POST only",
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }

  try {
    const data = await request.json();

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Cloudflare Pages Function /send reached successfully",
        received: {
          tokenExists: !!data.token,
          title: data.title || "",
          body: data.body || "",
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}
