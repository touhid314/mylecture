// Readable text in drawn visuals, whatever colours the tutor chose: each text
// in an svg diagram or scene is checked against what is actually behind it
// (the filled shape it sits on, or the board itself), and if the contrast is
// too low it switches to dark or light ink, whichever reads better. Example:
// default chalk-white text on a pale pink box on the blackboard.
const DARK = "#1f2328", LIGHT = "#f8fafc";
const MIN = 3; // WCAG contrast for large text (board text is large)

function parse(c) {
  const m = String(c || "").match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/i);
  if (!m) return null;
  let a = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1], g: +m[2], b: +m[3], a };
}
// Any CSS colour -> {r,g,b,a}, via the browser.
const probe = () => (probe.el ||= Object.assign(document.createElement("i"), { hidden: true }));
function toRgb(c) {
  const direct = parse(c);
  if (direct) return direct;
  const el = probe();
  if (!el.isConnected) document.body.append(el);
  el.style.color = "";
  el.style.color = c;
  return parse(getComputedStyle(el).color);
}
const lum = ({ r, g, b }) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });

// The board's background behind a figure.
function boardColour(el) {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.5) return c;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

const SHAPES = "rect, circle, ellipse, polygon, path";
// The colour behind a point (client coordinates) for an element: the filled
// shapes painted before it that contain the point, blended over the board.
function behind(svg, el, x, y, base) {
  const shapes = [...svg.querySelectorAll(SHAPES)].filter((s) => s.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING && !s.closest("defs, clipPath, mask, marker, pattern"));
  let colour = base;
  for (const s of shapes) {
    const cs = getComputedStyle(s);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.fill === "none") continue;
    const fill = parse(cs.fill);
    if (!fill) continue; // gradients: leave alone
    const alpha = fill.a * (parseFloat(cs.fillOpacity) || (cs.fillOpacity === "0" ? 0 : 1)) * opacityChain(s, svg);
    if (alpha < 0.15) continue;
    const ctm = s.getScreenCTM();
    if (!ctm) continue;
    const p = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    let inside = false;
    try { inside = s.isPointInFill(p); } catch { const r = s.getBoundingClientRect(); inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
    if (inside) colour = over({ ...fill, a: Math.min(1, alpha) }, colour);
  }
  return colour;
}
// Group opacity up to the svg (shapes faded in later count as shown: an
// item hidden until its word is checked against how it will look).
function opacityChain(el, stop) {
  let o = 1;
  for (let n = el; n && n !== stop; n = n.parentElement) {
    const v = parseFloat(getComputedStyle(n).opacity);
    if (v > 0.05) o *= v; // hidden-until-revealed (0) is judged as revealed
  }
  return o;
}

// Fixes the text colours of one svg (diagram or scene). Run once it's laid
// out on a visible page. -> number of texts recoloured.
export function fixContrast(svg) {
  if (!svg?.isConnected || !svg.getScreenCTM()) return 0;
  let base = boardColour(svg);
  // The blackboard shows svg diagrams inverted (they are drawn for a light
  // page). Colours are judged before the filter, so the board behind is
  // judged inverted too; contrast survives the inversion.
  const inv = getComputedStyle(svg).filter.match(/invert\(([\d.]+)(%?)\)/);
  if (inv) {
    const a = parseFloat(inv[1]) / (inv[2] ? 100 : 1);
    const f = (v) => v * (1 - a) + (255 - v) * a;
    base = { r: f(base.r), g: f(base.g), b: f(base.b), a: 1 };
  }
  let fixed = 0;
  const items = [...svg.querySelectorAll("text"), ...svg.querySelectorAll(".wb-svg-math > div")];
  for (const t of items) {
    if (t.closest("defs") || (t.tagName.toLowerCase() === "text" && t.getAttribute("visibility") === "hidden")) continue;
    const isText = t.tagName.toLowerCase() === "text";
    // Where the ink actually is (a math box is wider than its formula).
    let r = t.getBoundingClientRect();
    if (!isText) { const range = document.createRange(); range.selectNodeContents(t); r = range.getBoundingClientRect(); }
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(t);
    const ink = toRgb(isText ? cs.fill : cs.color);
    if (!ink || /emoji/i.test(cs.fontFamily)) continue;
    // Check the middle and both ends of the text; use the worst spot.
    const spots = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + r.height / 2], [r.right - 3, r.top + r.height / 2]];
    const bgs = spots.map(([x, y]) => behind(svg, isText ? t : t.closest("foreignObject"), x, y, base));
    const worst = bgs.reduce((a, b) => (contrast(ink, b) < contrast(ink, a) ? b : a));
    if (contrast(ink, worst) >= MIN) continue;
    const choice = contrast(toRgb(DARK), worst) >= contrast(toRgb(LIGHT), worst) ? DARK : LIGHT;
    if (isText) { t.setAttribute("fill", choice); t.style.fill = choice; }
    else t.style.color = choice;
    t.dataset.contrastFixed = "true";
    fixed++;
  }
  svg.dataset.contrast = "done";
  return fixed;
}
