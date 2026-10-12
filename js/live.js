// Live badge and go-live notifications. The page works unchanged if any of this fails.

const API = "https://live.lyonia.workers.dev";
const FIREBASE = "https://www.gstatic.com/firebasejs/12.19.0";
const CONFIG = {
  apiKey: "AIzaSyCfa_dafxGkuZt9rqkKO4vqitidFLGXE70",
  projectId: "lyonia-website",
  messagingSenderId: "942868148119",
  appId: "1:942868148119:web:346bfb4dec74d5819dded2",
};
const VAPID_KEY = "BB7jL6D-6EPnauw5f-n7IxsJXYyx-p-e1zlzGLQz2V-fyoZST6uLh0mzDAsuNMpRU0lPzkW1pwrxKf-tJpuXHAQ";
const STORE = "lyonia-push-token";

const badge = document.getElementById("live");
const button = document.getElementById("notify");
const hint = document.getElementById("notify-hint");

// ---------- live badge ----------

async function refresh() {
  try {
    const res = await fetch(`${API}/status`);
    if (!res.ok) return;
    const { live, game } = await res.json();
    const text = live
      ? (game ? `Live now · ${game}` : "Live now")
      : (game ? `Offline · last streamed ${game}` : "Offline");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    badge.replaceChildren(dot, document.createTextNode(text));
    badge.classList.toggle("is-live", live);
  } catch {
    // Keep the static "Live on Twitch" label.
  }
}

refresh();
setInterval(refresh, 60_000);

// ---------- notifications ----------

const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function stored() {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

function remember(token) {
  try {
    if (token) localStorage.setItem(STORE, token);
    else localStorage.removeItem(STORE);
  } catch {
    // Not saved: the button just shows "Notify me" next time.
  }
}

const isOn = () => canPush && Boolean(stored()) && Notification.permission === "granted";

function render() {
  button.querySelector("span").textContent = isOn() ? "Notifications on" : "Notify me";
  button.setAttribute("aria-pressed", String(isOn()));
}

function say(text) {
  hint.textContent = text;
  hint.hidden = false;
}

let firebase;
function messaging() {
  firebase ??= (async () => {
    const [{ initializeApp }, fcm] = await Promise.all([
      import(`${FIREBASE}/firebase-app.js`),
      import(`${FIREBASE}/firebase-messaging.js`),
    ]);
    const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
    return { fcm, instance: fcm.getMessaging(initializeApp(CONFIG)), registration };
  })();
  return firebase;
}

async function post(path, token) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
}

async function turnOn() {
  if ((await Notification.requestPermission()) !== "granted") {
    say("Notifications are blocked for this site. You can allow them in your browser's site settings.");
    return;
  }
  const { fcm, instance, registration } = await messaging();
  const token = await fcm.getToken(instance, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  await post("subscribe", token);
  remember(token);
  say("Done. You'll get a notification when Lyonia goes live.");
}

async function turnOff() {
  await post("unsubscribe", stored());
  const { fcm, instance } = await messaging();
  await fcm.deleteToken(instance).catch(() => {});
  remember(null);
  say("Notifications are off.");
}

if (canPush || isIOS) {
  button.hidden = false;
  render();
  button.addEventListener("click", async () => {
    if (!canPush) {
      say("On iPhone and iPad: tap Share, then Add to Home Screen, and open Lyonia from your Home Screen to turn on notifications.");
      return;
    }
    button.disabled = true;
    try {
      await (isOn() ? turnOff() : turnOn());
    } catch (err) {
      console.error(err);
      say("Something went wrong. Please try again.");
    } finally {
      button.disabled = false;
      render();
    }
  });
}
