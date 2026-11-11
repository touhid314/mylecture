// LaTeX inside drawn visuals: an SVG <text> (in an svg diagram or a scene)
// whose content has $...$ math is shown with KaTeX, in a foreignObject at
// the same spot, size, colour and alignment as the text it replaces. Plain
// text (and amounts like "$5 and $10") stays as it is.
const NS = "http://www.w3.org/2000/svg";
const XHTML = "http://www.w3.org/1999/xhtml";

// $...$ that is math, not money: a LaTeX command, ^ _ { } =, or a lone variable.
const MATH = /\$([^$\n]+?)\$/g;
const looksLikeMath = (s) => /[\\^_{}=]/.test(s) || /^\s*[A-Za-z](?:_?\d)?\s*$/.test(s);
export const hasMath = (text) => [...String(text || "").matchAll(MATH)].some((m) => looksLikeMath(m[1]));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// "Attention: $\mathrm{softmax}(QK^T/\sqrt{d})V$" -> HTML with KaTeX math.
export function mathHtml(text) {
  const katex = window.katex;
  let out = "", last = 0;
  for (const m of String(text).matchAll(MATH)) {
    if (!looksLikeMath(m[1])) continue;
    out += esc(text.slice(last, m.index));
    out += katex ? katex.renderToString(m[1], { throwOnError: false, strict: "ignore", output: "html" }) : esc(m[1]);
    last = m.index + m[0].length;
  }
  return out + esc(String(text).slice(last));
}

// Replaces math-bearing <text> elements under `root` (in place). The text is
// kept, hidden, inside a group that takes over its id, opacity and style, so
// {show:fig.eq}, {look:fig.eq} and animations still find it.
export function mathifySvg(root) {
  if (!root || !window.katex) return 0;
  let n = 0;
  for (const t of [...root.querySelectorAll("text")]) {
    if (t.querySelector("tspan") || !hasMath(t.textContent)) continue;
    const fs = parseFloat(t.getAttribute("font-size")) || parseFloat(getComputedStyle(t).fontSize) || 16;
    const x = parseFloat(t.getAttribute("x")) || 0, y = parseFloat(t.getAttribute("y")) || 0;
    const anchor = t.getAttribute("text-anchor") || "start";
    const base = t.getAttribute("dominant-baseline") || "";
    // y is the baseline unless the text is vertically centred.
    const cy = /middle|central/.test(base) ? y : y - fs * 0.35;
    const w = Math.max(400, fs * 40), hgt = fs * 3.2;
    const fo = document.createElementNS(NS, "foreignObject");
    fo.setAttribute("x", anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x);
    fo.setAttribute("y", cy - hgt / 2);
    fo.setAttribute("width", w);
    fo.setAttribute("height", hgt);
    fo.setAttribute("class", "wb-svg-math");
    const div = document.createElementNS(XHTML, "div");
    const fill = t.getAttribute("fill");
    div.setAttribute("style", `display:flex;align-items:center;justify-content:${anchor === "middle" ? "center" : anchor === "end" ? "flex-end" : "flex-start"};height:100%;font-size:${fs}px;white-space:nowrap;line-height:1;${fill && fill !== "currentColor" ? `color:${fill};` : ""}${/bold|[6-9]00/.test(t.getAttribute("font-weight") || "") ? "font-weight:700;" : ""}`);
    div.innerHTML = mathHtml(t.textContent);
    fo.append(div);
    const g = document.createElementNS(NS, "g");
    for (const attr of ["id", "opacity", "style", "class", "transform", "data-part"]) {
      if (t.hasAttribute(attr)) { g.setAttribute(attr, t.getAttribute(attr)); if (attr !== "class") t.removeAttribute(attr); }
    }
    g.classList.add("wb-math-text");
    t.parentNode.replaceChild(g, t);
    t.setAttribute("visibility", "hidden");
    g.append(t, fo);
    n++;
  }
  return n;
}
