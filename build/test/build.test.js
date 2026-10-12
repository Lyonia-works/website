import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "../build.js";
import { ContentError } from "../content.js";
import { imageSize } from "../images.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "site-test-"));
  await cp(join(ROOT, "content"), join(dir, "content"), { recursive: true });
  return { content: join(dir, "content"), out: join(dir, "dist") };
}

async function edit(dir, file, from, to) {
  const path = join(dir, file);
  const text = await readFile(path, "utf8");
  assert.ok(text.includes(from), `${file} should contain ${from}`);
  await writeFile(path, text.replace(from, to));
}

test("reads image sizes from WebP and PNG headers", async () => {
  const size = async (p) => imageSize(await readFile(join(ROOT, p)));
  assert.deepEqual(await size("content/images/emblem.webp"), { width: 886, height: 900 });
  assert.deepEqual(await size("content/images/chibi.webp"), { width: 533, height: 964 });
  assert.deepEqual(await size("content/images/preview.png"), { width: 1200, height: 630 });
  assert.deepEqual(await size("assets/icon-192.png"), { width: 192, height: 192 });
});

test("every page gets link-preview tags with absolute addresses", async () => {
  const { content, out } = await scratch();
  await buildSite({ contentDir: content, outDir: out });
  for (const [page, title] of [["index.html", "Lyonia"], ["events.html", "Lyonia | Event host and MC"], ["privacy.html", "Privacy | Lyonia"]]) {
    const html = await readFile(join(out, page), "utf8");
    assert.match(html, new RegExp(`<meta property="og:title" content="${title.replace("|", "\\|")}">`), page);
    assert.match(html, /<meta property="og:image" content="https:\/\/lyonia-works\.github\.io\/website\/images\/preview\.png">/, page);
    assert.match(html, /<meta property="og:image:width" content="1200">/, page);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, page);
  }
});

test("images get their real size so the layout does not jump", async () => {
  const { content, out } = await scratch();
  await buildSite({ contentDir: content, outDir: out });
  const html = await readFile(join(out, "index.html"), "utf8");
  assert.match(html, /<img src="images\/emblem\.webp" alt="" width="886" height="900">/);
});

test("an empty photo shows the placeholder", async () => {
  const { content, out } = await scratch();
  await buildSite({ contentDir: content, outDir: out });
  const html = await readFile(join(out, "events.html"), "utf8");
  assert.equal(html.match(/class="ph"/g).length, 2);
});

test("a missing field names the file and the field", async () => {
  const { content, out } = await scratch();
  await edit(content, "events.md", 'heading: "Your stage, in good hands."\n', "");
  await assert.rejects(buildSite({ contentDir: content, outDir: out }), (err) =>
    err instanceof ContentError && /events\.md/.test(err.message) && /"heading"/.test(err.message));
});

test("an unknown icon lists the icons that exist", async () => {
  const { content, out } = await scratch();
  await edit(content, "home.md", 'icon: "x"', 'icon: "myspace"');
  await assert.rejects(buildSite({ contentDir: content, outDir: out }), (err) =>
    err instanceof ContentError && /"myspace"/.test(err.message) && /youtube/.test(err.message));
});

test("a missing image file is reported, not published broken", async () => {
  const { content, out } = await scratch();
  await edit(content, "home.md", '"images/chibi.webp"', '"images/chibi-new.webp"');
  await assert.rejects(buildSite({ contentDir: content, outDir: out }), (err) =>
    err instanceof ContentError && /chibi-new\.webp/.test(err.message));
});

test("text from content is escaped in the HTML", async () => {
  const { content, out } = await scratch();
  await edit(content, "home.md", 'handle: "@LyoniaFPS"', 'handle: "<b>@LyoniaFPS</b>"');
  await buildSite({ contentDir: content, outDir: out });
  const html = await readFile(join(out, "index.html"), "utf8");
  assert.ok(html.includes("&lt;b&gt;@LyoniaFPS&lt;/b&gt;"));
});
