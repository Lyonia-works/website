// Twitch API: app access token, channel lookups, and EventSub signature checks.

const enc = new TextEncoder();
const MAX_AGE_MS = 10 * 60 * 1000;

// EventSub signs id + timestamp + raw body with HMAC-SHA256 under the subscription secret.
export async function verifySignature(secret, headers, body, now = Date.now()) {
  const id = headers.get("Twitch-Eventsub-Message-Id");
  const timestamp = headers.get("Twitch-Eventsub-Message-Timestamp");
  const signature = headers.get("Twitch-Eventsub-Message-Signature") || "";
  const hex = signature.match(/^sha256=([0-9a-f]{64})$/)?.[1];
  if (!id || !timestamp || !hex) return false;
  const age = now - Date.parse(timestamp);
  if (!(age < MAX_AGE_MS && age > -60_000)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const mac = Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
  return crypto.subtle.verify("HMAC", key, mac, enc.encode(id + timestamp + body));
}

async function appToken(env) {
  const cached = await env.LIVE.get("twitch-token");
  if (cached) return cached;
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.TWITCH_CLIENT_ID,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token: ${res.status}`);
  const { access_token, expires_in } = await res.json();
  await env.LIVE.put("twitch-token", access_token, { expirationTtl: Math.max(60, expires_in - 600) });
  return access_token;
}

async function helix(env, path) {
  const res = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { Authorization: `Bearer ${await appToken(env)}`, "Client-Id": env.TWITCH_CLIENT_ID },
  });
  if (!res.ok) throw new Error(`Twitch ${path.split("?")[0]}: ${res.status}`);
  return (await res.json()).data;
}

// The channel's current category and title; set even while offline.
export async function channel(env) {
  const [info] = await helix(env, `channels?broadcaster_id=${env.TWITCH_USER_ID}`);
  return { game: info?.game_name || "", title: info?.title || "" };
}

export async function currentState(env) {
  const [stream] = await helix(env, `streams?user_id=${env.TWITCH_USER_ID}`);
  if (stream) return { live: true, game: stream.game_name, title: stream.title, startedAt: stream.started_at };
  return { live: false, startedAt: null, ...(await channel(env)) };
}
