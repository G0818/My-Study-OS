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

function base64UrlEncode(input) {
  let bytes;

  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }

  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const cleanPem = pem
    .replace(/\\n/g, "\n")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binary = atob(cleanPem);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function createJwt(env) {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claimSet = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
  const unsignedJwt = `${encodedHeader}.${encodedClaimSet}`;

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedJwt)
  );

  return `${unsignedJwt}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(env) {
  const jwt = await createJwt(env);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`OAuth token error: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

async function sendFcmMessage(env, token, title, body) {
  const accessToken = await getAccessToken(env);

  const url = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title,
          body,
        },
        webpush: {
          notification: {
            title,
            body,
            icon: "https://g0818.github.io/My-Study-OS/icon-192.png",
          },
        },
      },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`FCM send error: ${JSON.stringify(data)}`);
  }

  return data;
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

        const token = data.token;
        const title = data.title || "My Study OS";
        const body = data.body || "알림입니다.";

        if (!token) {
          return json(
            {
              ok: false,
              error: "token is required",
            },
            400,
            corsHeaders
          );
        }

        if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
          return json(
            {
              ok: false,
              error: "Firebase secrets are missing",
            },
            500,
            corsHeaders
          );
        }

        const fcmResult = await sendFcmMessage(env, token, title, body);

        return json(
          {
            ok: true,
            message: "FCM push sent successfully",
            fcmResult,
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
