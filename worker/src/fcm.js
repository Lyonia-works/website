// Firebase Cloud Messaging: one message to a topic, and topic membership for browser tokens.

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function b64url(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem) {
  const raw = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// OAuth access token for the service account, from a self-signed JWT.
async function googleToken(env) {
  const cached = await env.LIVE.get("google-token");
  if (cached) return cached;
  const sa = JSON.parse(env.FIREBASE_SA);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token: ${res.status}`);
  const { access_token, expires_in } = await res.json();
  await env.LIVE.put("google-token", access_token, { expirationTtl: Math.max(60, expires_in - 300) });
  return access_token;
}

export async function notifyLive(env, state) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleToken(env)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        topic: env.FCM_TOPIC,
        webpush: {
          headers: { Urgency: "high", TTL: "3600" },
          notification: {
            title: "Lyonia is live",
            body: state.game ? `Now playing ${state.game}` : state.title || "Come say hi on Twitch",
            icon: `${env.SITE_URL}/assets/icon-192.png`,
            tag: "lyonia-live",
          },
          fcm_options: { link: env.TWITCH_URL },
        },
      },
    }),
  });
  if (!res.ok) throw new Error(`FCM send: ${res.status} ${await res.text()}`);
}

// Returns null on success, or the push service's error code for this token.
export async function setTopic(env, token, subscribe) {
  const res = await fetch(`https://iid.googleapis.com/iid/v1:${subscribe ? "batchAdd" : "batchRemove"}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await googleToken(env)}`,
      "Content-Type": "application/json",
      access_token_auth: "true",
    },
    body: JSON.stringify({ to: `/topics/${env.FCM_TOPIC}`, registration_tokens: [token] }),
  });
  if (!res.ok) throw new Error(`Topic ${subscribe ? "add" : "remove"}: ${res.status} ${await res.text()}`);
  const { results } = await res.json();
  return results?.[0]?.error || null;
}
