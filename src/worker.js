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

async function sendFcmMessage(env, token, title, body, tag = "my-study-os") {
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

            // 알림 종류를 구분해서 같은 알림이 겹치지 않게 함
            tag,
            renotify: true
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

async function sendFcmToTokens(env, tokens, title, body, tag = "my-study-os") {
  const uniqueTokens = [...new Set(tokens || [])].filter(Boolean);
  const results = [];

  for (const token of uniqueTokens) {
    try {
      const result = await sendFcmMessage(env, token, title, body, tag);
      results.push({
        ok: true,
        tokenEnd: token.slice(-8),
        result
      });
    } catch (err) {
      results.push({
        ok: false,
        tokenEnd: token.slice(-8),
        error: String(err)
      });
    }
  }

  return results;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // ✅ Worker 작동 확인용
    if (url.pathname === "/__debug") {
      return json(
        {
          ok: true,
          message: "worker is running",
          path: url.pathname,
          hasAlarmsBinding: !!env.ALARMS,
          hasAssetsBinding: !!env.ASSETS
        },
        200,
        corsHeaders
      );
    }

    // ✅ 즉시 푸시 발송
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

    // ✅ 알림 예약 저장
    if (url.pathname === "/schedule") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method !== "POST") {
        return json(
          { ok: false, error: "POST only" },
          405,
          corsHeaders
        );
      }

      try {
        const data = await request.json();

        const userId = data.userId;

        // ✅ 지금 V8.html은 token 1개를 보내고 있음.
        // ✅ 나중에 tokens 배열을 보내도 받을 수 있게 둘 다 지원.
        const incomingTokens = Array.isArray(data.tokens)
          ? data.tokens.filter(Boolean)
          : (data.token ? [data.token] : []);
        
        const studyReminderTime = data.studyReminderTime || "";
        const ddayReminderTime = data.ddayReminderTime || "";
        const ddayItems = Array.isArray(data.ddayItems) ? data.ddayItems : [];
        const timezone = data.timezone || "Asia/Seoul";
        
        if (!userId || incomingTokens.length === 0) {
          return json(
            { ok: false, error: "userId and token/tokens are required" },
            400,
            corsHeaders
          );
        }
        
        if (!env.ALARMS) {
          return json(
            { ok: false, error: "ALARMS KV binding is missing" },
            500,
            corsHeaders
          );
        }
        
        const alarmKey = `alarm:${userId}`;
        
        let previous = {};
        try {
          const oldRaw = await env.ALARMS.get(alarmKey);
          previous = oldRaw ? JSON.parse(oldRaw) : {};
        } catch {
          previous = {};
        }
        
        // ✅ 기존에 저장되어 있던 토큰들 가져오기
        // 예전 구조의 previous.token도 같이 살림
        const previousTokens = Array.isArray(previous.tokens)
          ? previous.tokens
          : (previous.token ? [previous.token] : []);
        
        // ✅ 기존 토큰 + 이번에 접속한 기기 토큰 합치기
        const mergedTokens = [...new Set([
          ...previousTokens,
          ...incomingTokens
        ])].filter(Boolean);
        
        await env.ALARMS.put(
          alarmKey,
          JSON.stringify({
            userId,
        
            // ✅ 이제부터는 여러 기기용 tokens 배열로 저장
            tokens: mergedTokens,
        
            studyReminderTime,
            ddayReminderTime,
            ddayItems,
            timezone,
            updatedAt: Date.now(),
        
            // ✅ 기존 발송 기록 유지
            lastStudySentKey: previous.lastStudySentKey || "",
            lastDdaySentKey: previous.lastDdaySentKey || ""
          })
        );
        
        return json(
          {
            ok: true,
            message: "Alarm schedule saved",
            tokenCount: mergedTokens.length
          },
          200,
          corsHeaders
        );
      } catch (err) {
        return json(
          { ok: false, error: String(err) },
          500,
          corsHeaders
        );
      }
    }

    // ✅ 나머지는 정적 파일로 넘김
    return env.ASSETS.fetch(request);
  },

  // ✅ Cron Trigger가 호출하는 함수
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlarmCron(env));
  }
};

function getKoreaNowParts() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const obj = {};
  parts.forEach(p => {
    if (p.type !== "literal") obj[p.type] = p.value;
  });

  return {
    date: `${obj.year}-${obj.month}-${obj.day}`,
    time: `${obj.hour}:${obj.minute}`
  };
}

function getTomorrowKoreaDateStr() {
  const now = new Date();
  const koreaNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  koreaNow.setDate(koreaNow.getDate() + 1);

  const y = koreaNow.getFullYear();
  const m = String(koreaNow.getMonth() + 1).padStart(2, "0");
  const d = String(koreaNow.getDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

async function runAlarmCron(env) {
  const list = await env.ALARMS.list({ prefix: "alarm:" });
  const { date: todayStr, time: nowHHMM } = getKoreaNowParts();
  const tomorrowStr = getTomorrowKoreaDateStr();

  for (const key of list.keys) {
    const raw = await env.ALARMS.get(key.name);
    if (!raw) continue;

    let alarm;
    try {
      alarm = JSON.parse(raw);
    } catch {
      continue;
    }

    let changed = false;

    // 공부 시작 알림
    const studySentKey = `${todayStr}|${alarm.studyReminderTime}`;

    if (
      alarm.studyReminderTime &&
      alarm.studyReminderTime === nowHHMM &&
      alarm.lastStudySentKey !== studySentKey
    ) {
      try {
        await sendFcmToTokens(
          env,
          alarm.tokens || (alarm.token ? [alarm.token] : []),
          "My Study OS - 공부 시작",
          "정해둔 공부 시작 시간이예요. 오늘도 한 번 달려볼까요?"
        );

        alarm.lastStudySentKey = studySentKey;
        changed = true;
      } catch (err) {
        console.log("study alarm send failed", key.name, String(err));
      }
    }

    // D-Day 하루 전 알림
    const ddaySentKey = `${todayStr}|${alarm.ddayReminderTime}`;

    if (
      alarm.ddayReminderTime &&
      alarm.ddayReminderTime === nowHHMM &&
      alarm.lastDdaySentKey !== ddaySentKey
    ) {
      const tomorrowDdays = (alarm.ddayItems || []).filter(
        item => item.date === tomorrowStr
      );

      if (tomorrowDdays.length > 0) {
        const titles = tomorrowDdays.map(x => x.title).join(", ");

        try {
          await sendFcmToTokens(
            env,
            alarm.tokens || (alarm.token ? [alarm.token] : []),
            "My Study OS - D-Day",
            `내일은 "${titles}" D-Day 입니다!`
          );

          alarm.lastDdaySentKey = ddaySentKey;
          changed = true;
        } catch (err) {
          console.log("dday alarm send failed", key.name, String(err));
        }
      }
    }

    if (changed) {
      await env.ALARMS.put(key.name, JSON.stringify(alarm));
    }
  }
}
