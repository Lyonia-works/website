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

const button = document.getElementById("notify");

// ---------- live badge ----------

// Show the static labels if the live state hasn't arrived in time.
setTimeout(() => document.documentElement.classList.remove("live-pending"), 2000);

async function refresh() {
  try {
    const res = await fetch(`${API}/status`);
    if (!res.ok) return;
    const state = await res.json();
    window.paintLive(state);
    try {
      localStorage.setItem("lyonia-live", JSON.stringify({ live: state.live, game: state.game }));
    } catch {
      // Not saved: the next visit waits for the network instead.
    }
  } catch {
    // Keep the static labels.
  }
}

refresh();
setInterval(refresh, 60_000);

// ---------- notifications ----------

const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

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
  const { notifyOn, notifyOff } = window.LIVE_LABELS;
  button.querySelector("span").textContent = isOn() ? notifyOn : notifyOff;
  button.setAttribute("aria-pressed", String(isOn()));
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
  if ((await Notification.requestPermission()) !== "granted") return;
  const { fcm, instance, registration } = await messaging();
  const token = await fcm.getToken(instance, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  await post("subscribe", token);
  remember(token);
}

async function turnOff() {
  await post("unsubscribe", stored());
  const { fcm, instance } = await messaging();
  await fcm.deleteToken(instance).catch(() => {});
  remember(null);
}

// Shown only where web push works (on iPhone: once the site is added to the Home Screen).
if (canPush) {
  render();
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await (isOn() ? turnOff() : turnOn());
    } catch (err) {
      console.error(err);
    } finally {
      button.disabled = false;
      render();
    }
  });
}
