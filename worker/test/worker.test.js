import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySignature } from "../src/twitch.js";
import { update } from "../src/index.js";

const SECRET = "test-secret-1234567890";
const enc = new TextEncoder();

async function signedHeaders(id, timestamp, body, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(id + timestamp + body)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new Headers({
    "Twitch-Eventsub-Message-Id": id,
    "Twitch-Eventsub-Message-Timestamp": timestamp,
    "Twitch-Eventsub-Message-Signature": `sha256=${hex}`,
  });
}

const NOW = Date.parse("2026-10-12T15:00:00Z");
const TS = "2026-10-12T14:59:30.000Z";
const BODY = '{"subscription":{"type":"stream.online"},"event":{"broadcaster_user_id":"69874547"}}';

test("accepts a correctly signed event", async () => {
  assert.equal(await verifySignature(SECRET, await signedHeaders("m1", TS, BODY), BODY, NOW), true);
});

test("rejects a tampered body", async () => {
  const headers = await signedHeaders("m1", TS, BODY);
  assert.equal(await verifySignature(SECRET, headers, BODY.replace("69874547", "1"), NOW), false);
});

test("rejects a signature made with another secret", async () => {
  assert.equal(await verifySignature(SECRET, await signedHeaders("m1", TS, BODY, "other-secret"), BODY, NOW), false);
});

test("rejects an event older than ten minutes", async () => {
  const old = "2026-10-12T14:45:00.000Z";
  assert.equal(await verifySignature(SECRET, await signedHeaders("m1", old, BODY), BODY, NOW), false);
});

test("rejects a malformed signature header", async () => {
  const headers = await signedHeaders("m1", TS, BODY);
  headers.set("Twitch-Eventsub-Message-Signature", "sha256=nothex");
  assert.equal(await verifySignature(SECRET, headers, BODY, NOW), false);
});

function fakeEnv() {
  const kv = new Map();
  return {
    LIVE: {
      async get(key, type) {
        const v = kv.get(key);
        return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
      },
      async put(key, value) {
        kv.set(key, value);
      },
    },
  };
}

test("the first state read never sends a notification", async () => {
  const env = fakeEnv();
  let sent = 0;
  await update(env, { live: true, game: "Apex Legends", startedAt: "2026-10-12T14:00:00Z" }, async () => sent++);
  assert.equal(sent, 0);
});

test("one stream sends one notification, from the event or the 10-minute check", async () => {
  const env = fakeEnv();
  let sent = 0;
  const notify = async () => sent++;
  await update(env, { live: false, game: "Apex Legends", startedAt: null }, notify);
  await update(env, { live: true, startedAt: "2026-10-12T14:00:00.123Z", game: "Apex Legends" }, notify);
  await update(env, { live: true, startedAt: "2026-10-12T14:00:00Z", game: "Apex Legends" }, notify);
  await update(env, { game: "The Finals", title: "ranked" }, notify);
  assert.equal(sent, 1);
  await update(env, { live: false, startedAt: null }, notify);
  await update(env, { live: true, startedAt: "2026-10-12T20:00:00Z" }, notify);
  assert.equal(sent, 2);
});
