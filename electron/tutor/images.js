// Real pictures for the whiteboard: freely licensed images from Wikimedia
// Commons (falling back to the lead image of the best Wikipedia article),
// downloaded once and served from a local cache.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { log } from "../logger.js";

const UA = "MyLecture/1.2 (educational desktop app; https://github.com/touhid314/mylecture)";
const OK_MIME = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;

async function getJson(url, signal) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const STOP = new Set("a an the of in on and or for to with by from at as is are how what why diagram diagrams illustration photo photograph picture image drawing labeled labelled simple showing shows".split(" "));
const words = (s) => String(s).toLowerCase().replace(/^file:/, "").replace(/\.[a-z]{3,4}$/, "").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
// Share of the query's meaningful words found in the title (plural-tolerant).
export function titleScore(query, title) {
  const q = [...new Set(words(query))];
  if (!q.length) return 0;
  const t = words(title);
  const hit = q.filter((w) => t.some((x) => x === w || x.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(x.slice(0, Math.max(4, x.length - 2)))));
  return hit.length / q.length;
}

async function commons(query, signal) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6", gsrlimit: "8",
    gsrsearch: `${query} filetype:bitmap|drawing`, prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "960",
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await getJson(u, signal);
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  let best = null;
  for (const p of pages) {
    const ii = p.imageinfo?.[0];
    if (!ii?.thumburl || !OK_MIME.test(ii.mime || "") || (ii.width && ii.width < 200)) continue;
    const score = titleScore(query, p.title) - (p.index || 0) * 0.01;
    if (best && best.score >= score) continue;
    const meta = ii.extmetadata || {};
    const artist = String(meta.Artist?.value || "").replace(/<[^>]+>/g, "").trim().slice(0, 60);
    const license = String(meta.LicenseShortName?.value || "").trim();
    best = { score, src: ii.thumburl, page: ii.descriptionurl, credit: ["Wikimedia Commons", artist, license].filter(Boolean).join(" · ") };
  }
  return best;
}

async function wikipedia(query, signal) {
  const u = new URL("https://en.wikipedia.org/w/api.php");
  Object.entries({ action: "query", format: "json", origin: "*", generator: "search", gsrsearch: query, gsrlimit: "3", prop: "pageimages|info", inprop: "url", piprop: "thumbnail", pithumbsize: "960" })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await getJson(u, signal);
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  const p = pages.find((x) => x.thumbnail?.source);
  return p ? { src: p.thumbnail.source, page: p.fullurl, credit: `Wikipedia · ${p.title}` } : null;
}

export class ImageFinder {
  constructor({ dir }) {
    this.dir = dir;
    this.memo = new Map();
  }

  // -> {url, page, credit} | null
  find(query) {
    const q = String(query || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!q) return Promise.resolve(null);
    const key = crypto.createHash("sha1").update(q.toLowerCase()).digest("hex").slice(0, 16);
    if (!this.memo.has(key)) this.memo.set(key, this._find(q, key).catch((error) => {
      log("warn", "tutor.image.failed", { query: q, error });
      this.memo.delete(key);
      return null;
    }));
    return this.memo.get(key);
  }

  async _find(q, key) {
    fs.mkdirSync(this.dir, { recursive: true });
    const metaFile = path.join(this.dir, key + ".json");
    try {
      const m = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      if (m.file && fs.existsSync(path.join(this.dir, m.file))) return { url: `mylecture://app/tutor-img/${m.file}`, page: m.page, credit: m.credit };
    } catch {}
    const signal = AbortSignal.timeout(12000);
    const started = Date.now();
    // A Commons file whose title matches the query well; otherwise the lead
    // image of the best-matching Wikipedia article (usually a good diagram).
    const [c, w] = await Promise.all([commons(q, signal).catch(() => null), wikipedia(q, signal).catch(() => null)]);
    const hit = c && c.score >= 0.6 ? c : w || (c && c.score >= 0.3 ? c : null);
    if (!hit) return null;
    const res = await fetch(hit.src, { headers: { "user-agent": UA }, signal });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const type = res.headers.get("content-type") || "";
    const ext = /png/.test(type) ? "png" : /gif/.test(type) ? "gif" : /webp/.test(type) ? "webp" : /svg/.test(type) ? "svg" : "jpg";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) throw new Error("image too large");
    const file = `${key}.${ext}`;
    fs.writeFileSync(path.join(this.dir, file), buf);
    fs.writeFileSync(metaFile, JSON.stringify({ query: q, file, page: hit.page, credit: hit.credit }));
    log("info", "tutor.image", { query: q, ms: Date.now() - started, bytes: buf.length });
    return { url: `mylecture://app/tutor-img/${file}`, page: hit.page, credit: hit.credit };
  }
}
