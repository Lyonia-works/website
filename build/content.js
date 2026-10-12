// Read a content file (settings block + Markdown) and check its fields, with errors an editor can act on.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";

export class ContentError extends Error {}

export async function readPage(file) {
  const text = (await readFile(file, "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
  if (!match) throw new ContentError(`${file}: must start with a --- line, then the settings, then another --- line.`);
  let data;
  try {
    data = parse(match[1]) ?? {};
  } catch (err) {
    throw new ContentError(`${file}: the settings block has a mistake. ${err.message.split("\n")[0]}`);
  }
  if (typeof data !== "object" || Array.isArray(data)) throw new ContentError(`${file}: the settings block must be "name: value" lines.`);
  return { file, data, body: (match[2] || "").trim() };
}

// Fields are read through these so a missing or mistyped one names the file and the line to fix.
export function text(page, key, { optional = false } = {}) {
  const value = page.data[key];
  if (value === undefined || value === null || value === "") {
    if (optional) return "";
    throw new ContentError(`${page.file}: "${key}" is missing or empty.`);
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new ContentError(`${page.file}: "${key}" should be text in quotes.`);
  }
  return String(value);
}

export function list(page, key, fields) {
  const value = page.data[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContentError(`${page.file}: "${key}" should be a list of items, each starting with "  - ".`);
  }
  return value.map((item, i) => {
    if (typeof item !== "object" || item === null) throw new ContentError(`${page.file}: item ${i + 1} of "${key}" is not laid out as name: value lines.`);
    const where = { file: `${page.file} (${key}, item ${i + 1})`, data: item };
    return Object.fromEntries(fields.map((f) => [f, text(where, f)]));
  });
}

export function url(page, key, { optional = false } = {}) {
  const value = text(page, key, { optional });
  if (value && !/^(https?:\/\/|mailto:|#|[\w./-]+$)/.test(value)) {
    throw new ContentError(`${page.file}: "${key}" should be a web address starting with https://.`);
  }
  return value;
}
