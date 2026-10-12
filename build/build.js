// Build the site from content/ into dist/: one HTML page per content file, plus the static files.

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { ContentError, list, readPage, text, url } from "./content.js";
import { imageSize } from "./images.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = ["css", "js", "assets", "firebase-messaging-sw.js", "manifest.webmanifest"];
const ICONS = join(ROOT, "build", "icons");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inline = (s) => marked.parseInline(s);
const ARROW = '<svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>';
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a5 5 0 0 0-5 5v4l-2 3h14l-2-3V8a5 5 0 0 0-5-5z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>';

export async function buildSite({ contentDir = join(ROOT, "content"), outDir = join(ROOT, "dist") } = {}) {
  const icons = await loadIcons();
  const read = (name) => readPage(join(contentDir, name));
  const [site, home, events, privacy] = await Promise.all(["site.md", "home.md", "events.md", "privacy.md"].map(read));

  // Every image a content file names must exist in content/images; its size keeps the layout from jumping.
  const sizes = {};
  async function image(page, key, { optional = false } = {}) {
    const path = text(page, key, { optional });
    if (!path) return null;
    if (!/^images\/[\w.-]+$/.test(path)) throw new ContentError(`${page.file}: "${key}" should look like "images/file-name.webp".`);
    const file = join(contentDir, path);
    if (!existsSync(file)) throw new ContentError(`${page.file}: "${key}" points to ${path}, but there is no such file in content/images.`);
    sizes[path] ??= imageSize(await readFile(file));
    return path;
  }
  const dims = (path) => (sizes[path] ? ` width="${sizes[path].width}" height="${sizes[path].height}"` : "");

  const ctx = {
    site, icons, image, dims,
    name: text(site, "site_name"),
    siteUrl: url(site, "site_url").replace(/\/$/, ""),
    emblem: await image(site, "emblem"),
    wordmark: await image(site, "wordmark"),
    previewImage: await image(site, "preview_image"),
    footerLinks: list(site, "footer_links", ["label", "url"]),
    twitchUrl: url(site, "twitch_url"),
  };

  const pages = {
    "index.html": await homePage(ctx, home),
    "events.html": await eventsPage(ctx, events),
    "privacy.html": await privacyPage(ctx, privacy),
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const entry of STATIC) await cp(join(ROOT, entry), join(outDir, entry), { recursive: true });
  await cp(join(contentDir, "images"), join(outDir, "images"), { recursive: true });
  for (const [file, html] of Object.entries(pages)) await writeFile(join(outDir, file), html);
  return Object.keys(pages);
}

async function loadIcons() {
  const icons = {};
  for (const file of await readdir(ICONS)) {
    const svg = await readFile(join(ICONS, file), "utf8");
    icons[file.replace(/\.svg$/, "")] = svg.match(/ d="([^"]+)"/)[1];
  }
  return icons;
}

function icon(ctx, page, name) {
  if (!ctx.icons[name]) {
    throw new ContentError(`${page.file}: there is no icon called "${name}". Use one of: ${Object.keys(ctx.icons).sort().join(", ")}.`);
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ctx.icons[name]}"/></svg>`;
}

async function head(ctx, page, { path, css, theme, extra = "" }) {
  const title = text(page, "title");
  const previewTitle = text(page, "preview_title", { optional: true }) || title;
  const description = text(page, "preview_description");
  const preview = (await ctx.image(page, "preview_image", { optional: true })) || ctx.previewImage;
  const previewAlt = text(page, "preview_image_alt", { optional: true }) || text(ctx.site, "preview_image_alt");
  const pageUrl = `${ctx.siteUrl}/${path === "index.html" ? "" : path}`;
  const size = ctx.dims(preview).match(/width="(\d+)" height="(\d+)"/);
  return `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(ctx.name)}">
<meta property="og:title" content="${esc(previewTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(`${ctx.siteUrl}/${preview}`)}">
${size ? `<meta property="og:image:width" content="${size[1]}">\n<meta property="og:image:height" content="${size[2]}">\n` : ""}<meta property="og:image:alt" content="${esc(previewAlt)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${ctx.emblem}">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/${css}.css">
<script>
  // Show the page once its font is ready, so no text ever reflows. Images still downloading then fade in.
  (() => {
    const html = document.documentElement;
    html.classList.add("font-wait");
    if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) html.classList.add("can-push");
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      const shownAt = performance.now();
      for (const img of document.images) {
        if (img.complete) continue;
        img.classList.add("img-wait");
        const done = () => {
          if (performance.now() - shownAt < 150) img.classList.add("no-fade"); // arrived almost at once: just show it
          img.classList.remove("img-wait");
        };
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      }
      html.classList.remove("font-wait");
    };
    const whenParsed = () => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", show) : show());
    document.fonts.load('1em "Figtree"').then(whenParsed, whenParsed);
    setTimeout(show, 1000);
  })();
</script>
${extra}</head>`;
}

function footer(ctx, current) {
  const links = ctx.footerLinks
    .filter((l) => l.url !== current)
    .map((l) => `<a class="foot" href="${esc(l.url)}">${esc(l.label)}</a>`)
    .join("");
  return `  <footer>
    <img src="${ctx.emblem}" alt=""${ctx.dims(ctx.emblem)}>
    ${links}<span>${esc(text(ctx.site, "footer_copyright"))}</span>
  </footer>`;
}

function topBar(ctx) {
  return `  <nav class="top" aria-label="Site">
    <a class="brand" href="index.html"><img src="${ctx.emblem}" alt=""${ctx.dims(ctx.emblem)}><img src="${ctx.wordmark}" alt="${esc(ctx.name)}"${ctx.dims(ctx.wordmark)}></a>
    <a class="back" href="index.html">${esc(text(ctx.site, "back_link"))}</a>
  </nav>`;
}

async function homePage(ctx, page) {
  const s = ctx.site;
  const labels = {
    badgeLive: text(s, "live_badge_live"),
    badgeOffline: text(s, "live_badge_offline"),
    lastStreamed: text(s, "live_badge_last_streamed"),
    watchLive: text(s, "watch_button_live"),
    watchOffline: text(s, "watch_button_offline"),
    notifyOff: text(s, "notify_button_off"),
    notifyOn: text(s, "notify_button_on"),
  };
  // Inline script: paint the last known live state in the first frame; js/live.js keeps it fresh.
  const script = `<script>
  window.LIVE_LABELS = ${JSON.stringify(labels).replace(/</g, "\\u003c")};
  document.documentElement.classList.add("live-pending");
  function paintLive(s) {
    const L = window.LIVE_LABELS, badge = document.getElementById("live"), watch = document.getElementById("watch");
    const text = s.live ? (s.game ? L.badgeLive + " · " + s.game : L.badgeLive)
                        : (s.game ? L.badgeOffline + " · " + L.lastStreamed + " " + s.game : L.badgeOffline);
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    badge.replaceChildren(dot, document.createTextNode(text));
    badge.classList.toggle("is-live", s.live);
    watch.classList.toggle("is-live", s.live);
    watch.lastElementChild.textContent = s.live ? L.watchLive : L.watchOffline;
    document.documentElement.classList.remove("live-pending");
  }
</script>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
`;
  const character = await ctx.image(page, "character_image");
  const phone = await ctx.image(page, "character_image_phone");
  const links = list(page, "links", ["name", "handle", "url", "icon"]).map((l) => {
    if (!/^https?:\/\//.test(l.url)) throw new ContentError(`${page.file}: the link "${l.name}" needs a web address starting with https://.`);
    return `      <li><a href="${esc(l.url)}" target="_blank" rel="noopener"><span class="icon">${icon(ctx, page, l.icon)}</span><span><span class="name">${esc(l.name)}</span><span class="handle">${esc(l.handle)}</span></span>${ARROW}</a></li>`;
  });
  if (!page.body) throw new ContentError(`${page.file}: the intro text below the second --- line is empty.`);

  return `${await head(ctx, page, { path: "index.html", css: "home", extra: script })}
<body class="character-seal">
<div class="wrap">
  <header class="hero">
    <div class="stage">
      <picture>
        <source media="(max-width: 760px)" srcset="${phone}"${ctx.dims(phone)}>
        <img class="figure" src="${character}"${ctx.dims(character)} fetchpriority="high" alt="${esc(text(page, "character_image_alt"))}">
      </picture>
    </div>
    <div class="intro">
      <div class="seal"><img src="${ctx.emblem}" alt=""${ctx.dims(ctx.emblem)} fetchpriority="high"><p class="eyebrow" id="live">${esc(text(ctx.site, "live_badge_default"))}</p></div>
      <h1><img src="${ctx.wordmark}" alt="${esc(ctx.name)}"${ctx.dims(ctx.wordmark)} fetchpriority="high"></h1>
      <p class="lede">${inline(page.body)}</p>
      <div class="actions">
        <a class="cta" id="watch" href="${esc(ctx.twitchUrl)}" target="_blank" rel="noopener">${icon(ctx, page, "twitch")}<span class="live-dot" aria-hidden="true"></span><span>${esc(text(ctx.site, "watch_button_default"))}</span></a>
        <button class="ghost" id="notify" type="button" aria-pressed="false">${BELL}<span>${esc(labels.notifyOff)}</span></button>
      </div>
      <script>
        try { const s = JSON.parse(localStorage.getItem("lyonia-live")); if (s) paintLive(s); } catch {}
        try {
          if (localStorage.getItem("lyonia-push-token") && Notification.permission === "granted") {
            const b = document.getElementById("notify");
            b.lastElementChild.textContent = window.LIVE_LABELS.notifyOn;
            b.setAttribute("aria-pressed", "true");
          }
        } catch {}
      </script>
    </div>
  </header>
  <section class="links" aria-labelledby="find">
    <h2 id="find">${esc(text(page, "links_heading"))}</h2>
    <ul class="grid">
${links.join("\n")}
    </ul>
  </section>

${footer(ctx, "index.html")}
</div>
<script type="module" src="js/live.js"></script>
</body>
</html>
`;
}

async function photo(ctx, page, key) {
  const path = await ctx.image(page, key, { optional: true });
  if (!path) return '<div class="ph" role="img" aria-label="Photo placeholder">Photo</div>';
  return `<img src="${path}" alt="${esc(text(page, `${key}_alt`))}"${ctx.dims(path)}>`;
}

async function eventsPage(ctx, page) {
  const mail = text(page, "booking_email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new ContentError(`${page.file}: "booking_email" should be an email address.`);
  const caption = text(page, "hero_photo_caption", { optional: true });
  const events = list(page, "events", ["name", "detail"])
    .map((e) => `<li><strong>${esc(e.name)}</strong><span>${inline(e.detail)}</span></li>`).join("");
  const services = list(page, "services", ["title", "text"])
    .map((s) => `<li><h3>${esc(s.title)}</h3><p>${inline(s.text)}</p></li>`).join("");

  return `${await head(ctx, page, { path: "events.html", css: "events", theme: "dark" })}
<body class="events">
<div class="wrap">
${topBar(ctx)}

  <header class="hero">
    <div>
      <p class="eyebrow">${esc(text(page, "label"))}</p>
      <h1>${esc(text(page, "heading"))}</h1>
      <p class="lede">${inline(text(page, "intro"))}</p>
      <div class="actions">
        <a class="cta" href="mailto:${esc(mail)}">${esc(text(page, "enquire_button"))}</a>
        <a class="ghost" href="${esc(url(page, "media_kit_url"))}">${esc(text(page, "media_kit_button"))}</a>
      </div>
    </div>
    <figure class="shot">
      ${await photo(ctx, page, "hero_photo")}
${caption ? `      <figcaption>${inline(caption)}</figcaption>\n` : ""}    </figure>
  </header>

  <section aria-labelledby="hosted">
    <h2 class="label" id="hosted">${esc(text(page, "hosted_heading"))}</h2>
    <ul class="venues">
      ${events}
    </ul>
  </section>

  <section aria-labelledby="what">
    <h2 class="label" id="what">${esc(text(page, "services_heading"))}</h2>
    <ul class="cards">
      ${services}
    </ul>
  </section>

  <section class="about" aria-labelledby="about">
    ${await photo(ctx, page, "about_photo")}
    <div>
      <h2 id="about">${esc(text(page, "about_heading"))}</h2>
      <p>${inline(text(page, "about_text"))}</p>
      <a class="twitch" href="${esc(ctx.twitchUrl)}" target="_blank" rel="noopener">${icon(ctx, page, "twitch")}${esc(text(page, "about_link"))}</a>
    </div>
  </section>

  <section aria-labelledby="book">
    <div class="enquire">
      <h2 id="book">${esc(text(page, "booking_heading"))}</h2>
      <p>${inline(text(page, "booking_text"))}</p>
      <a class="cta" href="mailto:${esc(mail)}">${esc(text(page, "booking_button"))}</a>
      <span class="mail">${esc(mail)}</span>
    </div>
  </section>

${footer(ctx, "events.html")}
</div>
</body>
</html>
`;
}

async function privacyPage(ctx, page) {
  if (!page.body) throw new ContentError(`${page.file}: the page text below the second --- line is empty.`);
  return `${await head(ctx, page, { path: "privacy.html", css: "privacy" })}
<body>
<div class="wrap">
${topBar(ctx)}

  <main class="policy">
    <h1>${esc(text(page, "heading"))}</h1>
    <p class="updated">${esc(text(page, "updated"))}</p>
${marked.parse(page.body)}  </main>

${footer(ctx, "privacy.html")}
</div>
</body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const pages = await buildSite();
    console.log(`Built ${pages.join(", ")} into dist/`);
  } catch (err) {
    if (!(err instanceof ContentError)) throw err;
    console.error(`Content problem: ${err.message}`);
    process.exit(1);
  }
}
