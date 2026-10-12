// Live state for the site's badge, and one go-live notification per stream.

import { channel, currentState, verifySignature } from "./twitch.js";
import { notifyLive, setTopic } from "./fcm.js";

const TOKEN = /^[\w:-]{100,4096}$/;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/status" && request.method === "GET") return status(env, (await getState(env)) || {});
      if (pathname === "/twitch" && request.method === "POST") return await twitch(request, env, ctx);
      if (pathname === "/subscribe" || pathname === "/unsubscribe") {
        if (request.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));
        if (request.method === "POST") return await topic(request, env, pathname === "/subscribe");
      }
      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error(err.stack || String(err));
      return cors(env, new Response("Server error", { status: 500 }));
    }
  },

  // Every 10 minutes: catch up if a Twitch event never arrived.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(currentState(env).then((next) => update(env, next)));
  },
};

async function getState(env) {
  return (await env.LIVE.get("state", "json")) || update(env, await currentState(env));
}

// Twitch event timestamps carry milliseconds and the streams API's do not; compare whole seconds.
export const streamKey = (startedAt) => (startedAt ? Math.floor(Date.parse(startedAt) / 1000) : null);

// Merge new facts into the stored state; send the go-live message once per stream.
export async function update(env, next, notify = notifyLive) {
  const old = await env.LIVE.get("state", "json");
  const key = next.live ? streamKey(next.startedAt) : null;
  const state = { ...old, ...next, notified: old ? (old.notified ?? null) : key };
  const send = key !== null && state.notified !== key;
  if (send) state.notified = key;
  await env.LIVE.put("state", JSON.stringify(state));
  if (send) await notify(env, state);
  return state;
}

async function twitch(request, env, ctx) {
  const body = await request.text();
  if (!(await verifySignature(env.EVENTSUB_SECRET, request.headers, body))) {
    return new Response("Invalid signature", { status: 403 });
  }
  const message = JSON.parse(body);
  const type = request.headers.get("Twitch-Eventsub-Message-Type");
  if (type === "webhook_callback_verification") {
    return new Response(message.challenge, { headers: { "Content-Type": "text/plain" } });
  }
  if (type === "revocation") console.warn("EventSub revoked:", message.subscription.type, message.subscription.status);
  if (type !== "notification") return new Response(null, { status: 204 });

  const id = request.headers.get("Twitch-Eventsub-Message-Id");
  if (await env.LIVE.get(`seen:${id}`)) return new Response(null, { status: 204 });
  await env.LIVE.put(`seen:${id}`, "1", { expirationTtl: 3600 });
  const { subscription, event } = message;
  if (event.broadcaster_user_id === env.TWITCH_USER_ID) {
    ctx.waitUntil(handle(env, subscription.type, event).catch((err) => console.error(err.stack || String(err))));
  }
  return new Response(null, { status: 204 });
}

async function handle(env, type, event) {
  if (type === "stream.online") return update(env, { live: true, startedAt: event.started_at, ...(await channel(env)) });
  if (type === "stream.offline") return update(env, { live: false, startedAt: null });
  if (type === "channel.update") return update(env, { game: event.category_name, title: event.title });
}

async function topic(request, env, subscribe) {
  const text = await request.text();
  let token;
  try {
    ({ token } = text.length <= 8192 ? JSON.parse(text) : {});
  } catch {
    token = null;
  }
  if (typeof token !== "string" || !TOKEN.test(token)) return cors(env, new Response("Invalid token", { status: 400 }));
  const error = await setTopic(env, token, subscribe);
  return cors(env, new Response(error, { status: error ? 400 : 204 }));
}

function status(env, { live = false, game = "", title = "", startedAt = null }) {
  const body = JSON.stringify({ live, game, title, startedAt });
  const res = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" } });
  return cors(env, res);
}

function cors(env, res) {
  res.headers.set("Access-Control-Allow-Origin", env.ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  res.headers.set("Vary", "Origin");
  return res;
}
