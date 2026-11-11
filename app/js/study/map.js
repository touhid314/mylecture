// The tutor's map: a real world map (Natural Earth, app/assets/world-map.json,
// built by scripts/make-world-map.mjs) in the same projection as the video
// agent's basemap. Places, routes, areas and highlighted countries are given
// in longitude/latitude, so they always sit in the right spot. The camera
// zooms in and out smoothly (to a country, a city, a route...), routes can be
// traced along their path with the camera following. Only the tutor moves
// the camera; the student doesn't pan or zoom it.
//
// spec: {view|bounds|focus|center+span, zoom_from, update, countries, places,
//        routes, areas, labels, borders, caption}
const NS = "http://www.w3.org/2000/svg";
const W = 1920, H = 1080, PAD = { l: 48, t: 36, r: 48, b: 72 }, LAT_MIN = -58, LAT_MAX = 84;
const SCALE = (W - PAD.l - PAD.r) / 360;
const Y0 = PAD.t + ((H - PAD.t - PAD.b) - (LAT_MAX - LAT_MIN) * SCALE) / 2;
const COLORS = ["#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#a855f7", "#ec4899", "#14b8a6", "#f97316"];

// Longitude first, then latitude (a swapped pair is corrected).
export function project(lon, lat) {
  lon = Number(lon); lat = Number(lat);
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lon, lat] = [lat, lon];
  return [PAD.l + (lon + 180) * SCALE, Y0 + (LAT_MAX - lat) * SCALE];
}

let world = null;
export function loadWorld() {
  world ||= fetch(new URL("../../assets/world-map.json", import.meta.url)).then((r) => {
    if (!r.ok) throw new Error(`world map HTTP ${r.status}`);
    return r.json();
  }).then(indexWorld).catch((e) => {
    world = null;
    throw e;
  });
  return world;
}

export function indexWorld(w) {
  w.byName = new Map();
  for (const c of w.countries) for (const k of countryKeys(c.name)) if (!w.byName.has(k)) w.byName.set(k, c);
  return w;
}

// ----- country names -----
const ABBR = [[/\bdem\b\.?/g, "democratic"], [/\brep\b\.?/g, "republic"], [/\bis\b\.?/g, "islands"], [/\bi\b\./g, "island"], [/\bst\b[.-]?/g, "saint"], [/\bn\b\./g, "north"], [/\bs\b\./g, "south"], [/\bw\b\./g, "western"], [/\beq\b\./g, "equatorial"], [/\bfr\b\./g, "french"], [/\bbr\b\./g, "british"], [/\bherz\b\./g, "herzegovina"], [/\bbarb\b\./g, "barbuda"], [/\bgren\b\./g, "grenadines"], [/\bvin\b\./g, "vincent"], [/\bgeo\b\./g, "georgia"], [/\bter\b\./g, "territory"]];
const ALIASES = {
  "usa": "united states of america", "us": "united states of america", "united states": "united states of america", "america": "united states of america", "the united states": "united states of america",
  "uk": "united kingdom", "britain": "united kingdom", "great britain": "united kingdom", "the uk": "united kingdom",
  "drc": "democratic republic congo", "dr congo": "democratic republic congo", "congo kinshasa": "democratic republic congo", "democratic republic of the congo": "democratic republic congo",
  "republic of the congo": "congo", "congo brazzaville": "congo", "ivory coast": "cote d ivoire", "czech republic": "czechia",
  "east timor": "timor leste", "burma": "myanmar", "swaziland": "eswatini", "macedonia": "north macedonia", "holland": "netherlands",
  "uae": "united arab emirates", "car": "central african republic", "bosnia": "bosnia and herzegovina", "korea": "south korea",
  "palestinian territories": "palestine",
};
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function canon(name) {
  let s = norm(name).replace(/^the\s+/, "");
  for (const [re, to] of ABBR) s = s.replace(re, to);
  return s.replace(/&/g, "and").replace(/[^a-z0-9 ]+/g, " ").replace(/\b(of|the)\b/g, " ").replace(/\s+/g, " ").trim();
}
function countryKeys(name) {
  return [norm(name).trim(), canon(name)];
}
export function findCountry(w, name) {
  if (!w || !name || typeof name !== "string") return null;
  const raw = norm(name).trim();
  const key = ALIASES[raw] ? canon(ALIASES[raw]) : canon(name);
  const hit = w.byName.get(raw) || w.byName.get(key) || w.byName.get(canon(ALIASES[key] || ""));
  if (hit) return hit;
  if (!key) return null;
  // A unique name that starts with, or contains, the request.
  const all = [...new Set(w.byName.values())];
  const starts = all.filter((c) => canon(c.name).startsWith(key));
  if (starts.length === 1) return starts[0];
  const has = all.filter((c) => canon(c.name).includes(key));
  return has.length === 1 ? has[0] : null;
}

// ----- views -----
const r1 = (v) => Math.round(v * 10) / 10;

// A box in map pixels -> a padded 16:9 view [x, y, w, h].
export function fitBox(x0, y0, x1, y1, pad = 0.08) {
  let vw = Math.max(8, Math.abs(x1 - x0)), vh = Math.max(8, Math.abs(y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  vw *= 1 + pad * 2; vh *= 1 + pad * 2;
  if (vw / vh < 16 / 9) vw = (vh * 16) / 9;
  else vh = (vw * 9) / 16;
  if (vw > W) { vw = W; vh = H; }
  const x = Math.max(0, Math.min(W - vw, cx - vw / 2)), y = Math.max(0, Math.min(H - vh, cy - vh / 2));
  return [x, y, vw, vh].map(r1);
}
const lonLatBox = (b) => { const [x0, y1] = project(b[0], b[1]), [x1, y0] = project(b[2], b[3]); return [x0, y0, x1, y1]; };

// The view a spec asks for (the most specific request wins: bounds, then
// countries, then "world", then center+span; otherwise fit what's on it).
export function viewFor(spec, w) {
  const s = spec || {};
  const asBox = (v) => Array.isArray(v) && v.length === 4 && v.every((n) => Number.isFinite(Number(n))) ? v.map(Number) : null;
  const isWorld = (v) => v === "world";
  let b = asBox(s.bounds) || asBox(s.view);
  if (!b && (s.focus || (typeof s.view === "string" && !isWorld(s.view)))) {
    const boxes = [].concat(s.focus || s.view).map((n) => findCountry(w, n)?.box).filter(Boolean);
    if (boxes.length) b = [Math.min(...boxes.map((x) => x[0])), Math.min(...boxes.map((x) => x[1])), Math.max(...boxes.map((x) => x[2])), Math.max(...boxes.map((x) => x[3]))];
  }
  if (!b && (isWorld(s.view) || isWorld(s.bounds))) b = [-180, LAT_MIN, 180, LAT_MAX];
  if (!b && Array.isArray(s.center)) {
    const span = Math.max(0.5, Number(s.span) || 30);
    const [lon, lat] = s.center.map(Number);
    b = [lon - span / 2, lat - span / 4, lon + span / 2, lat + span / 4];
  }
  if (!b) {
    const pts = [];
    for (const p of [...(s.places || []), ...(s.areas || []), ...(s.labels || [])]) if (Number.isFinite(Number(p?.lon))) pts.push([Number(p.lon), Number(p.lat)]);
    for (const r of s.routes || []) for (const p of [r.from, r.to, ...(r.via || []), ...(r.path || [])]) if (Array.isArray(p)) pts.push(p.map(Number));
    for (const c of s.countries || []) { const box = findCountry(w, c?.name || c)?.box; if (box) pts.push([box[0], box[1]], [box[2], box[3]]); }
    if (pts.length) {
      b = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
      const grow = Math.max(4, (b[2] - b[0]) * 0.15, (b[3] - b[1]) * 0.15);
      b = [b[0] - grow, b[1] - grow, b[2] + grow, b[3] + grow];
    } else b = [-180, LAT_MIN, 180, LAT_MAX];
  }
  if (Math.abs(b[1]) > 90 || Math.abs(b[3]) > 90) b = [b[1], b[0], b[3], b[2]]; // (lat, lon) given
  const [x0, y1] = project(Math.min(b[0], b[2]), Math.min(b[1], b[3]));
  const [x1, y0] = project(Math.max(b[0], b[2]), Math.max(b[1], b[3]));
  return fitBox(x0, y0, x1, y1);
}

// Points of the great circle between two lon/lat points (flights, ships on
// open ocean): the real shortest path, which curves on this flat map.
export function greatCircle(a, b, n = 48) {
  const rad = Math.PI / 180, [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!(d > 1e-6)) return [a, b];
  const out = [];
  let prev = a[0];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lon = Math.atan2(y, x) / rad;
    // Keep longitudes continuous (a flight across the Pacific).
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, Math.atan2(z, Math.hypot(x, y)) / rad]);
    prev = lon;
  }
  return out;
}

// ----- drawing -----
// Markers and labels are drawn in screen-sized units at (0,0) and placed with
// translate + scale(var(--u)); --u follows the zoom, so text and dots keep
// their size on screen however far the map zooms in or out.
function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, String(v));
  for (const k of kids) if (k) e.append(k);
  return e;
}
const color = (c, i) => (/^#[0-9a-f]{3,8}$/i.test(c || "") || /^[a-z]+$/i.test(c || "") ? c : COLORS[i % COLORS.length]);
const aliasList = (...xs) => [...new Set(xs.filter((x) => typeof x === "string" && x).map((x) => x.toLowerCase().trim()))].join("|");
const place = (x, y) => `translate(${r1(x)}px, ${r1(y)}px) scale(var(--u))`;
const at = (x, y, ...kids) => el("g", { class: "wb-map-glyph", style: `transform: ${place(x, y)}` }, ...kids);
const text = (str, attrs = {}) => el("text", { class: "wb-map-label", "stroke-width": 3.5, "dominant-baseline": "middle", ...attrs }, document.createTextNode(String(str)));
const thick = (n) => `calc(var(--u) * ${n}px)`;
const boxOf = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];

// One item group: an id to point at, reveal or zoom to (data-box: its extent
// in map pixels); hidden until its word if asked (and not shown yet).
function group(item, cls, names, box, shown) {
  const g = el("g", { class: cls, "data-id": item.id != null ? String(item.id) : null, "data-part": aliasList(item.id != null ? String(item.id) : "", item.label, item.name, ...names) || null, "data-box": box ? box.map(r1).join(" ") : null });
  if (item.hidden && !shown.has(String(item.id))) g.setAttribute("opacity", "0");
  return g;
}

function routePath(points, curve) {
  const [a, b] = [points[0], points[points.length - 1]];
  if (points.length > 2) return "M" + points.map((p) => p.map(r1).join(",")).join("L");
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const bend = Number.isFinite(Number(curve)) ? Number(curve) : 0.2;
  const mx = (a[0] + b[0]) / 2 - dy * bend, my = (a[1] + b[1]) / 2 + dx * bend;
  return `M${r1(a[0])},${r1(a[1])}Q${r1(mx)},${r1(my)} ${r1(b[0])},${r1(b[1])}`;
}

// Draws the overlay (everything but the countries' outlines) for one spec.
function overlay(svg, spec, w) {
  const layer = el("g", { class: "wb-map-overlay" });
  const shown = svg._shown || new Set(), traced = svg._traced || new Set(), tracing = svg._tracing || new Map();
  const lonlat = new Map(); // place id -> [lon, lat]
  for (const p of spec.places || []) if (p?.id != null && Number.isFinite(Number(p.lon))) lonlat.set(String(p.id), [Number(p.lon), Number(p.lat)]);
  const ll = (p) => {
    if (typeof p === "string" && lonlat.has(p)) return lonlat.get(p);
    if (Array.isArray(p) && p.length >= 2 && p.every((n) => Number.isFinite(Number(n)))) return [Number(p[0]), Number(p[1])];
    if (p && typeof p === "object" && Number.isFinite(Number(p.lon))) return [Number(p.lon), Number(p.lat)];
    if (typeof p === "string") { const c = findCountry(w, p); if (c) return c.center; }
    return null;
  };

  // Highlighted countries: filled, outlined, named.
  (spec.countries || []).forEach((raw, i) => {
    const c = typeof raw === "string" ? { name: raw } : raw || {};
    const hit = findCountry(w, c.name);
    if (!hit) return;
    const g = group({ ...c, id: c.id || canon(hit.name).replace(/\s+/g, "-") }, "wb-map-country", [hit.name, c.name], lonLatBox(hit.box), shown);
    const fill = color(c.color, i);
    g.append(el("path", { d: hit.d, fill, "fill-opacity": c.opacity ?? 0.55, stroke: fill, style: `stroke-width: ${thick(1.6)}`, "stroke-linejoin": "round", "clip-path": `url(#${svg.dataset.clip})` }));
    if (c.label !== false) {
      const [x, y] = project(...(Array.isArray(c.at) ? c.at : hit.center));
      g.append(at(x, y, text(c.label || hit.name, { "font-size": c.size || 15, "text-anchor": "middle" })));
    }
    layer.append(g);
  });

  for (const a of spec.areas || []) {
    if (!Number.isFinite(Number(a?.lon))) continue;
    const [x, y] = project(a.lon, a.lat);
    const km = Math.max(1, Number(a.km) || 200);
    const ry = (km / 111) * SCALE, rx = ry / Math.max(0.15, Math.cos((Number(a.lat) * Math.PI) / 180));
    const c = color(a.color, 1);
    const g = group(a, "wb-map-area", [], [x - rx, y - ry, x + rx, y + ry], shown);
    g.append(el("ellipse", { cx: r1(x), cy: r1(y), rx: r1(rx), ry: r1(ry), fill: c, "fill-opacity": 0.22, stroke: c, style: `stroke-width: ${thick(1.6)}; stroke-dasharray: ${thick(5)} ${thick(4)}` }));
    if (a.label) g.append(at(x, y - ry, text(a.label, { y: -10, "font-size": 14, "text-anchor": "middle" })));
    layer.append(g);
  }

  (spec.routes || []).forEach((r, i) => {
    if (!r) return;
    let lls = (Array.isArray(r.path) ? r.path : [r.from, ...(r.via || []), r.to]).map(ll).filter(Boolean);
    if (lls.length < 2) return;
    // Real flight paths: the great circle between each pair of points.
    if (r.great_circle || r.greatCircle || r.geodesic) lls = lls.slice(1).reduce((acc, p, k) => acc.concat(greatCircle(lls[k], p).slice(k ? 1 : 0)), []);
    const pts = lls.map(([lon, lat]) => project(lon, lat));
    const c = color(r.color, i + 2);
    const d = routePath(pts, pts.length > 2 ? 0 : r.curve);
    // Drawn by its trace (still to come, or under way when the map is redrawn).
    const waiting = !!r.trace && (!traced.has(String(r.id)) || tracing.has(String(r.id)));
    const g = group(r, "wb-map-route", [], boxOf(pts), shown);
    if (r.trace) g.dataset.trace = "true";
    const stops = [r.from, ...(r.via || []), r.to].filter((p) => typeof p === "string" && lonlat.has(p));
    if (stops.length) g.dataset.stops = stops.join(" ");
    g.dataset.dur = String(Math.max(1, Math.min(60, Number(r.dur) || 6)));
    if (r.follow) g.dataset.follow = Number(r.follow) > 0 && r.follow !== true ? String(Number(r.follow)) : "true";
    const drawOn = !r.dash && !r.trace;
    const path = el("path", { class: `wb-map-line${drawOn ? " wb-map-draw" : ""}`, d, fill: "none", stroke: c, "stroke-linecap": "round", "stroke-linejoin": "round", pathLength: drawOn ? 100 : null,
      style: `stroke-width: ${thick(r.width || 3)}${r.dash ? `; stroke-dasharray: ${thick(8)} ${thick(6)}` : ""}${waiting ? "; opacity: 0" : ""}` });
    g.append(path);
    if (r.arrow !== false) {
      const marker = `wb-map-arrow-${Math.random().toString(36).slice(2, 8)}`;
      svg.querySelector(".wb-map-defs").append(el("marker", { id: marker, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, el("path", { d: "M0,0L10,5L0,10z", fill: c })));
      // A traced route gets its arrowhead when the trace arrives.
      g.dataset.arrow = `url(#${marker})`;
      if (!waiting) path.setAttribute("marker-end", g.dataset.arrow);
    }
    if (r.label) {
      const m = pts.length > 2 ? pts[Math.floor(pts.length / 2)] : [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      g.append(at(m[0], m[1], text(r.label, { y: -11, "font-size": 13, "text-anchor": "middle", fill: c })));
    }
    // What travels: at the head of a trace, or looping along the route.
    const icon = typeof r.moving === "string" && r.moving !== "true" ? r.moving : "";
    if (r.moving || r.trace) {
      const glyph = icon ? text(icon, { "font-size": 22, "text-anchor": "middle", "dominant-baseline": "central", "stroke-width": 0 }) : el("circle", { r: 5.5, fill: c, stroke: "#fff", "stroke-width": 1.6 });
      if (r.trace) {
        const end = pts[pts.length - 1];
        g.append(el("g", { class: "wb-map-head", style: `transform: ${place(end[0], end[1])}; opacity: ${waiting ? 0 : 1}` }, glyph));
      } else {
        const mover = el("g", {}, el("g", { style: "transform: scale(var(--u))" }, glyph));
        mover.append(el("animateMotion", { dur: `${Math.max(1, Number(r.dur) || 4)}s`, repeatCount: r.repeat === false ? 1 : "indefinite", path: d, fill: "freeze", rotate: r.rotate ? "auto" : null }));
        g.append(mover);
      }
    }
    layer.append(g);
  });

  for (const p of spec.places || []) {
    if (!Number.isFinite(Number(p?.lon))) continue;
    const [x, y] = project(p.lon, p.lat);
    const c = color(p.color, 1);
    // Zooming to a place shows "zoom" degrees of longitude around it (8 by default).
    const span = (Math.max(0.3, Number(p.zoom) || 8) * SCALE) / 2;
    const g = group(p, "wb-map-place", [], [x - span, y - span * 0.5625, x + span, y + span * 0.5625], shown);
    const mark = p.icon ? text(p.icon, { "font-size": p.size || 26, "text-anchor": "middle", "dominant-baseline": "central", "stroke-width": 0 })
      : el("g", {}, el("circle", { r: 9, fill: c, opacity: 0.25, class: "wb-map-pulse" }), el("circle", { r: 5, fill: c, stroke: "#fff", "stroke-width": 1.6 }));
    const side = p.side === "left" ? -1 : 1;
    g.append(at(x, y, mark, p.label ? text(p.label, { x: side * (p.icon ? 16 : 9), "font-size": p.text_size || 15, "text-anchor": side > 0 ? "start" : "end" }) : null));
    layer.append(g);
  }

  for (const t of spec.labels || []) {
    if (!Number.isFinite(Number(t?.lon))) continue;
    const [x, y] = project(t.lon, t.lat);
    const g = group({ ...t, label: t.text }, "wb-map-text", [], [x - 60, y - 30, x + 60, y + 30], shown);
    g.append(at(x, y, text(t.text || "", { class: "wb-map-label wb-map-note", "font-size": t.size || 14, "text-anchor": "middle", fill: t.color || null, "font-style": t.italic ? "italic" : null })));
    layer.append(g);
  }
  return layer;
}

// ----- the camera -----
function setView(svg, v) {
  svg.setAttribute("viewBox", v.map(r1).join(" "));
  svg.style.setProperty("--u", String(Math.round((v[2] / 700) * 1000) / 1000));
  svg._view = v;
}

// Moves the view to `to` (map pixels): zooming on a log scale, so zooming in
// and out feel even. A newer move cancels this one.
export function moveCamera(svg, to, { dur = 1300 } = {}) {
  const token = (svg._move = (svg._move || 0) + 1);
  const from = svg._view;
  if (!from || dur <= 0 || from.join(" ") === to.join(" ")) { setView(svg, to); declutter(svg); return Promise.resolve(true); }
  const t0 = performance.now();
  return new Promise((done) => {
    const step = () => {
      if (svg._move !== token) return done(false);
      const k = Math.min(1, Math.max(0, (performance.now() - t0) / dur)), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const zw = from[2] * Math.pow(to[2] / from[2], e), zh = (zw * 9) / 16;
      const cx = from[0] + from[2] / 2 + (to[0] + to[2] / 2 - from[0] - from[2] / 2) * e;
      const cy = from[1] + from[3] / 2 + (to[1] + to[3] / 2 - from[1] - from[3] / 2) * e;
      if (k < 1) {
        setView(svg, [cx - zw / 2, cy - zh / 2, zw, zh]);
        requestAnimationFrame(step);
      } else {
        setView(svg, to);
        declutter(svg);
        done(true);
      }
    };
    requestAnimationFrame(step);
  });
}

// target: "" (the map's own view), "world", an item id on the map (or its
// label), or a country name. -> a view, or null.
export function viewOf(svg, target, w = svg._world) {
  const t = String(target || "").trim();
  // The map's own view: where it settled (readable), else what it asked for.
  if (!t) return svg._home || viewFor(svg._spec || {}, w);
  if (t.toLowerCase() === "world") return [0, 0, W, H];
  const items = [...svg.querySelectorAll(".wb-map-overlay [data-box]")];
  const g = items.find((e) => e.dataset.id === t) || items.find((e) => (e.dataset.part || "").split("|").includes(t.toLowerCase()));
  if (g) {
    const [x0, y0, x1, y1] = g.dataset.box.split(" ").map(Number);
    return fitBox(x0, y0, x1, y1, g.classList.contains("wb-map-place") ? 0 : 0.12);
  }
  const c = findCountry(w, t);
  return c ? fitBox(...lonLatBox(c.box), 0.12) : null;
}

export function zoomMap(svg, target) {
  const v = viewOf(svg, target);
  if (v) svg._chosen = true; // the tutor framed this on purpose
  return v ? moveCamera(svg, v) : Promise.resolve(false);
}

// Makes sure an item on the map is in view: when the tutor reveals, points
// at or traces something outside the current view (London, while the map
// shows the USA), the camera widens to take it in, keeping what was in view.
// -> true if the camera moved.
export function bringIntoView(svg, item) {
  const box = item?.dataset?.box?.split(" ").map(Number);
  const v = svg._view;
  if (!box || box.length !== 4 || !v) return false;
  // A place needs its dot and label to be visible (its box is the area to
  // zoom to, not what must be seen): use what is actually drawn.
  let [x0, y0, x1, y1] = box;
  if (item.classList.contains("wb-map-place")) {
    let bb = null;
    try { bb = item.getBBox(); } catch {}
    if (bb && bb.width > 0) [x0, y0, x1, y1] = [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height];
    else { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = v[2] * 0.08; [x0, y0, x1, y1] = [cx - r, cy - r / 2, cx + r, cy + r / 2]; }
  }
  // Fully visible already: leave the camera where the tutor put it.
  if (x0 >= v[0] && y0 >= v[1] && x1 <= v[0] + v[2] && y1 <= v[1] + v[3]) return false;
  moveCamera(svg, fitBox(Math.min(x0, v[0]), Math.min(y0, v[1]), Math.max(x1, v[0] + v[2]), Math.max(y1, v[1] + v[3]), 0.04));
  return true;
}

// ----- keeping the map readable -----
const visible = (g) => g.getAttribute("opacity") !== "0" || g.style.opacity === "1";
// A place's dot (its solid centre, not the pulsing halo) or icon.
export const dotOf = (g) => { const m = g.querySelector(".wb-map-glyph > :first-child"); return m?.tagName === "g" ? m.lastElementChild : m; };
const overlapArea = (a, b, pad = 2) => Math.max(0, Math.min(a.right, b.right) + pad - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) + pad - Math.max(a.top, b.top));

// Where a label may go around its anchor (local, screen-sized units).
const PLACE_SPOTS = [[9, 0, "start"], [-9, 0, "end"], [0, -15, "middle"], [0, 15, "middle"], [8, -12, "start"], [8, 12, "start"], [-8, -12, "end"], [-8, 12, "end"]];
const CENTER_SPOTS = [[0, 0, "middle"], [0, -17, "middle"], [0, 17, "middle"], [-34, 0, "middle"], [34, 0, "middle"]];

// Places every visible label where it doesn't cover another label or a
// dot: beside its dot (right, left, above, below...), a country's name near
// its centre. -> how many labels still overlap something.
export function declutter(svg) {
  const layer = svg.querySelector(".wb-map-overlay");
  if (!layer || !svg.isConnected) return 0;
  const frame = svg.getBoundingClientRect();
  if (!frame.width) return 0;
  const groups = [...layer.children].filter(visible);
  // Dots (and icons) are fixed obstacles.
  const taken = groups.filter((g) => g.classList.contains("wb-map-place")).map((g) => dotOf(g)?.getBoundingClientRect()).filter(Boolean);
  let crowded = 0;
  for (const cls of ["wb-map-place", "wb-map-country", "wb-map-area", "wb-map-route", "wb-map-text"]) for (const g of groups.filter((e) => e.classList.contains(cls))) {
    const label = g.querySelector(".wb-map-glyph > text.wb-map-label");
    if (!label) continue;
    label.dataset.y0 ??= label.getAttribute("y") || "0";
    label.dataset.x0 ??= label.getAttribute("x") || "0";
    label.dataset.a0 ??= label.getAttribute("text-anchor") || "middle";
    const icon = cls === "wb-map-place" && g.querySelector(".wb-map-glyph > text:first-child:not(.wb-map-label)");
    // The label's own side first (the tutor may have asked for "side":"left").
    const own = [Number(label.dataset.x0), Number(label.dataset.y0), label.dataset.a0];
    const spots = cls === "wb-map-place" ? [own, ...PLACE_SPOTS.map(([x, y, a]) => [x * (icon ? 1.8 : 1), y * (icon ? 1.5 : 1), a])]
      : cls === "wb-map-country" ? CENTER_SPOTS : [own, [0, 13, "middle"], [0, -24, "middle"]];
    let best = null;
    for (const [x, y, anchor] of spots) {
      label.setAttribute("x", x); label.setAttribute("y", y); label.setAttribute("text-anchor", anchor);
      const r = label.getBoundingClientRect();
      // Off the figure counts as badly as covering something.
      const out = Math.max(0, frame.left - r.left) + Math.max(0, r.right - frame.right) + Math.max(0, frame.top - r.top) + Math.max(0, r.bottom - frame.bottom);
      const cost = taken.reduce((n, t) => n + overlapArea(r, t), 0) + out * r.height * 2;
      if (!best || cost < best.cost) best = { x, y, anchor, r, cost };
      if (cost === 0) break;
    }
    label.setAttribute("x", best.x); label.setAttribute("y", best.y); label.setAttribute("text-anchor", best.anchor);
    if (best.cost > best.r.width * best.r.height * 0.08) crowded++;
    taken.push(best.r);
  }
  svg.dataset.crowded = String(crowded);
  return crowded;
}

// What the student should see, as boxes in map pixels: everything visible
// (places, highlighted countries, areas, routes), and the places alone.
function interest(svg) {
  const all = [], places = [];
  for (const g of svg.querySelectorAll(".wb-map-overlay > [data-box]")) {
    if (!visible(g) || g.classList.contains("wb-map-text")) continue;
    const b = g.dataset.box.split(" ").map(Number);
    if (g.classList.contains("wb-map-place")) { const c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; all.push([...c, ...c]); places.push([...c, ...c]); }
    else all.push(b);
  }
  const union = (bs) => bs.length ? [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))] : null;
  return { all: union(all), places: union(places) };
}

// A view around a box, at least `minDeg` degrees of longitude wide.
function frameOf(box, minDeg) {
  let [x0, y0, x1, y1] = box;
  const minW = minDeg * SCALE;
  if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
  return fitBox(x0, y0, x1, y1, 0.22);
}

// After the map changes, keep it readable: labels are re-placed so they
// don't cover each other, and if they still crowd together the camera moves
// in to the widest view where they come apart (everything of interest
// first, then just the places, closer). It only ever zooms in, and a view
// the tutor chose with a zoom cue is kept (only the labels move).
export function settle(svg) {
  clearTimeout(svg._settle);
  return new Promise((resolve) => {
    svg._settle = setTimeout(async () => {
      if (!svg.isConnected || (svg._tracing && svg._tracing.size)) return resolve(declutter(svg));
      const crowded = declutter(svg);
      const v = svg._view;
      if (!crowded || !v || svg._chosen) return resolve(crowded);
      const { all, places } = interest(svg);
      const tries = [];
      if (all) tries.push(frameOf(all, 12));
      if (places) tries.push(frameOf(places, 12), frameOf(places, 6), frameOf(places, 3), frameOf(places, 1.5));
      // Test each framing without showing it (layout only, no paint between).
      let best = null;
      for (const t of tries) {
        if (t[2] >= v[2] * 0.9) continue; // only ever closer in
        setView(svg, t);
        const n = declutter(svg);
        if (!best || n < best.n) best = { t, n };
        if (n === 0) break;
      }
      setView(svg, v);
      declutter(svg);
      if (best && best.n < crowded) {
        if (svg._settling) svg._home = best.t; // this is the map's readable view now
        await moveCamera(svg, best.t);
      }
      resolve(Number(svg.dataset.crowded || 0));
    }, 60);
  });
}

// Reveals an item for good (it stays shown when the map is updated).
export function markShown(svg, id) {
  (svg._shown ||= new Set()).add(String(id));
}

// Draws a route along its path with the traveller at its head; the stops it
// reaches light up; with follow, the camera travels along with it.
export function traceRoute(svg, id, { elapsed = 0 } = {}) {
  const g = [...svg.querySelectorAll(".wb-map-route[data-id]")].find((e) => e.dataset.id === String(id));
  const path = g?.querySelector(".wb-map-line");
  if (!g || !path) return Promise.resolve(false);
  markShown(svg, id);
  (svg._traced ||= new Set()).add(String(id));
  g.removeAttribute("opacity");
  g.style.opacity = "1";
  path.removeAttribute("marker-end");
  path.classList.remove("wb-map-draw");
  path.removeAttribute("pathLength");
  const L = path.getTotalLength();
  const dur = Number(g.dataset.dur || 6) * 1000;
  const head = g.querySelector(".wb-map-head");
  const places = [...svg.querySelectorAll(".wb-map-place[data-id]")];
  const stops = (g.dataset.stops || "").split(" ").filter(Boolean).map((sid) => places.find((e) => e.dataset.id === sid)).filter(Boolean)
    .map((e) => { const [x0, y0, x1, y1] = e.dataset.box.split(" ").map(Number); return { e, x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; });
  const light = (e) => { e.removeAttribute("opacity"); e.style.transition = "opacity .4s ease"; e.style.opacity = "1"; markShown(svg, e.dataset.id); };
  const follow = g.dataset.follow;
  const span = follow && follow !== "true" ? Number(follow) * SCALE : null;
  if (!follow && !elapsed) bringIntoView(svg, g);
  path.style.strokeDasharray = `${L} ${L}`;
  path.style.strokeDashoffset = String(L);
  path.style.opacity = "1";
  if (head) head.style.opacity = "1";
  if (stops[0]) light(stops[0].e);
  const token = (g._trace = (g._trace || 0) + 1);
  const t0 = performance.now() - elapsed;
  (svg._tracing ||= new Map()).set(String(id), { t0, dur });
  return new Promise((done) => {
    const step = () => {
      if (g._trace !== token || !g.isConnected) return done(false); // (a redraw resumes it)
      const k = Math.min(1, (performance.now() - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      path.style.strokeDashoffset = String(L * (1 - e));
      const p = path.getPointAtLength(L * e);
      if (head) head.style.transform = place(p.x, p.y);
      const near = (svg._view?.[2] || W) / 50;
      for (const s of stops) if (Math.hypot(s.x - p.x, s.y - p.y) < near && s.e.style.opacity !== "1") light(s.e);
      if (follow) {
        // The camera keeps the traveller in view at a steady zoom.
        const v = svg._view || [0, 0, W, H];
        const vw = span || v[2], vh = (vw * 9) / 16;
        svg._move = (svg._move || 0) + 1; // the trace drives the camera now
        const f = 0.12;
        setView(svg, [v[0] + (p.x - vw / 2 - v[0]) * f, v[1] + (p.y - vh / 2 - v[1]) * f, v[2] + (vw - v[2]) * f, v[3] + (vh - v[3]) * f]);
      }
      if (k < 1) return requestAnimationFrame(step);
      svg._tracing?.delete(String(id));
      path.style.strokeDasharray = "";
      path.style.strokeDashoffset = "";
      if (g.dataset.arrow) path.setAttribute("marker-end", g.dataset.arrow);
      for (const s of stops) light(s.e);
      svg._tracing?.delete(String(id));
      settle(svg);
      done(true);
    };
    requestAnimationFrame(step);
  });
}

const LISTS = ["countries", "places", "routes", "areas", "labels"];
const VIEW_KEYS = ["view", "bounds", "focus", "center", "span"];
// "update": true adds to the map (same ids are replaced). A spec with only a
// view (no lists) keeps everything on the map and just moves the camera.
export function mergeSpec(prev, spec) {
  if (!prev) return spec;
  const hasLists = LISTS.some((k) => Array.isArray(spec[k]));
  if (!spec.update && hasLists) return spec;
  const out = { ...prev };
  if (VIEW_KEYS.some((k) => spec[k] != null)) for (const k of VIEW_KEYS) delete out[k];
  for (const [k, v] of Object.entries(spec)) {
    if (k === "update") continue;
    if (LISTS.includes(k) && Array.isArray(v)) {
      const key = (x) => (x && typeof x === "object" ? x.id ?? x.name : x);
      out[k] = [...(prev[k] || []).filter((x) => !v.some((y) => key(y) != null && key(y) === key(x))), ...v];
    } else out[k] = v;
  }
  return out;
}

// Renders (or updates) the map in an svg.wb-map. Settles when it's drawn and
// the camera has arrived.
export async function renderMap(svg, input = {}, { animate = true } = {}) {
  let w = null;
  try { w = await loadWorld(); } catch (e) { console.warn("World map unavailable:", e); }
  svg._world = w;
  const prev = svg._spec;
  const spec = mergeSpec(prev, input);
  const viewOnly = !!prev && !LISTS.some((k) => Array.isArray(input[k]));
  svg._spec = spec;
  const view = viewFor(spec, w);
  if (!svg.querySelector(".wb-map-base")) {
    // The map's extent (longitude -180..180, latitude -58..84): outlines past
    // it (Antarctica, copies across the antimeridian) are clipped.
    svg.dataset.clip = `wb-map-clip-${Math.random().toString(36).slice(2, 8)}`;
    const [cx0, cy0] = project(-180, LAT_MAX), [cx1, cy1] = project(180, LAT_MIN);
    svg.append(el("defs", { class: "wb-map-keep" }, el("clipPath", { id: svg.dataset.clip }, el("rect", { x: cx0, y: cy0, width: cx1 - cx0, height: cy1 - cy0 }))));
    svg.append(el("defs", { class: "wb-map-defs" }));
    const base = el("g", { class: "wb-map-base" }, el("rect", { class: "wb-map-sea", x: -W, y: -H, width: W * 3, height: H * 3 }));
    const clipped = el("g", { "clip-path": `url(#${svg.dataset.clip})` });
    base.append(clipped);
    if (w) {
      // All countries as land (one path), then their borders on top.
      const d = w.countries.map((c) => c.d).join("");
      clipped.append(el("path", { class: "wb-map-land", d }));
      clipped.append(el("path", { class: "wb-map-borders", d, "vector-effect": "non-scaling-stroke" }));
    }
    svg.append(base);
    const start = spec.zoom_from || spec.zoomFrom;
    setView(svg, start && animate ? (start === "world" ? [0, 0, W, H] : viewFor(Array.isArray(start) ? { bounds: start } : { focus: start }, w)) : view);
  }
  svg.querySelector(".wb-map-borders")?.classList.toggle("off", spec.borders === false);
  if (!viewOnly) {
    svg.querySelector(".wb-map-overlay")?.remove();
    svg.querySelector(".wb-map-defs").replaceChildren();
    svg.append(overlay(svg, spec, w));
    // A trace under way carries on from where it was.
    for (const [id, t] of svg._tracing || []) {
      const still = [...svg.querySelectorAll(".wb-map-route[data-id]")].some((e) => e.dataset.id === id);
      if (still && animate) traceRoute(svg, id, { elapsed: performance.now() - t.t0 });
      else svg._tracing.delete(id);
    }
  }
  if (!animate) {
    // A restored lesson: everything as it ended, traced routes complete.
    for (const g of svg.querySelectorAll('.wb-map-route[data-trace="true"]')) {
      const p = g.querySelector(".wb-map-line");
      p?.style.setProperty("opacity", "1");
      if (g.dataset.arrow) p?.setAttribute("marker-end", g.dataset.arrow);
      g.querySelector(".wb-map-head")?.style.setProperty("opacity", "1");
    }
    setView(svg, view);
    requestAnimationFrame(() => declutter(svg));
    return true;
  }
  svg._chosen = false;
  svg._home = view;
  const arrived = await moveCamera(svg, view);
  svg._settling = true;
  await settle(svg);
  svg._settling = false;
  // Routes to trace that aren't waiting for their word start once the camera
  // has arrived.
  for (const g of svg.querySelectorAll('.wb-map-route[data-trace="true"]')) {
    if (g.getAttribute("opacity") === "0" || (svg._traced || new Set()).has(g.dataset.id || "")) continue;
    if (g.dataset.id) traceRoute(svg, g.dataset.id);
    else g.querySelector(".wb-map-line")?.style.setProperty("opacity", "1");
  }
  return arrived;
}
