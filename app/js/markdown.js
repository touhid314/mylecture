// Markdown, rendered exactly like Super Agent's panel: markdown-it with full
// CommonMark + GFM tables/strikethrough, raw HTML escaped (agent text can't
// inject markup), linkified URLs, and a copy button on every code block.
// File links (file:///…, C:\…) show as links; clicking one opens the project
// artifact with that name, web links open in the browser.
import { h } from "./ui.js";

const md = window.markdownit({ html: false, linkify: true, breaks: false });
// markdown-it refuses file: links by default; agents cite files that way. Script URLs stay refused.
md.validateLink = (url) => !/^\s*(javascript|vbscript|data):/i.test(url);

const COPY_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
const CHECK_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
for (const rule of ["fence", "code_block"]) {
  const render = md.renderer.rules[rule];
  md.renderer.rules[rule] = (...args) => `<div class="code-block"><button class="copy-code" type="button" title="Copy" aria-label="Copy">${COPY_ICON}</button>${render(...args)}</div>`;
}

async function copyBlock(button) {
  const text = button.parentElement?.querySelector("pre")?.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
  } catch {}
  button.innerHTML = CHECK_ICON;
  button.title = "Copied";
  button.classList.add("done");
  setTimeout(() => {
    button.innerHTML = COPY_ICON;
    button.title = "Copy";
    button.classList.remove("done");
  }, 1500);
}

// Where file links go (set by the Create view: opens the artifact).
let fileLinkHandler = null;
export function onFileLink(fn) {
  fileLinkHandler = fn;
}
const isWeb = (url) => /^(https?:|mailto:)/i.test(url);
export const baseName = (p) => {
  try {
    p = decodeURIComponent(p);
  } catch {}
  return p.replace(/[?#].*$/, "").replace(/:\d+(:\d+)?$/, "").split(/[\\/]/).filter(Boolean).pop() || p;
};

// Link titles for rendered nodes.
function titles(el) {
  for (const a of el.querySelectorAll("a[href]")) {
    const url = a.getAttribute("href");
    a.title = isWeb(url) ? url : `Open ${baseName(url)}`;
  }
}

// Handles copy buttons and links inside a Markdown container (once per element).
export function wireMarkdown(el) {
  if (el.__mdWired) return el;
  el.__mdWired = true;
  el.addEventListener("click", (e) => {
    const copy = e.target.closest(".copy-code");
    if (copy) return void copyBlock(copy);
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    const url = a.getAttribute("href") || "";
    if (!url || url.startsWith("#")) return;
    if (isWeb(url)) window.open(url, "_blank");
    else fileLinkHandler?.(baseName(url), url);
  });
  return el;
}

export function renderMarkdownHtml(src) {
  return md.render(String(src || ""));
}

// A rendered fragment. `lineHook(line)` may claim whole lines (e.g. script
// cues) and return an element for them; the rest is Markdown.
export function renderMarkdown(src, { lineHook } = {}) {
  const box = document.createElement("div");
  if (!lineHook) {
    box.innerHTML = md.render(String(src || ""));
  } else {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const d = document.createElement("div");
      d.innerHTML = md.render(run.join("\n"));
      box.append(...d.childNodes);
      run = [];
    };
    for (const line of String(src || "").split(/\r?\n/)) {
      const el = lineHook(line);
      if (el) {
        flush();
        box.append(el);
      } else run.push(line);
    }
    flush();
  }
  titles(box);
  const frag = document.createDocumentFragment();
  frag.append(...box.childNodes);
  return frag;
}

// Inline Markdown (no paragraphs) as nodes.
export function renderInline(src) {
  const d = document.createElement("span");
  d.innerHTML = md.renderInline(String(src || ""));
  titles(d);
  return [...d.childNodes];
}

export function markdownEl(src, cls = "", opts) {
  const el = h("div", { class: ("md " + cls).trim() });
  el.append(renderMarkdown(src, opts));
  return wireMarkdown(el);
}
