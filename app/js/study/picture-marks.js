// Percent coordinates stay aligned with the displayed image at every size.
const NS = "http://www.w3.org/2000/svg";
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
export function pictureMark(mark) {
  const type = String(mark?.type || "circle");
  if (!["circle", "rect", "arrow", "label", "focus"].includes(type)) return null;
  const color = /^#[0-9a-f]{3,8}$/i.test(mark.color || "") ? mark.color : "#ef4444";
  return { type, id: String(mark.id || "").slice(0, 80), x: number(mark.x, 50), y: number(mark.y, 50), w: number(mark.w, 18), h: number(mark.h, 18), x2: number(mark.x2, 60), y2: number(mark.y2, 60), text: String(mark.text || "").slice(0, 160), color, shape: mark.shape === "rect" ? "rect" : "circle" };
}

// Spotlight: darkens the whole picture except one region (even-odd hole).
function focusPath(m) {
  const outer = "M0 0H100V100H0Z";
  if (m.shape === "rect") return `${outer} M${m.x} ${m.y}h${m.w}v${m.h}h${-m.w}Z`;
  const rx = m.w / 2, ry = m.h / 2;
  return `${outer} M${m.x - rx} ${m.y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

// animate: draw the marks on like a marker (live lessons, not restores).
// The marks already there step back so the new ones stand out.
// unfocus: remove the spotlight.
export function drawPictureMarks(stage, marks, { clear = false, animate = false, unfocus = false } = {}) {
  if (clear) stage.querySelectorAll(".wb-picture-marks, .wb-picture-label").forEach((el) => el.remove());
  if (unfocus) stage.querySelectorAll(".wb-pmark-focus").forEach((el) => el.remove());
  const list = (Array.isArray(marks) ? marks : []).slice(0, 40);
  if (list.length) stage.querySelectorAll(".wb-pmark:not(.wb-pmark-focus)").forEach((el) => el.classList.add("wb-pmark-old"));
  let svg = stage.querySelector(".wb-picture-marks");
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "wb-picture-marks");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    stage.append(svg);
  }
  list.forEach((raw, order) => {
    const m = pictureMark(raw);
    if (!m) return;
    if (m.id) stage.querySelectorAll("[data-id]").forEach((el) => { if (el.dataset.id === m.id) el.remove(); });
    const delay = animate ? `${order * 0.18}s` : "";
    if (m.type === "focus") {
      // One spotlight at a time.
      stage.querySelectorAll(".wb-pmark-focus").forEach((el) => el.remove());
      const shade = document.createElementNS(NS, "path");
      shade.setAttribute("d", focusPath(m));
      shade.setAttribute("fill-rule", "evenodd");
      shade.setAttribute("class", `wb-pmark wb-pmark-focus${animate ? " wb-pmark-in" : ""}`);
      if (m.id) shade.dataset.id = m.id;
      svg.prepend(shade);
      return;
    }
    const el = m.type === "label" ? document.createElement("span") : document.createElementNS(NS, m.type === "circle" ? "ellipse" : m.type === "arrow" ? "g" : "rect");
    if (m.id) el.dataset.id = m.id;
    if (m.type === "label") {
      el.className = `wb-picture-label wb-pmark${animate ? " wb-pmark-in" : ""}`;
      if (delay) el.style.animationDelay = `${order * 0.18 + 0.25}s`;
      el.textContent = m.text;
      el.style.left = `${m.x}%`; el.style.top = `${m.y}%`; el.style.color = m.color;
      stage.append(el);
      return;
    }
    const attrs = m.type === "circle" ? { cx: m.x, cy: m.y, rx: m.w / 2, ry: m.h / 2 } : m.type === "rect" ? { x: m.x, y: m.y, width: Math.min(m.w, 100 - m.x), height: Math.min(m.h, 100 - m.y) } : {};
    const style = { fill: "none", stroke: m.color, "stroke-width": "3", "vector-effect": "non-scaling-stroke" };
    for (const [k, v] of Object.entries({ ...attrs, ...style })) el.setAttribute(k, v);
    el.setAttribute("class", `wb-pmark${animate ? " wb-pmark-draw" : ""}`);
    if (delay) el.style.setProperty("--mark-delay", delay);
    if (m.type === "arrow") {
      // Arrowhead drawn in the normalized image coordinate system.
      const angle = Math.atan2(m.y2 - m.y, m.x2 - m.x);
      const points = [[m.x, m.y], [m.x2, m.y2], [m.x2 - 3 * Math.cos(angle - 0.5), m.y2 - 3 * Math.sin(angle - 0.5)], [m.x2, m.y2], [m.x2 - 3 * Math.cos(angle + 0.5), m.y2 - 3 * Math.sin(angle + 0.5)]];
      const line = document.createElementNS(NS, "polyline");
      line.setAttribute("points", points.map((p) => p.join(",")).join(" "));
      for (const [k, v] of Object.entries(style)) line.setAttribute(k, v);
      el.append(line);
    }
    svg.append(el);
  });
}
