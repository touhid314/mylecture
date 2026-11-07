// Animated scenes for the whiteboard: simple shapes, emoji and text that move.
// The tutor describes them in compact JSON, e.g. a car driving down a road:
//   {"w":600,"h":220,"items":[{"type":"rect","x":0,"y":160,"w":600,"h":40,"fill":"#555"},
//     {"type":"emoji","id":"car","char":"🚗","x":40,"y":150,"size":56}],
//    "anim":[{"target":"car","to":{"x":540},"dur":4,"repeat":true}]}
const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== "") e.setAttribute(k, v);
  return e;
};
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
const color = (c, d) => (typeof c === "string" && COLOR.test(c.trim()) ? c.trim() : d);

const EASE = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  bounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// The anchor point of an item (what x/y animations move).
function anchor(it) {
  if (it.type === "circle" || it.type === "ellipse") return [num(it.x ?? it.cx), num(it.y ?? it.cy)];
  if (it.type === "line" || it.type === "arrow") return [num(it.x1), num(it.y1)];
  return [num(it.x), num(it.y)];
}

export function textAnchor(it, items = [], W = 600) {
  if (it.align === "left" || it.align === "start") return "start";
  if (it.align === "right" || it.align === "end") return "end";
  if (it.align === "center" || it.align === "middle") return "middle";
  const x = num(it.x), y = num(it.y), size = num(it.size, 20);
  const half = String(it.text ?? "").length * size * 0.28;
  // Centering at x would clip off the left or right edge of the scene.
  if (x - half < 8) return "start";
  if (x + half > W - 8 && x > W * 0.75) return "end";
  for (const o of items) {
    if (!o || o === it) continue;
    if (o.type === "rect") {
      const rx = num(o.x), ry = num(o.y), rw = num(o.w, 40), rh = num(o.h, 40);
      if (x > rx && x < rx + rw && y >= ry && y <= ry + rh && x - half < rx + 4 && x - rx < rw * 0.35) return "start";
    } else if (o.type === "circle" || o.type === "ellipse" || o.type === "emoji") {
      const ox = num(o.x ?? o.cx), oy = num(o.y ?? o.cy);
      const r = num(o.r ?? o.rx, num(o.size, 40) * 0.5);
      if (Math.abs(y - oy) <= Math.max(size, r) && x >= ox + r && x <= ox + r + 35 && x - half < ox + r) return "start";
    } else if (o.type === "line" || o.type === "arrow") {
      const x1 = num(o.x1), y1 = num(o.y1), x2 = num(o.x2), y2 = num(o.y2);
      const rmost = Math.max(x1, x2), ry = x2 >= x1 ? y2 : y1;
      if (Math.abs(y - ry) <= size && x >= rmost && x <= rmost + 35 && x - half < rmost) return "start";
    }
  }
  return "middle";
}

function shape(it, defsId, items, W) {
  const stroke = color(it.stroke, it.type === "line" || it.type === "arrow" || it.type === "path" ? "currentColor" : "none");
  const sw = num(it.width ?? it.strokeWidth, it.type === "line" || it.type === "arrow" ? 3 : 2);
  const fill = color(it.fill, it.type === "path" || it.type === "polyline" ? "none" : "currentColor");
  const common = { stroke, "stroke-width": sw, fill, opacity: it.opacity ?? null, "stroke-dasharray": typeof it.dash === "string" ? it.dash.replace(/[^\d\s.,]/g, "") : null, "stroke-linecap": "round", "stroke-linejoin": "round" };
  const [ax, ay] = anchor(it);
  switch (it.type) {
    case "rect":
      return el("rect", { ...common, x: 0, y: 0, width: num(it.w, 40), height: num(it.h, 40), rx: num(it.r ?? it.rx, 0) });
    case "circle":
      return el("circle", { ...common, cx: 0, cy: 0, r: num(it.r, 20) });
    case "ellipse":
      return el("ellipse", { ...common, cx: 0, cy: 0, rx: num(it.rx, 30), ry: num(it.ry, 18) });
    case "line":
    case "arrow":
      return el("line", { ...common, x1: 0, y1: 0, x2: num(it.x2) - ax, y2: num(it.y2) - ay, "marker-end": it.type === "arrow" ? `url(#${defsId})` : null });
    case "path":
      // Path coordinates are absolute; the group is placed at the anchor.
      return el("path", { ...common, d: String(it.d || "").replace(/[^MLHVCSQTAZmlhvcsqtaz\d\s.,-]/g, ""), transform: `translate(${-ax},${-ay})` });
    case "polygon":
    case "polyline":
      return el(it.type, { ...common, points: (it.points || []).map((p) => `${num(p[0]) - ax},${num(p[1]) - ay}`).join(" ") });
    case "text": {
      const t = el("text", { x: 0, y: 0, fill: color(it.color || it.fill, "currentColor"), "font-size": num(it.size, 20), "font-weight": it.bold ? 700 : null, "text-anchor": textAnchor(it, items, W), "dominant-baseline": "middle", "font-family": "Architects Daughter, Segoe UI, sans-serif" });
      t.textContent = String(it.text ?? "");
      return t;
    }
    case "emoji": {
      const t = el("text", { x: 0, y: 0, "font-size": num(it.size, 40), "text-anchor": "middle", "dominant-baseline": "central", "font-family": "Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif" });
      t.textContent = String(it.char || it.emoji || it.text || "❓").slice(0, 8);
      return t;
    }
    default:
      return null;
  }
}

export function renderScene(spec) {
  const W = Math.min(1200, Math.max(120, num(spec.w, 600)));
  const H = Math.min(800, Math.max(80, num(spec.h, 260)));
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "wb-scene" });
  // Ink that reads on the scene's own background (a light scene on the
  // blackboard still needs dark text).
  const lum = luminance(spec.bg);
  if (lum != null) svg.style.color = lum > 0.5 ? "#1f2328" : "#eef2ea";
  const arrowId = "ar" + Math.random().toString(36).slice(2, 8);
  const defs = el("defs");
  const marker = el("marker", { id: arrowId, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  marker.append(el("path", { d: "M0,0 L10,5 L0,10 z", fill: "context-stroke" }));
  defs.append(marker);
  svg.append(defs);
  if (spec.bg) svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: color(spec.bg, "none"), rx: 12 }));
  const nodes = new Map();
  const items = (Array.isArray(spec.items) ? spec.items : []).slice(0, 60);
  items.forEach((it, i) => {
    const s = shape(it, arrowId, items, W);
    if (!s) return;
    const [x, y] = anchor(it);
    // Pointable by id, its text, or a plain colour word ("the blue box").
    const words = [it.id, it.type === "text" ? it.text : null, ...[it.fill, it.stroke].filter((c) => /^[a-z]+$/i.test(String(c || "")))]
      .filter((w) => w != null && String(w).trim())
      .map((w) => String(w).toLowerCase().replace(/\s+/g, " ").trim());
    const g = el("g", { "data-id": it.id != null ? String(it.id) : null, "data-part": words.length ? [...new Set(words)].join("|") : null });
    const state = { x, y, rotate: num(it.rotate, 0), scale: num(it.scale, 1), opacity: num(it.opacity, 1), flip: !!it.flip, cx: 0, cy: 0 };
    if (it.type === "rect") {
      state.cx = num(it.w, 40) / 2;
      state.cy = num(it.h, 40) / 2;
    }
    g.append(s);
    svg.append(g);
    const node = { g, s, it, state, base: { ...state } };
    nodes.set(String(it.id ?? `#${i}`), node);
    apply(node);
  });
  const anims = (Array.isArray(spec.anim) ? spec.anim : []).slice(0, 30).map((a) => ({ ...a, node: nodes.get(String(a.target ?? a.id)) })).filter((a) => a.node);
  let raf = 0, t0 = 0, fitted = false;
  const fitText = () => {
    if (fitted || !svg.isConnected) return;
    fitted = true;
    const moved = new Set(anims.filter((a) => a.to?.x != null || a.from?.x != null || a.to?.dx != null || a.path || a.orbit).map((a) => a.node));
    for (const n of nodes.values()) {
      if (n.it.type !== "text" || moved.has(n)) continue;
      try {
        const b = n.s.getBBox();
        if (!b.width) continue;
        const pad = 8;
        if (b.width * n.base.scale > W - pad * 2) n.base.scale = (W - pad * 2) / b.width;
        const left = n.base.x + b.x * n.base.scale;
        const right = left + b.width * n.base.scale;
        if (left < pad) n.base.x += pad - left;
        else if (right > W - pad) n.base.x -= right - (W - pad);
        const top = n.base.y + b.y * n.base.scale;
        const bottom = top + b.height * n.base.scale;
        if (top < 4) n.base.y += 4 - top;
        else if (bottom > H - 4) n.base.y -= bottom - (H - 4);
        Object.assign(n.state, n.base);
        apply(n);
      } catch {}
    }
  };
  const total = anims.reduce((m, a) => Math.max(m, num(a.delay) + num(a.dur, 2) * (a.repeat === true ? 1 : Math.max(1, num(a.repeat, 1)))), 0);
  const frame = (now) => {
    if (!svg.isConnected && t0) return; // removed from the board
    fitText();
    if (!t0) t0 = now;
    const t = (now - t0) / 1000;
    let running = false;
    for (const n of nodes.values()) Object.assign(n.state, n.base);
    for (const a of anims) running = step(a, t) || running;
    for (const n of nodes.values()) apply(n);
    if (running) raf = requestAnimationFrame(frame);
  };
  const play = () => {
    cancelAnimationFrame(raf);
    t0 = 0;
    raf = requestAnimationFrame(frame);
  };
  // Start once it is on the board.
  requestAnimationFrame(() => requestAnimationFrame(play));
  svg._replay = play;
  svg._duration = total;
  return svg;
}

// Advances one animation to time t (seconds). Returns true while it runs.
function step(a, t) {
  const st = a.node.state;
  const dur = Math.max(0.05, num(a.dur, 2));
  const delay = num(a.delay, 0);
  let local = t - delay;
  if (local < 0) {
    if (a.from) Object.assign(st, pick(a.from, a.node));
    return true;
  }
  const reps = a.repeat === true ? Infinity : Math.max(1, num(a.repeat, 1));
  let cycle = Math.floor(local / dur);
  let p = (local % dur) / dur;
  const done = cycle >= reps;
  if (done) {
    cycle = reps - 1;
    p = 1;
  }
  if (a.yoyo && cycle % 2 === 1) p = 1 - p;
  const e = (EASE[a.ease] || (a.path || a.orbit ? EASE.linear : EASE.inout))(p);
  if (a.orbit) {
    const o = a.orbit;
    const ang = (num(o.start, 0) + e * 360 * (o.ccw ? -1 : 1)) * (Math.PI / 180);
    st.x = num(o.cx) + num(o.r ?? o.rx, 80) * Math.cos(ang);
    st.y = num(o.cy) + num(o.r ?? o.ry, 80) * Math.sin(ang);
  } else if (Array.isArray(a.path) && a.path.length > 1) {
    const pts = a.path.map((q) => [num(q[0]), num(q[1])]);
    const segs = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    const len = segs.reduce((s, x) => s + x, 0) || 1;
    let d = e * len, i = 0;
    while (i < segs.length - 1 && d > segs[i]) d -= segs[i++];
    const f = segs[i] ? d / segs[i] : 0;
    st.x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f;
    st.y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
  }
  const from = { ...st, ...pick(a.from || {}, a.node) };
  const to = pick(a.to || {}, a.node);
  for (const k of Object.keys(to)) st[k] = from[k] + (to[k] - from[k]) * e;
  if (a.count && a.node.it.type === "text") {
    const [c0, c1] = a.count.map(Number);
    const v = c0 + (c1 - c0) * e;
    const digits = num(a.decimals, Number.isInteger(c0) && Number.isInteger(c1) ? 0 : 1);
    a.node.s.textContent = String(a.format || "{}").replace("{}", v.toFixed(digits));
  }
  if (a.set && p >= 1 && a.node.it.type === "text" && typeof a.set.text === "string") a.node.s.textContent = a.set.text;
  return !done;
}

function pick(o, node) {
  const out = {};
  for (const k of ["x", "y", "rotate", "scale", "opacity"]) if (o[k] != null && Number.isFinite(Number(o[k]))) out[k] = Number(o[k]);
  // Relative moves: {"dx": 200}
  if (o.dx != null) out.x = node.base.x + num(o.dx);
  if (o.dy != null) out.y = node.base.y + num(o.dy);
  return out;
}

function apply(n) {
  const { x, y, rotate, scale, opacity, flip, cx, cy } = n.state;
  n.g.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${rotate.toFixed(2)},${cx},${cy}) scale(${(flip ? -scale : scale).toFixed(3)},${scale.toFixed(3)})`);
  n.g.setAttribute("opacity", Math.max(0, Math.min(1, opacity)).toFixed(3));
}

// 0 (black) .. 1 (white) for #rgb / #rrggbb / rgb(); null when unknown.
function luminance(c) {
  if (typeof c !== "string") return null;
  let r, g, b;
  const s = c.trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) [r, g, b] = m[1].split("").map((x) => parseInt(x + x, 16));
  else if ((m = s.match(/^#([0-9a-f]{6})/i))) [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i))) [r, g, b] = m.slice(1, 4).map(Number);
  else if (/^(white|ivory|snow|beige|linen|azure|aliceblue|lightyellow|lightblue|lightgray|lightgrey|whitesmoke)$/i.test(s)) return 0.95;
  else if (/^(black|navy|midnightblue|darkslategray|darkslategrey|darkblue)$/i.test(s)) return 0.05;
  else return null;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
