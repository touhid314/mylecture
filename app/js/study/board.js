// The tutor's whiteboard: pages of short notes, equations, plots, diagrams
// and interactive questions. Items are appended live as the tutor speaks.
import { h, icon } from "../ui.js";
import { compileExpr, checkNumber, checkText } from "./expr.js";
import { renderScene } from "./scene.js";
import { pictureRequest } from "./pictures.js";
import { drawPictureMarks } from "./picture-marks.js";
import { mathifySvg } from "./svg-math.js";
import { fixContrast } from "./contrast.js";
import { renderMap, loadWorld, zoomMap, traceRoute, markShown, bringIntoView, settle } from "./map.js";

// Asks an HTML visual to highlight the element the spoken words name.
// Resolves true when it found one (false if not, or no answer in time).
const finds = new Map();
let findSeq = 0;
function findInFrame(frame, words) {
  const seq = ++findSeq;
  return new Promise((done) => {
    finds.set(seq, done);
    setTimeout(() => { if (finds.delete(seq)) done(false); }, 400);
    frame.contentWindow.postMessage({ type: "tutor:find", words, seq }, "*");
  });
}

// Generated documents can report layout and errors, but cannot invoke app APIs.
window.addEventListener("message", (event) => {
  const frame = [...document.querySelectorAll("iframe.wb-html-frame")].find((el) => el.contentWindow === event.source);
  if (!frame) return;
  if (event.data?.type === "tutor:height" && frame.dataset.autoHeight === "true") {
    const height = Number(event.data.height);
    if (Number.isFinite(height)) frame.style.height = `${Math.max(160, Math.min(900, height))}px`;
  }
  // An activity's result: sent on to the tutor (at most once a second).
  if (event.data?.type === "tutor:answer" && frame._answer && Date.now() - (frame._answeredAt || 0) > 1000) {
    frame._answeredAt = Date.now();
    const c = event.data.correct;
    frame._answer({ answer: String(event.data.answer ?? "").slice(0, 800), correct: c === true ? true : c === false ? false : null });
  }
  if (event.data?.type === "tutor:found") {
    finds.get(event.data.seq)?.(!!event.data.found);
    finds.delete(event.data.seq);
  }
  if (event.data?.type === "tutor:html-error") {
    console.error("Tutor visual error:", String(event.data.message || "").slice(0, 500));
    const status = frame.parentElement.querySelector(".wb-html-status");
    if (status) { status.hidden = false; status.textContent = "This visual had an error. Ask your tutor to fix it."; }
  }
});

const md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: false }) : null;

// ---------- math + markdown ----------
export function tex(src, display = false) {
  try {
    return window.katex ? window.katex.renderToString(String(src), { displayMode: display, throwOnError: false, strict: "ignore", output: "html", trust: (c) => c.command === "\\htmlId" || c.command === "\\htmlClass" }) : escapeHtml(src);
  } catch {
    return escapeHtml(src);
  }
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
// Markdown with $inline$ / $$display$$ / \( \) math.
export function richHtml(src, { inline = false } = {}) {
  const maths = [];
  let s = String(src ?? "");
  const keep = (m, display) => {
    maths.push(tex(m, display));
    return `@@M${maths.length - 1}@@`;
  };
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => keep(m, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => keep(m, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => keep(m, false));
  s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, m) => pre + keep(m, false));
  let html = md ? (inline ? md.renderInline(s) : md.render(s)) : escapeHtml(s);
  html = html.replace(/@@M(\d+)@@/g, (_, i) => maths[Number(i)]);
  return html;
}
function rich(src, cls = "", inline = false) {
  return h(inline ? "span" : "div", { class: cls, html: richHtml(src, { inline }) });
}

// ---------- SVG helpers ----------
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  return el;
}

// Only drawing elements and presentational attributes survive.
const SVG_TAGS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "marker", "lineargradient", "radialgradient", "stop", "title", "clippath", "use", "pattern"]);
export function sanitizeSvg(markup) {
  const doc = new DOMParser().parseFromString(String(markup), "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
  const walk = (el) => {
    for (const child of [...el.children]) {
      if (!SVG_TAGS.has(child.nodeName.toLowerCase())) {
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "style" && /url\s*\(|expression/i.test(a.value)) el.removeAttribute(a.name);
      else if ((n === "href" || n === "xlink:href") && !/^#/.test(a.value)) el.removeAttribute(a.name);
    }
  };
  walk(root);
  root.removeAttribute("width");
  root.removeAttribute("height");
  if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", "0 0 400 220");
  return document.importNode(root, true);
}

// A copied diagram needs its own ids for markers, gradients and clip paths:
// url(#id) resolves to the first match in the document, which may sit on a
// hidden page. Part ids the tutor points at are left alone.
let defSeq = 0;
function uniqueSvgIds(root) {
  const defs = root.querySelectorAll("marker[id], linearGradient[id], radialGradient[id], clipPath[id], pattern[id], lineargradient[id], radialgradient[id], clippath[id]");
  if (!defs.length) return root;
  const map = new Map();
  for (const d of defs) {
    const id = d.getAttribute("id");
    const next = `${id}-pin${++defSeq}`;
    map.set(id, next);
    d.setAttribute("id", next);
  }
  const fix = (v) => v.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, (m, id) => (map.has(id) ? `url(#${map.get(id)})` : m));
  for (const el of root.querySelectorAll("*")) {
    for (const a of [...el.attributes]) {
      if (a.value.includes("url(")) el.setAttribute(a.name, fix(a.value));
      else if ((a.name === "href" || a.name === "xlink:href") && a.value.startsWith("#") && map.has(a.value.slice(1))) el.setAttribute(a.name, `#${map.get(a.value.slice(1))}`);
    }
  }
  return root;
}

// ---------- pointable parts ----------
// Sub-parts of an item (a curve, a table cell, a flow box) carry
// data-part="alias|alias" so the tutor's {look:id.part} cues, or the words
// right after a cue ("this blue line"), can find them.
export function normRef(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\\(?:left|right|cdot|times)\b/g, " ")
    .replace(/[$\\{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Position of a whole-word (or whole-symbol) alias inside text, or -1.
export function wordIn(alias, text) {
  const m = new RegExp(`(^|[^\\w])${escRe(alias)}(?=$|[^\\w])`).exec(text);
  return m ? m.index + m[1].length : -1;
}
const aliases = (...xs) => [...new Set(xs.flat().map(normRef).filter(Boolean))].join("|") || null;

// "outer-membrane", "outer_membrane", "outerMembrane" -> "outer membrane".
export function idWords(id) {
  return normRef(String(id ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_.]+/g, " "));
}
// The first words spoken after a cue, as one normalized string.
const hintWords = (hint) => normRef(String(hint ?? "").replace(/\{[^}]*\}/g, " ")).split(" ").slice(0, 8).join(" ");
// Names a speaker wouldn't use to mean one part: indexes ("f1", "r2c1"),
// numbers and filler words.
const NOT_A_NAME = /^(f|curve|line|pt|point|col|c|column|row|r|n|node|step|box|s|item|part|g|group|layer)\d+$|^r\d+c\d+$|^\d+$|^(the|this|that|these|those|here|there|and|now|look|see|its|our|your|one|all|top|bottom|left|right|main|root|svg|diagram|figure|scene|visual|demo|bg|background)$/;
// Every part of an item that can be named: aliased parts (curves, cells,
// boxes), elements with ids (svg and HTML diagrams, \htmlId terms, scene and
// map objects) and short labels (svg text, table cells, flow boxes).
export function namedParts(el) {
  const out = [];
  const add = (p, a) => { if (a && a.length >= 3 && !NOT_A_NAME.test(a)) out.push([p, a]); };
  for (const p of el.querySelectorAll("[data-part]")) for (const a of p.dataset.part.split("|")) add(p, a);
  for (const p of el.querySelectorAll("[id], [data-id]")) {
    if (p === el || p.closest("defs, marker, clipPath, .katex-mathml")) continue;
    for (const id of new Set([p.getAttribute("data-id"), p.id].filter(Boolean))) if (id.length <= 40) add(p, idWords(id));
  }
  for (const t of el.querySelectorAll("svg text, td, th, .wb-node, li")) {
    if (t.closest(".katex-mathml")) continue;
    const s = normRef(t.textContent);
    if (s.length <= 40) add(t, s);
  }
  return out;
}

// ---------- plots ----------
const CURVE_COLORS = ["var(--wb-blue)", "var(--wb-red)", "var(--wb-green)", "var(--wb-purple)", "var(--wb-orange)"];
const CURVE_NAMES = ["blue", "red", "green", "purple", "orange"];
function niceStep(range, target = 8) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function fmtTick(v) {
  const r = Math.round(v * 1000) / 1000;
  return Math.abs(r) < 1e-9 ? "0" : String(r);
}

export function drawPlot(spec, params = {}) {
  const W = 560, H = 340, pad = 34;
  const fns = (Array.isArray(spec.fns) ? spec.fns : spec.fn ? [spec.fn] : []).slice(0, 5);
  const vars = ["x", ...Object.keys(spec.params || {})];
  const compiled = fns.map((f) => {
    try {
      return compileExpr(f, vars);
    } catch {
      return null;
    }
  });
  let [x0, x1] = Array.isArray(spec.x) && spec.x.length === 2 ? spec.x.map(Number) : [-5, 5];
  if (!(x1 > x0)) [x0, x1] = [-5, 5];
  const N = 400;
  const samples = compiled.map((f) => {
    if (!f) return [];
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      pts.push([x, f({ ...params, x })]);
    }
    return pts;
  });
  let y0, y1;
  if (Array.isArray(spec.y) && spec.y.length === 2 && Number(spec.y[1]) > Number(spec.y[0])) [y0, y1] = spec.y.map(Number);
  else {
    const ys = samples.flat().map((p) => p[1]).filter(Number.isFinite).sort((a, b) => a - b);
    for (const p of spec.points || []) if (Number.isFinite(p[1])) ys.push(p[1]);
    ys.sort((a, b) => a - b);
    y0 = ys.length ? ys[Math.floor(ys.length * 0.02)] : -5;
    y1 = ys.length ? ys[Math.ceil(ys.length * 0.98) - 1] : 5;
    if (!(y1 > y0)) { y0 -= 1; y1 += 1; }
    const m = (y1 - y0) * 0.1;
    y0 -= m; y1 += m;
  }
  const sx = (x) => pad + ((x - x0) / (x1 - x0)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - y0) / (y1 - y0)) * (H - 2 * pad);
  const g = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "wb-plot" });
  // grid
  const stepX = niceStep(x1 - x0), stepY = niceStep(y1 - y0, 6);
  const grid = svgEl("g", { class: "grid" });
  for (let x = Math.ceil(x0 / stepX) * stepX; x <= x1 + 1e-9; x += stepX) {
    grid.append(svgEl("line", { x1: sx(x), x2: sx(x), y1: pad, y2: H - pad }));
    grid.append(svgEl("text", { x: sx(x), y: H - pad + 16, "text-anchor": "middle", class: "tick" }, fmtTick(x)));
  }
  for (let y = Math.ceil(y0 / stepY) * stepY; y <= y1 + 1e-9; y += stepY) {
    grid.append(svgEl("line", { x1: pad, x2: W - pad, y1: sy(y), y2: sy(y) }));
    grid.append(svgEl("text", { x: pad - 6, y: sy(y) + 4, "text-anchor": "end", class: "tick" }, fmtTick(y)));
  }
  g.append(grid);
  // axes
  const axes = svgEl("g", { class: "axes" });
  if (y0 <= 0 && y1 >= 0) axes.append(svgEl("line", { x1: pad, x2: W - pad, y1: sy(0), y2: sy(0) }));
  if (x0 <= 0 && x1 >= 0) axes.append(svgEl("line", { x1: sx(0), x2: sx(0), y1: pad, y2: H - pad }));
  g.append(axes);
  // curves (break at discontinuities / out of range)
  samples.forEach((pts, k) => {
    let d = "", pen = false, prevY = null;
    for (const [x, y] of pts) {
      const ok = Number.isFinite(y) && y > y0 - (y1 - y0) * 2 && y < y1 + (y1 - y0) * 2;
      const jump = prevY != null && Math.abs(y - prevY) > (y1 - y0) * 1.5;
      if (!ok || jump) pen = false;
      if (ok) {
        d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(Math.max(y0 - (y1 - y0), Math.min(y1 + (y1 - y0), y))).toFixed(1)}`;
        pen = true;
      }
      prevY = y;
    }
    const label = (spec.labels || [])[k];
    g.append(svgEl("path", { d, class: "curve", style: `stroke:${CURVE_COLORS[k % CURVE_COLORS.length]}`, "data-part": aliases(`f${k + 1}`, `curve${k + 1}`, `line${k + 1}`, String(k + 1), CURVE_NAMES[k % CURVE_NAMES.length], label || "", fns[k] || "", fns[k] ? `y = ${fns[k]}` : "") }));
  });
  const clipId = "c" + Math.random().toString(36).slice(2);
  g.prepend(svgEl("defs", {}, svgEl("clipPath", { id: clipId }, svgEl("rect", { x: pad, y: pad, width: W - 2 * pad, height: H - 2 * pad }))));
  for (const p of g.querySelectorAll(".curve")) p.setAttribute("clip-path", `url(#${clipId})`);
  for (const [i, p] of (spec.points || []).entries()) {
    if (!Array.isArray(p) || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1]))) continue;
    g.append(svgEl("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 5, class: "pt", "data-label": p[2] != null ? String(p[2]) : null, "data-part": aliases(`pt${i + 1}`, `point${i + 1}`, p[2] != null ? String(p[2]) : "", `(${p[0]}, ${p[1]})`) }));
    if (p[2]) g.append(svgEl("text", { x: sx(p[0]) + 8, y: sy(p[1]) - 8, class: "pt-label" }, String(p[2])));
  }
  return g;
}

function legend(spec) {
  const fns = Array.isArray(spec.fns) ? spec.fns : spec.fn ? [spec.fn] : [];
  const labels = spec.labels || [];
  if (fns.length < 2 && !labels.length) return null;
  return h("div", { class: "wb-legend" }, fns.map((f, k) => h("span", {}, h("i", { style: `background:${CURVE_COLORS[k % CURVE_COLORS.length]}` }), rich(labels[k] || `$y = ${f}$`, "", true))));
}

// ---------- writing by hand ----------
// Reveals an element the way a teacher writes: word by word for text, symbol
// by symbol (left to right) for math. Returns the time it takes in ms.
const MS_PER_CHAR = 55, MS_PER_WORD = 110, MS_PER_GLYPH = 150;
export function writeOut(el, { max = 9000, speed = 1 } = {}) {
  const units = [];
  const mathGroups = [];
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        if (!child.textContent.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of child.textContent.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) frag.append(part);
          else {
            const w = document.createElement("span");
            w.className = "wu";
            w.textContent = part;
            frag.append(w);
            units.push({ el: w, ms: MS_PER_WORD + MS_PER_CHAR * part.length });
          }
        }
        child.replaceWith(frag);
      } else if (child.nodeType === 1) {
        if (child.classList.contains("katex")) {
          const group = [];
          const html = child.querySelector(".katex-html") || child;
          for (const leaf of html.querySelectorAll("span, svg")) {
            const isLine = leaf.matches(".frac-line, .rule, .overline-line, .underline-line, .hline") || leaf.tagName.toLowerCase() === "svg";
            const isText = !leaf.children.length && leaf.textContent.trim();
            if ((isLine || isText) && !leaf.closest(".wu")) group.push(leaf);
          }
          const placeholder = { group: [] };
          for (const g of group) {
            g.classList.add("wu");
            const r = g.getBoundingClientRect();
            placeholder.group.push({ el: g, left: r.left, top: r.top, ms: MS_PER_GLYPH * (g.tagName.toLowerCase() === "svg" || g.classList.contains("frac-line") ? 2 : 1) });
          }
          placeholder.group.sort((a, b) => a.left - b.left || a.top - b.top);
          units.push(placeholder);
          mathGroups.push(placeholder);
        } else if (!child.matches(".copy-code")) walk(child);
      }
    }
  };
  walk(el);
  const flat = units.flatMap((u) => (u.group ? u.group : [u]));
  let total = flat.reduce((n, u) => n + u.ms, 0) / speed;
  const scale = total > max ? max / total : 1;
  let t = 0;
  for (const u of flat) {
    u.el.style.setProperty("--d", `${Math.round(t)}ms`);
    t += u.ms * scale / speed;
  }
  el.classList.add("handwrite");
  return Math.round(t);
}

// ---------- the board ----------
// Visuals that can be docked while the tutor talks about them.
const FIGURES = ".wb-figure, .wb-table-wrap, .wb-flow, .wb-code";
const STUCK_ITEMS = 6; // notes added without referring to the docked visual

export class Board {
  constructor({ onAnswer, onExplore } = {}) {
    this.onAnswer = onAnswer || (() => {});
    this.onExplore = onExplore || (() => {});
    this.pages = [];
    this.current = -1;
    this.viewing = -1;
    this.items = new Map();
    this.follow = true;
    loadWorld().catch(() => {}); // maps draw at once when the tutor needs one
    this.tabs = h("div", { class: "wb-tabs" });
    this.prevBtn = h("button", { class: "wb-nav", title: "Previous page", onclick: () => this.showPage(this.viewing - 1) }, icon("up"));
    this.nextBtn = h("button", { class: "wb-nav", title: "Next page", onclick: () => this.showPage(this.viewing + 1) }, icon("down"));
    this.pageLabel = h("span", { class: "wb-page-label" });
    this.backLive = h("button", { class: "wb-live", onclick: () => this.showPage(this.current) }, "Back to live page");
    this.scroller = h("div", { class: "wb-scroll" });
    this.scroller.addEventListener("scroll", () => {
      if (this.locked) return;
      const nearBottom = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 80;
      this.follow = nearBottom;
    });
    this.root = h("div", { class: "wb" }, this.scroller, h("div", { class: "wb-foot" }, this.prevBtn, this.pageLabel, this.nextBtn, this.backLive));
    this._updateNav();
  }

  // Live lesson: the board always shows the latest content and the student
  // can't scroll it (they pause to look back). hold: the app is scrolling it
  // itself (rewind), so don't snap back to the end.
  setLocked(on) {
    this.locked = !!on;
    this.root.classList.toggle("locked", this.locked);
    if (this.locked) this.toLive();
  }

  setHold(on) {
    this.hold = !!on;
    if (!on && this.locked) this.toLive();
  }

  toLive() {
    this.follow = true;
    if (this.current < 0) return;
    if (this.viewing !== this.current) this.showPage(this.current, { instant: true });
    else this._scrollEnd(true);
  }

  clear() {
    this.pages = [];
    this.items.clear();
    this.current = -1;
    this.viewing = -1;
    this.scroller.replaceChildren();
    this._updateNav();
  }

  newPage(title) {
    // An empty current page is just renamed.
    const cur = this.pages[this.current];
    if (cur && !cur.body.children.length) {
      cur.title = title || cur.title;
      cur.head.replaceChildren(rich(title || "", "", true));
      return cur;
    }
    this.unstick();
    const head = h("h1", { class: "wb-title" }, rich(title || "", "", true));
    const body = h("div", { class: "wb-body" });
    const el = h("section", { class: "wb-page" }, head, body);
    const page = { title, el, head, body };
    this.pages.push(page);
    this.current = this.pages.length - 1;
    this.scroller.append(el);
    this.showPage(this.current, { instant: true });
    return page;
  }

  _page() {
    if (this.current < 0) this.newPage("");
    return this.pages[this.current];
  }

  showPage(i, { instant = false } = {}) {
    if (i < 0 || i >= this.pages.length) return;
    this.viewing = i;
    this.pages.forEach((p, k) => p.el.classList.toggle("shown", k === i));
    // Diagrams drawn while their page was hidden (a restored lesson) get
    // their text contrast checked now that they're laid out.
    requestAnimationFrame(() => { for (const svg of this.pages[i]?.el.querySelectorAll('svg.wb-svg:not([data-contrast]), svg.wb-scene:not([data-contrast])') || []) fixContrast(svg); });
    if (i === this.current) {
      this.follow = true;
      this._scrollEnd(instant);
    } else this.scroller.scrollTop = 0;
    this._updateNav();
  }

  _updateNav() {
    const n = this.pages.length;
    this.pageLabel.textContent = n > 1 ? `Page ${this.viewing + 1} of ${n}` : "";
    this.root.classList.toggle("single-page", n <= 1);
    this.prevBtn.disabled = this.viewing <= 0;
    this.nextBtn.disabled = this.viewing >= n - 1;
    this.backLive.style.display = n && this.viewing !== this.current ? "" : "none";
    this.root.classList.toggle("empty", !n);
  }

  _scrollEnd(instant) {
    if (!this.follow || this.viewing !== this.current) return;
    requestAnimationFrame(() => this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: instant ? "auto" : "smooth" }));
  }

  _append(el, action, { animate = true } = {}) {
    const page = this._page();
    el.classList.add("wb-item");
    // Text items fade in whole, quickly; figures keep their drawing animation.
    const fade = animate && ["write", "math", "flow", "table", "code"].includes(action?.type);
    if (animate) el.classList.add(fade ? "enter-fade" : "enter");
    page.body.append(el);
    // A new visual means the tutor has moved on from the docked one; a
    // docked visual nobody refers to again is released after a while.
    if (el.matches(FIGURES)) this.unstick();
    else if (this.stuck && ++this.stuckAge > STUCK_ITEMS) this.unstick();
    el._writeMs = fade ? 650 : animate ? (action?.type === "plot" ? 2600 : action?.type === "svg" ? 1200 : 450) : 0;
    const id = action?.id || action?.data?.id;
    if (id) {
      this.items.set(String(id), el);
      el.dataset.ref = id;
    }
    this.markActive(el);
    if (this.viewing !== this.current) this._updateNav();
    this._scrollEnd(!animate);
    return el;
  }

  // The visual the tutor is talking about stays in view: it docks at the top
  // of the board (sticky) once later notes would push it off screen, and the
  // notes keep scrolling beneath it. Only one at a time.
  focus(el) {
    const item = el?.closest?.(".wb-item");
    if (!item || !item.matches(FIGURES)) return false;
    const live = this.pages[this.current];
    if (!live?.el.contains(item) || this.viewing !== this.current) return false;
    this.stuckAge = 0;
    if (this.stuck === item) return true;
    this.unstick();
    item.classList.add("wb-stuck");
    // Too tall to dock without hiding the notes: leave it in place.
    if (item.getBoundingClientRect().height > this.scroller.clientHeight * 0.62) {
      item.classList.remove("wb-stuck");
      return false;
    }
    this.stuck = item;
    return true;
  }

  unstick() {
    this.stuck?.classList.remove("wb-stuck");
    this.stuck = null;
  }

  // Points at something on the board, like a teacher: scrolls it into view
  // and highlights it. Lines and curves glow along their own shape (and the
  // other curves of a plot dim); everything else gets a highlighter box.
  // ref: "id", "id.part" (an \htmlId in math, a scene object, a plot curve or
  // point, a table row/column/cell, a flow box, a code line) or "id/phrase"
  // (words inside an item). hint: the words spoken right after the cue, used
  // to narrow a whole-item ref down to the part being talked about.
  point(ref, hint = "") {
    ref = String(ref || "").trim();
    let target = this._resolve(ref, hint);
    if (!target) return false;
    // Pointing at an older picture mark brings it back to full strength.
    for (const el of target.els || [target.el]) el.classList?.remove("wb-pmark-old");
    // A diagram from an earlier page that the tutor is still talking about:
    // bring a copy onto the live page so it stays in view, like a teacher
    // redrawing the circuit next to the working.
    if (this._pinFromEarlierPage(target.el)) target = this._resolve(ref, hint) || target;
    // A visual further up: dock it so it stays visible while it's discussed.
    if (this.focus(target.el) && this.locked && !this.hold) {
      this.follow = true;
      this.scroller.scrollTop = this.scroller.scrollHeight;
      target = this._resolve(ref, hint) || target;
    }
    const page = target.el.closest(".wb-page");
    const pi = this.pages.findIndex((p) => p.el === page);
    if (pi >= 0 && pi !== this.viewing) this.showPage(pi);
    if (target.htmlPart) {
      target.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const frame = target.el.querySelector("iframe.wb-html-frame");
      const send = () => frame?.contentWindow?.postMessage({ type: "tutor:point", id: target.htmlPart }, "*");
      if (frame?.dataset.ready === "true") send();
      else frame?.addEventListener("load", send, { once: true });
      return true;
    }
    // A whole HTML visual, with the words that follow: the visual looks for
    // the element they name and highlights it; only if it finds none is the
    // whole visual boxed.
    const htmlFrame = !ref.includes(".") && !ref.includes("/") && hintWords(hint) ? target.el.querySelector?.("iframe.wb-html-frame") : null;
    if (htmlFrame?.dataset?.ready === "true" && htmlFrame.contentWindow) {
      target.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      findInFrame(htmlFrame, hintWords(hint)).then((found) => { if (!found && target.el.isConnected) this._boxWhole(target); });
      return true;
    }
    // A place, route, area or country on a map: make it glow on the map
    // itself, so the highlight follows it when the map zooms.
    const feature = target.el.closest?.("svg.wb-map [data-id]");
    if (feature) {
      bringIntoView(feature.closest("svg.wb-map"), feature);
      this._unpoint?.();
      feature.classList.remove("wb-map-hl");
      void feature.getBoundingClientRect();
      feature.classList.add("wb-map-hl");
      this._unpoint = () => feature.classList.remove("wb-map-hl");
      clearTimeout(this._pointTimer);
      this._pointTimer = setTimeout(() => { this._unpoint?.(); this._unpoint = null; }, 3200);
      return true;
    }
    return this._boxWhole(target, ref, hint);
  }

  _activityAnswer(frame, r) {
    const status = frame.parentElement?.querySelector(".wb-html-status");
    if (status) {
      status.hidden = false;
      status.className = "wb-html-status wb-feedback " + (r.correct === true ? "right" : r.correct === false ? "wrong" : "open");
      status.textContent = r.correct === true ? "Correct · sent to your tutor" : r.correct === false ? "Not quite · sent to your tutor" : "Sent to your tutor";
    }
    this.onAnswer({ kind: "activity", type: "activity", ...r });
  }

  // Highlights a resolved target: a glow along a line or curve, else a
  // highlighter box, scrolled into view first.
  _boxWhole(target, ref = "", hint = "") {
    const sc = this.scroller.getBoundingClientRect();
    let r = this._rect(target);
    // Bring it into view first if it's off screen.
    if (!this.stuck?.contains(target.el) && (r.top < sc.top + 20 || r.bottom > sc.bottom - 120)) {
      this.follow = false;
      this.scroller.scrollTop += r.top - sc.top - sc.height * 0.3;
      target = this._resolve(ref, hint) || target;
      r = this._rect(target);
    }
    this._unpoint?.();
    this._unpoint = this._glow(target) || this._box(r);
    clearTimeout(this._pointTimer);
    this._pointTimer = setTimeout(() => {
      this._unpoint?.();
      this._unpoint = null;
      // Pointed back at something older: return to the latest content.
      if (this.locked && !this.hold) this.toLive();
    }, 3200);
    return true;
  }

  // The map svg of a map item ("m1", "m1.part" or "m1/Country").
  _mapOf(ref) {
    const m = String(ref || "").trim().match(/^([\w-]+)(?:[./](.*))?$/);
    const svg = m && this.items.get(m[1])?.querySelector("svg.wb-map");
    return svg ? { svg, item: this.items.get(m[1]), part: (m[2] || "").trim() } : null;
  }

  // {zoom:m1.india} / {zoom:m1/Japan} / {zoom:m1}: the map's camera moves to
  // that item or country, or back to the map's own view.
  zoomMap(ref) {
    const t = this._mapOf(ref);
    if (!t) return false;
    if (this.focus(t.item) && this.locked) this._scrollEnd(true);
    zoomMap(t.svg, t.part);
    return true;
  }

  // {trace:m1.r1}: draw that route along its path now.
  traceMap(ref) {
    const t = this._mapOf(ref);
    if (!t || !t.part) return false;
    if (this.focus(t.item) && this.locked) this._scrollEnd(true);
    traceRoute(t.svg, t.part);
    return true;
  }

  // {show:id.part}: make a hidden part of a visual appear at this word (and
  // let an HTML visual's own script react to the cue).
  reveal(ref) {
    ref = String(ref || "").trim();
    const target = this._resolve(ref, "");
    if (!target) return false;
    const mapItem = target.el.closest?.("svg.wb-map [data-id]");
    if (mapItem) {
      const svg = mapItem.closest("svg.wb-map");
      markShown(svg, mapItem.dataset.id);
      // Something outside the current view: widen the view to show it;
      // then keep everything readable (labels apart, not lost in a corner).
      if (mapItem.dataset.trace !== "true") {
        svg._chosen = false;
        if (!bringIntoView(svg, mapItem)) settle(svg);
      }
      // A route to trace draws itself along its path as it appears.
      if (mapItem.dataset.trace === "true") {
        traceRoute(svg, mapItem.dataset.id);
        this.focus(svg);
        return true;
      }
    }
    if (target.htmlPart) {
      const frame = target.el.querySelector("iframe.wb-html-frame");
      const send = () => frame?.contentWindow?.postMessage({ type: "tutor:reveal", id: target.htmlPart }, "*");
      if (frame?.dataset.ready === "true") send();
      else frame?.addEventListener("load", send, { once: true });
      return true;
    }
    for (const el of target.els || [target.el]) {
      el.hidden = false;
      el.style.transition = "opacity .45s ease";
      el.style.visibility = "visible";
      el.style.opacity = "1";
      if (el.hasAttribute("opacity")) el.setAttribute("opacity", "1");
      // A scene item hidden with "opacity": 0 carries it on its shape too.
      for (const c of el.querySelectorAll?.("[opacity]") || []) c.style.opacity = "1";
    }
    return this.point(ref, "");
  }

  _pinFromEarlierPage(target) {
    if (this.current < 0 || this.viewing !== this.current) return false;
    const item = target.closest(".wb-item");
    if (!item?.dataset.ref || !item.matches(".wb-figure, .wb-table-wrap, .wb-flow, .wb-code")) return false;
    const live = this.pages[this.current];
    if (!item.closest(".wb-page") || live.el.contains(item)) return false;
    // The tutor already redrew it here (same labels): point at that instead.
    const words = (el) => new Set((el.textContent.match(/[\p{L}\p{N}Ωµ.]+/gu) || []).map((w) => w.toLowerCase()));
    const mine = words(item);
    const twin = [...live.body.children].find((el) => {
      if (!el.matches(".wb-figure, .wb-table-wrap, .wb-flow, .wb-code")) return false;
      const theirs = words(el);
      const shared = [...mine].filter((w) => theirs.has(w)).length;
      return mine.size && shared / Math.max(mine.size, theirs.size) >= 0.6;
    });
    if (twin) {
      if (!twin.dataset.ref) twin.dataset.ref = item.dataset.ref;
      this.items.set(item.dataset.ref, twin);
      this.focus(twin);
      return true;
    }
    const copy = uniqueSvgIds(item.cloneNode(true));
    copy.classList.remove("enter", "enter-fade", "active");    copy.classList.add("wb-pinned", "enter");
    copy.querySelectorAll(".wb-halo, .wb-replay").forEach((e) => e.remove());
    copy.querySelectorAll(".wb-focused").forEach((e) => e.classList.remove("wb-focused"));
    copy.querySelectorAll(".wb-focus").forEach((e) => e.classList.remove("wb-focus"));
    // Next to the latest notes (not at the top of the page, which may be
    // scrolled away), docked while it's discussed.
    live.body.append(copy);
    this.items.set(item.dataset.ref, copy);
    this.focus(copy);
    this._scrollEnd(true);
    return true;
  }

  _rect(t) {
    if (t.rect) return t.rect;
    const rs = (t.els || [t.el]).map((e) => e.getBoundingClientRect());
    const left = Math.min(...rs.map((q) => q.left)), top = Math.min(...rs.map((q) => q.top));
    const right = Math.max(...rs.map((q) => q.right)), bottom = Math.max(...rs.map((q) => q.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  // Highlighter box over a screen rect.
  _box(r) {
    const sc = this.scroller.getBoundingClientRect();
    const top = r.top - sc.top + this.scroller.scrollTop, left = r.left - sc.left + this.scroller.scrollLeft;
    const pad = 6, px = 3;
    const mark = h("div", { class: "wb-mark", style: { top: `${top - pad}px`, left: `${left - px}px`, width: `${r.width + px * 2}px`, height: `${r.height + pad * 2}px` } });
    this.scroller.append(mark);
    return () => {
      mark.classList.add("out");
      setTimeout(() => mark.remove(), 500);
    };
  }

  // A glowing halo traced along an SVG line, curve or shape.
  _glow(t) {
    if (t.rect || t.els) return null;
    let el = t.el;
    if (el.tagName?.toLowerCase() === "g" && el.children.length === 1) el = el.children[0];
    const tag = el.tagName?.toLowerCase();
    if (!el.ownerSVGElement || !["path", "line", "polyline", "polygon", "circle", "ellipse", "rect"].includes(tag)) return null;
    const svg = el.ownerSVGElement;
    const halo = el.cloneNode(false);
    for (const at of ["id", "class", "style", "data-part", "data-id", "data-label", "marker-start", "marker-end", "marker-mid", "fill", "stroke", "stroke-dasharray", "opacity"]) halo.removeAttribute(at);
    const sw = parseFloat(getComputedStyle(el).strokeWidth) || 2;
    halo.setAttribute("class", "wb-halo");
    halo.style.strokeWidth = String(Math.max(tag === "circle" ? 8 : 11, sw + 9));
    el.before(halo);
    el.classList.add("wb-focused");
    svg.classList.add("wb-focus");
    return () => {
      halo.classList.add("out");
      setTimeout(() => halo.remove(), 500);
      el.classList.remove("wb-focused");
      svg.classList.remove("wb-focus");
    };
  }

  _resolve(ref, hint = "") {
    const m = ref.match(/^([\w-]+)(?:([./])(.+))?$/);
    if (!m) return null;
    const el = this.items.get(m[1]) || this.scroller.querySelector(`[data-ref="${CSS.escape(m[1])}"]`);
    if (!el) return null;
    if (!m[2]) return this._fromHint(el, hint) || { el };
    const part = m[3].trim();
    if (el.querySelector("iframe.wb-html-frame")) return { el, htmlPart: part };
    if (m[2] === ".") {
      const byId = el.querySelector(`[id="${CSS.escape(part)}"], .${CSS.escape(part)}, [data-id="${CSS.escape(part)}"], [data-label="${CSS.escape(part)}"]`);
      if (byId) return this._expand(byId);
    }
    return this._part(el, part) || this._phrase(el, part) || this._looseId(el, part) || this._fromHint(el, hint) || { el };
  }

  // A table header stands for its whole column.
  _expand(p) {
    if (p.tagName === "TH" && p.dataset.col != null) {
      const col = p.dataset.col;
      return { el: p, els: [p, ...p.closest("table").querySelectorAll(`td[data-col="${col}"]`)] };
    }
    return { el: p };
  }

  // A named part: "f2", "blue", "row 3", "col 2", "r2c1", "n3", "line 4" (code), a label...
  _part(el, part) {
    const want = normRef(part).replace(/^(the|this|that)\s+/, "");
    if (!want) return null;
    const line = want.match(/^(?:line|l|lines)\s*(\d+)(?:\s*-\s*(\d+))?$/);
    const code = el.querySelector("pre code");
    if (line && code) return this._codeLines(code, +line[1], +(line[2] || line[1]));
    const parts = [...el.querySelectorAll("[data-part]")].map((p) => [p, p.dataset.part.split("|")]);
    if (!parts.length) return null;
    const compact = want.replace(/\s+/g, "");
    let hit = parts.find(([, as]) => as.includes(want) || as.includes(compact));
    // "blue line", "the red curve", "column n!": a whole-word alias inside the ref.
    if (!hit) hit = parts.find(([, as]) => as.some((a) => a.length >= 3 && wordIn(a, want) >= 0));
    // A longer label that starts with the ref.
    if (!hit && want.length >= 3) hit = parts.find(([, as]) => as.some((a) => a.startsWith(want)));
    return hit ? this._expand(hit[0]) : null;
  }

  // The tutor pointed at a whole item, but its next words name a part
  // ("{look:p1} this blue line", "{look:fig} the left ventricle"): point at
  // that part instead of boxing the whole item.
  _fromHint(el, hint) {
    const words = hintWords(hint);
    if (!words) return null;
    let best = null;
    for (const [p, a] of namedParts(el)) {
      const at = wordIn(a, words);
      if (at >= 0 && (!best || at < best.at || (at === best.at && a.length > best.len))) best = { p, at, len: a.length };
    }
    return best ? this._expand(best.p) : null;
  }

  // {look:fig.membrane} when the element is "outer-membrane" or labelled
  // "Outer membrane": the named part, not the whole diagram.
  _looseId(el, part) {
    const want = idWords(part);
    if (want.length < 3) return null;
    const named = namedParts(el);
    const hit = named.find(([, a]) => a === want) || named.find(([, a]) => wordIn(want, a) >= 0) || named.find(([, a]) => a.length >= 4 && wordIn(a, want) >= 0);
    return hit ? this._expand(hit[0]) : null;
  }

  _codeLines(code, from, to) {
    const text = code.textContent;
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
    if (from < 1 || from > starts.length) return null;
    const end = Math.max(from, to) < starts.length ? starts[Math.max(from, to)] - 1 : text.length;
    return this._range(code, starts[from - 1], end);
  }

  // A phrase inside the item's text.
  _phrase(el, part) {
    const want = part.toLowerCase().replace(/\s+/g, " ");
    const at = this._text(el).all.toLowerCase().replace(/\s/g, " ").indexOf(want);
    if (at < 0) return null;
    const t = this._range(el, at, at + want.length);
    // Most of an SVG label, a table cell or a flow box: mark that whole thing.
    const holder = t?.node?.parentElement?.closest("td, th, .wb-node, text");
    if (holder && el.contains(holder) && holder.textContent.trim().length <= want.length + 24) return this._expand(holder);
    return t;
  }

  _text(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let all = "";
    for (let n; (n = walker.nextNode()); ) {
      if (n.parentElement.closest(".katex-mathml")) continue;
      nodes.push([n, all.length]);
      all += n.textContent;
    }
    return { nodes, all };
  }

  _range(el, start, end) {
    const { nodes } = this._text(el);
    if (!nodes.length) return null;
    const find = (pos) => {
      for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= pos) return [nodes[i][0], pos - nodes[i][1]];
      return [nodes[0][0], 0];
    };
    try {
      const range = document.createRange();
      const [a, ao] = find(start), [b, bo] = find(end);
      range.setStart(a, Math.min(ao, a.textContent.length));
      range.setEnd(b, Math.min(bo, b.textContent.length));
      const rect = range.getBoundingClientRect();
      return rect.width ? { el, rect, node: a } : null;
    } catch {
      return null;
    }
  }

  markActive(el) {
    this.active?.classList.remove("active");
    this.active = el;
    el?.classList.add("active");
  }

  // Draws one board or interactive action. Returns the element.
  draw(a, opts = {}) {
    try {
      return this._draw(a, opts);
    } catch (e) {
      console.warn(`BOARD failed ${a.type}: ${e?.stack || e}`);
      return null;
    }
  }

  _draw(a, opts) {
    switch (a.type) {
      case "page": {
        this.newPage(a.text);
        const head = this.pages[this.current].head;
        if (opts.animate !== false) {
          head.classList.remove("enter-fade");
          void head.offsetWidth;
          head.classList.add("enter-fade");
        }
        head._writeMs = opts.animate === false ? 0 : 650;
        return head;
      }
      case "write": {
        const t = a.text || "";
        const heading = /^#{1,3}\s/.test(t);
        return this._append(rich(t, `wb-write${heading ? " heading" : ""}${/^\s*[-*]\s/.test(t) ? " bullet" : ""}`), a, opts);
      }
      case "math":
        return this._append(h("div", { class: "wb-math", html: tex(a.text.replace(/^\$\$?|\$\$?$/g, ""), true) }), a, opts);
      case "map": {
        const d = a.data || {};
        const id = a.id || d.id;
        const existing = id && this.items.get(String(id));
        // The same map again on the live page: change it in place (and zoom
        // smoothly to its new view), like a teacher redrawing on the same map.
        const live = this.pages[this.current]?.el;
        if (existing?.querySelector("svg.wb-map") && live?.contains(existing)) {
          const svg = existing.querySelector("svg.wb-map");
          // A highlight drawn for the old view would sit in the wrong place.
          this._unpoint?.();
          this._unpoint = null;
          renderMap(svg, d, { animate: opts.animate !== false });
          // A new caption replaces the old one; an update without one keeps it.
          if (d.caption) {
            existing.querySelector(".wb-cap")?.remove();
            svg.after(rich(d.caption, "wb-cap", true));
          }
          this.markActive(existing);
          existing._writeMs = 900;
          if (opts.animate !== false && this.focus(existing)) this._scrollEnd(true);
          return existing;
        }
        const svg = svgEl("svg", { class: "wb-map", viewBox: "0 0 1920 1080", role: "img", "aria-label": d.caption || "Map" });
        renderMap(svg, d, { animate: opts.animate !== false });
        const el = this._append(h("figure", { class: "wb-figure wb-map-fig" }, svg, d.caption ? rich(d.caption, "wb-cap", true) : null, h("span", { class: "wb-credit" }, "Map: Natural Earth")), a, opts);
        el._writeMs = 900;
        return el;
      }
      case "html": {
        const d = a.data || {};
        if (!/^mylecture:\/\/app\/tutor-file\//.test(d.src || "")) return null;
        const frame = h("iframe", { class: "wb-html-frame", sandbox: "allow-scripts", title: d.caption || "Interactive tutor visual", src: d.src, onload: (event) => { event.currentTarget.dataset.ready = "true"; } });
        frame.style.height = `${Number.isFinite(Number(d.height)) ? Math.max(160, Math.min(900, Number(d.height))) : 360}px`;
        frame.dataset.autoHeight = String(d.height == null);
        const status = h("div", { class: "wb-html-status", hidden: true });
        const id = a.id || d.id;
        // A hands-on activity ("task": true): what the student does in it goes
        // to the tutor as their answer (the visual calls tutor.submit).
        frame._answer = (r) => this._activityAnswer(frame, { id: String(id || "activity"), q: d.caption || "", ...r });
        const kicker = d.task ? h("div", { class: "wb-card-kicker" }, icon("sparkles"), "Your turn") : "";
        const existing = id && this.items.get(String(id));
        if (existing?.querySelector("iframe.wb-html-frame")) {
          existing.classList.toggle("wb-activity", !!d.task);
          existing.replaceChildren(kicker, frame, status, d.caption ? rich(d.caption, "wb-cap", true) : "");
          this.markActive(existing);
          existing._writeMs = 450;
          return existing;
        }
        return this._append(h("figure", { class: "wb-figure wb-html" + (d.task ? " wb-activity" : "") }, kicker || null, frame, status, d.caption ? rich(d.caption, "wb-cap", true) : null), a, opts);
      }
      case "plot": {
        const d = a.data || {};
        return this._append(h("figure", { class: "wb-figure" }, d.title ? rich(d.title, "wb-cap", true) : null, drawPlot(d), legend(d)), a, opts);
      }
      case "table": {
        const d = a.data || {};
        const head = d.head || d.header || d.columns || [];
        const rows = d.rows || [];
        return this._append(
          h("div", { class: "wb-table-wrap" }, h("table", { class: "wb-table" }, head.length ? h("thead", {}, h("tr", {}, head.map((c, j) => h("th", { html: richHtml(c, { inline: true }), "data-part": aliases(`col${j + 1}`, `c${j + 1}`, `column${j + 1}`, String(c)), "data-col": j })))) : null, h("tbody", {}, rows.map((r, i) => h("tr", { "data-part": aliases(`row${i + 1}`, `r${i + 1}`) }, (Array.isArray(r) ? r : [r]).map((c, j) => h("td", { html: richHtml(c, { inline: true }), "data-part": aliases(`r${i + 1}c${j + 1}`, String(c)), "data-col": j }))))))),
          a,
          opts,
        );
      }
      case "code": {
        const d = typeof a.data === "string" ? { src: a.data } : a.data || {};
        const code = h("code", {}, String(d.src || d.code || ""));
        if (window.hljs && d.lang && window.hljs.getLanguage(d.lang)) {
          try {
            code.innerHTML = window.hljs.highlight(String(d.src || d.code || ""), { language: d.lang }).value;
          } catch {}
        }
        return this._append(h("div", { class: "wb-code" }, d.lang ? h("span", { class: "wb-code-lang" }, d.lang) : null, h("pre", {}, code)), a, opts);
      }
      case "svg": {
        const svg = sanitizeSvg(a.text);
        if (!svg) return null;
        svg.classList.add("wb-svg");
        mathifySvg(svg); // $...$ in its text is real math
        const fig = this._append(h("figure", { class: "wb-figure" }, svg), a, opts);
        requestAnimationFrame(() => fixContrast(svg)); // no white text on a white box
        return fig;
      }
      case "scene": {
        const d = a.data || {};
        const svg = renderScene(d);
        mathifySvg(svg);
        const again = h("button", { class: "wb-replay", title: "Play the animation again", onclick: () => svg._replay?.() }, icon("refresh"), "Replay");
        const fig = h("figure", { class: "wb-figure wb-scene-wrap" }, svg, d.caption ? rich(d.caption, "wb-cap", true) : null, again);
        const el = this._append(fig, a, opts);
        requestAnimationFrame(() => fixContrast(svg));
        el._writeMs = Math.min(6000, (svg._duration || 1) * 1000 * 0.6);
        return el;
      }
      case "image": {
        const d = a.data || {};
        const img = h("img", { class: "wb-img", alt: d.caption || d.query || "" });
        const credit = h("a", { class: "wb-credit", href: "#", onclick: (e) => { e.preventDefault(); if (img._page) window.ml.shell.openExternal(img._page); } });
        const stage = h("div", { class: "wb-picture-stage" }, img);
        if (d.marks) drawPictureMarks(stage, d.marks);
        const fig = h("figure", { class: "wb-figure wb-image loading" }, stage, d.caption ? rich(d.caption, "wb-cap", true) : null, credit);
        const el = this._append(fig, a, opts);
        const found = pictureRequest(a);
        const unavailable = () => {
          fig.classList.remove("loading");
          img.remove();
          credit.replaceWith(h("span", { class: "wb-credit" }, "Picture unavailable. Try a more specific subject."));
        };
        Promise.resolve(found).then((r) => {
          if (!r?.url) return unavailable();
          img._page = r.page;
          credit.textContent = r.credit || "";
          img.onload = () => fig.classList.remove("loading");
          img.onerror = unavailable;
          img.src = r.url;
        }, unavailable);
        el._writeMs = 1200;
        return el;
      }
      case "annotate": {
        const d = a.data || {};
        const target = this.items.get(String(d.target || ""));
        if (!target?.querySelector(".wb-picture-stage")) return null;
        this._pinFromEarlierPage(target);
        const live = this.items.get(String(d.target)) || target;
        drawPictureMarks(live.querySelector(".wb-picture-stage"), d.marks, { clear: d.clear === true, unfocus: d.unfocus === true || d.focus === false, animate: opts.animate !== false });
        this.markActive(live);
        if (opts.animate !== false && this.focus(live)) this._scrollEnd(true);
        live._writeMs = 450;
        return live;
      }
      case "flow": {
        const d = a.data || {};
        const nodes = d.nodes || d.steps || [];
        const down = d.dir === "down";
        const row = h("div", { class: `wb-flow${down ? " down" : ""}` });
        nodes.forEach((n, i) => {
          if (i) row.append(h("span", { class: "wb-arrow" }, down ? "↓" : "→"));
          const label = typeof n === "string" ? n : n.label || "";
          const node = rich(label, "wb-node", true);
          node.dataset.part = aliases(`n${i + 1}`, `node${i + 1}`, `step${i + 1}`, `box${i + 1}`, n?.id || "", label);
          row.append(node);
        });
        return this._append(row, a, opts);
      }
      case "ask":
        return this._append(this._ask(a, opts), a, opts);
      case "practice":
        return this._append(this._practice(a, opts), a, opts);
      case "explore":
        return this._append(this._explore(a), a, opts);
      default:
        return null;
    }
  }

  // ---------- interactives ----------
  // Questions: mcq | number | text | order. Calls onAnswer once submitted.
  _ask(a, { replay } = {}) {
    const d = a.data || {};
    const id = d.id || a.id || "q";
    const type = d.type || (d.options ? "mcq" : d.items ? "order" : typeof d.answer === "number" ? "number" : "text");
    const card = h("div", { class: "wb-card ask", "data-id": id });
    const fb = h("div", { class: "wb-feedback" });
    const done = (result) => {
      card.classList.add("answered", result.correct === true ? "right" : result.correct === false ? "wrong" : "open");
      fb.replaceChildren(
        h("b", {}, result.correct === true ? "Correct" : result.correct === false ? "Not quite" : "Sent to your tutor"),
        result.correct === false && d.explain && !result.retry ? rich(d.explain, "", true) : null,
      );
      if (!replay) this.onAnswer({ id, kind: "ask", q: d.q, type, ...result });
    };
    card.append(h("div", { class: "wb-card-kicker" }, icon("sparkles"), "Your turn"), rich(d.q || "", "wb-q"));
    if (type === "mcq") {
      const opts = h("div", { class: "wb-options" });
      (d.options || []).forEach((o, i) => {
        const b = h("button", { class: "wb-option", onclick: () => {
          if (card.classList.contains("answered")) return;
          const correct = Number.isInteger(d.answer) ? i === d.answer : null;
          b.classList.add("chosen");
          if (Number.isInteger(d.answer)) opts.children[d.answer]?.classList.add("is-answer");
          done({ answer: o, choice: i, correct });
        } }, h("span", { class: "wb-letter" }, String.fromCharCode(65 + i)), rich(o, "", true));
        opts.append(b);
      });
      card.append(opts);
    } else if (type === "order") {
      const items = (d.items || []).map((t, i) => ({ t, i }));
      const shuffled = shuffle(items);
      const list = h("ol", { class: "wb-order" });
      const move = (li, dir) => {
        const sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
        if (!sib) return;
        dir < 0 ? list.insertBefore(li, sib) : list.insertBefore(sib, li);
      };
      let dragging = null;
      for (const it of shuffled) {
        const li = h("li", { draggable: "true", "data-i": it.i }, h("span", { class: "grip" }, "⋮⋮"), rich(it.t, "grow", true), h("button", { class: "mini", title: "Move up", onclick: () => move(li, -1) }, icon("up")), h("button", { class: "mini", title: "Move down", onclick: () => move(li, 1) }, icon("down")));
        li.addEventListener("dragstart", () => { dragging = li; li.classList.add("dragging"); });
        li.addEventListener("dragend", () => { dragging = null; li.classList.remove("dragging"); });
        li.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (!dragging || dragging === li) return;
          const r = li.getBoundingClientRect();
          list.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? li : li.nextSibling);
        });
        list.append(li);
      }
      const submit = h("button", { class: "btn primary sm", onclick: () => {
        if (card.classList.contains("answered")) return;
        const order = [...list.children].map((li) => Number(li.dataset.i));
        const correct = order.every((v, k) => v === k);
        [...list.children].forEach((li, k) => li.classList.add(Number(li.dataset.i) === k ? "ok" : "bad"));
        done({ answer: order.map((i) => items[i].t).join(" → "), correct });
      } }, "Check order");
      card.append(list, h("div", { class: "wb-actions" }, submit));
    } else {
      const input = h(type === "text" ? "textarea" : "input", { class: "wb-input", rows: type === "text" ? 2 : null, placeholder: type === "number" ? "Your answer (a number)" : "Type your answer…" });
      const submit = h("button", { class: "btn primary sm", onclick: () => send() }, "Submit");
      const send = () => {
        const v = input.value.trim();
        if (!v || card.classList.contains("answered")) return;
        input.disabled = true;
        submit.disabled = true;
        const correct = type === "number" ? checkNumber(v, d.answer, d.tolerance) : checkText(v, d.answer);
        done({ answer: v + (d.unit ? ` ${d.unit}` : ""), correct: correct == null ? null : correct });
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      card.append(h("div", { class: "wb-answer-row" }, input, d.unit ? h("span", { class: "wb-unit" }, d.unit) : null, submit));
      card._focus = () => input.focus();
    }
    card.append(fb);
    return card;
  }

  // Guided practice: steps unlock one at a time, with hints.
  _practice(a, { replay } = {}) {
    const d = a.data || {};
    const id = d.id || a.id || "p";
    const steps = Array.isArray(d.steps) ? d.steps : [];
    const card = h("div", { class: "wb-card practice", "data-id": id });
    const progress = h("div", { class: "wb-steps-progress" }, steps.map(() => h("i")));
    const list = h("div", { class: "wb-steps" });
    card.append(h("div", { class: "wb-card-kicker" }, icon("wand"), "Practice", progress), rich(d.title || d.q || "", "wb-q"));
    if (d.given) card.append(rich(d.given, "wb-given"));
    card.append(list);
    const log = [];
    let attemptsTotal = 0;
    const show = (k) => {
      if (k >= steps.length) {
        card.classList.add("answered", "right");
        list.append(h("div", { class: "wb-feedback" }, h("b", {}, "Practice complete"), ` ${attemptsTotal === steps.length ? "First try on every step." : ""}`));
        if (!replay) this.onAnswer({ id, kind: "practice", q: d.title, steps: log, correct: log.every((s) => s.firstTry), answer: log.map((s, i) => `step ${i + 1}: ${s.answer}${s.firstTry ? "" : ` (after ${s.attempts} tries${s.hint ? ", used hint" : ""})`}`).join("; ") });
        return;
      }
      const st = steps[k];
      const type = st.type || (st.options ? "mcq" : typeof st.answer === "number" ? "number" : "text");
      const fb = h("div", { class: "wb-step-fb" });
      const hintBtn = st.hint ? h("button", { class: "btn ghost sm", onclick: () => { fb.replaceChildren(h("span", { class: "hint" }, "Hint: ", rich(st.hint, "", true))); entry.hint = true; } }, "Hint") : null;
      const entry = { prompt: st.prompt, attempts: 0, hint: false };
      const row = h("div", { class: "wb-step" }, h("div", { class: "wb-step-n" }, String(k + 1)), h("div", { class: "grow" }, rich(st.prompt || "", "wb-step-q")));
      const body = row.lastChild;
      progress.children[k]?.classList.add("on");
      const finish = (answer) => {
        entry.answer = answer;
        entry.firstTry = entry.attempts === 1;
        attemptsTotal += entry.attempts;
        log.push(entry);
        row.classList.add("done");
        progress.children[k]?.classList.add("done");
        body.querySelectorAll("button, input").forEach((x) => (x.disabled = true));
        fb.replaceChildren(h("b", { class: "ok" }, "✓ "), st.explain ? rich(st.explain, "", true) : "Right.");
        show(k + 1);
      };
      const wrong = () => {
        row.classList.remove("shake");
        void row.offsetWidth;
        row.classList.add("shake");
        const giveUp = entry.attempts >= 3 && st.answer != null;
        fb.replaceChildren(h("b", { class: "bad" }, "Not yet. "), st.hint && !entry.hint ? rich(st.hint, "", true) : "Try again.", giveUp ? h("button", { class: "btn ghost sm", onclick: () => finish(`(shown) ${Array.isArray(st.options) ? st.options[st.answer] : st.answer}`) }, "Show answer") : null);
        entry.hint = entry.hint || !!st.hint;
      };
      if (type === "mcq") {
        const opts = h("div", { class: "wb-options compact" });
        (st.options || []).forEach((o, i) => opts.append(h("button", { class: "wb-option", onclick: (e) => {
          entry.attempts++;
          if (!Number.isInteger(st.answer) || i === st.answer) { e.currentTarget.classList.add("is-answer"); finish(o); }
          else { e.currentTarget.classList.add("chosen", "x"); e.currentTarget.disabled = true; wrong(); }
        } }, h("span", { class: "wb-letter" }, String.fromCharCode(65 + i)), rich(o, "", true))));
        body.append(opts);
      } else {
        const input = h("input", { class: "wb-input", placeholder: type === "number" ? "A number" : "Your answer" });
        const check = () => {
          const v = input.value.trim();
          if (!v) return;
          entry.attempts++;
          const ok = type === "number" ? checkNumber(v, st.answer, st.tolerance) : checkText(v, st.answer);
          // Free-form answers the checker can't judge are accepted and sent to the tutor.
          if (ok === true || ok === null) finish(v);
          else wrong();
        };
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Enter") check();
        });
        body.append(h("div", { class: "wb-answer-row" }, input, h("button", { class: "btn primary sm", onclick: check }, "Check"), hintBtn));
        setTimeout(() => !replay && input.focus(), 50);
      }
      if (type === "mcq" && hintBtn) body.append(h("div", { class: "wb-actions" }, hintBtn));
      body.append(fb);
      list.append(row);
      this._scrollEnd();
    };
    if (replay) card.classList.add("answered");
    show(0);
    return card;
  }

  // Slider-driven graph. Doesn't block the lesson.
  _explore(a) {
    const d = a.data || {};
    const params = d.params || {};
    const vals = {};
    const fig = h("div", { class: "wb-explore-fig" });
    const readout = h("div", { class: "wb-readout" });
    const redraw = () => {
      fig.replaceChildren(drawPlot(d, vals));
      readout.textContent = Object.entries(vals).map(([k, v]) => `${k} = ${Math.round(v * 100) / 100}`).join("   ");
    };
    const sliders = Object.entries(params).slice(0, 4).map(([name, spec]) => {
      const [min, max, start] = Array.isArray(spec) ? spec.map(Number) : [spec.min ?? 0, spec.max ?? 1, spec.value ?? spec.start ?? 0];
      vals[name] = Number.isFinite(start) ? start : (min + max) / 2;
      const input = h("input", { type: "range", min, max, step: (max - min) / 200 || 0.01, value: vals[name] });
      input.addEventListener("input", () => {
        vals[name] = Number(input.value);
        redraw();
        this._exploreTouched?.(a, vals);
      });
      input.addEventListener("change", () => this.onExplore({ id: d.id || a.id, values: { ...vals } }));
      return h("label", { class: "wb-slider" }, h("span", { class: "name" }, name), input);
    });
    redraw();
    return h("div", { class: "wb-card explore" }, h("div", { class: "wb-card-kicker" }, icon("bolt"), "Explore"), d.title ? rich(d.title, "wb-q") : null, fig, legend(d), h("div", { class: "wb-sliders" }, sliders), readout);
  }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  // Never start already solved.
  if (a.length > 1 && a.every((x, k) => x.i === k)) [a[0], a[1]] = [a[1], a[0]];
  return a;
}
