// Small DOM helpers shared by every view.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="M7 5v14l12-7L7 5Z" fill="currentColor"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
  text: '<path d="M4 6h16M4 12h10M4 18h13"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M8 3v5h7M8 21v-7h8v7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  rewind: '<path d="M11 7 5 12l6 5V7ZM19 7l-6 5 6 5V7Z"/>',
  pause: '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>',
  cc: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10.5a2 2 0 1 0 0 3M16 10.5a2 2 0 1 0 0 3"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  wand: '<path d="m15 4 5 5L9 20l-5-5L15 4Z"/><path d="M13 6l5 5"/>',
};
export function icon(name, cls = "ico") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", cls);
  s.innerHTML = ICONS[name] || "";
  return s;
}

export function fmtTime(t) {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400 && d.getDate() === now.getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 7 * 86400) return d.toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

export function toast(msg, { kind = "", timeout = 4500, actions = [] } = {}) {
  const root = document.getElementById("toasts");
  const body = h("div", { class: "grow" }, h("div", {}, msg));
  if (actions.length) {
    body.appendChild(
      h(
        "div",
        { class: "t-actions" },
        actions.map((a) =>
          h("button", {
            class: "btn sm",
            onclick: () => {
              a.run();
              el.remove();
            },
          }, a.label),
        ),
      ),
    );
  }
  const el = h("div", { class: `toast ${kind}` }, body, h("button", { class: "btn ghost sm icon", onclick: () => el.remove() }, icon("x")));
  root.appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function modal({ title, body, actions = [], onClose, width }) {
  const root = document.getElementById("modal-root");
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);
  const m = h(
    "div",
    { class: "modal", style: width ? { width } : null },
    h("div", { class: "modal-head" }, title),
    h("div", { class: "modal-body" }, body),
    h(
      "div",
      { class: "modal-foot" },
      actions.map((a) =>
        h("button", {
          class: `btn ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}`,
          onclick: async () => {
            const r = await a.run?.();
            if (r !== false) close();
          },
        }, a.label),
      ),
    ),
  );
  const back = h("div", { class: "modal-backdrop", onmousedown: (e) => e.target === back && close() }, m);
  root.appendChild(back);
  setTimeout(() => m.querySelector("input,textarea,select")?.focus(), 30);
  return { close, el: m };
}

export function confirmBox(title, text, okLabel = "Delete") {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title,
      body: h("p", { class: "muted", style: { margin: 0 } }, text),
      actions: [
        { label: "Cancel", run: () => { done = true; resolve(false); } },
        { label: okLabel, primary: true, run: () => { done = true; resolve(true); } },
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

export function promptBox(title, { label = "", value = "", placeholder = "", multiline = false, okLabel = "OK", hint = "" } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline
      ? h("textarea", { class: "textarea", rows: 4, placeholder })
      : h("input", { class: "input", placeholder });
    input.value = value;
    const ok = () => {
      done = true;
      resolve(input.value.trim());
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        ok();
        m.close();
      }
    });
    const m = modal({
      title,
      body: h("div", { class: "field" }, label ? h("label", {}, label) : null, input, hint ? h("div", { class: "hint" }, hint) : null),
      actions: [
        { label: "Cancel", run: () => { done = true; resolve(null); } },
        { label: okLabel, primary: true, run: ok },
      ],
      onClose: () => !done && resolve(null),
    });
  });
}

export function popMenu(anchor, items) {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
  const menu = h(
    "div",
    { class: "menu" },
    items.map((it) => {
      if (it === "-") return h("hr");
      if (it.label && !it.run) return h("div", { class: "menu-label" }, it.label);
      return h("button", {
        onclick: () => {
          menu.remove();
          it.run();
        },
      }, it.icon ? icon(it.icon) : null, it.text);
    }),
  );
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mr = menu.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + mr.height > window.innerHeight - 10) top = r.top - mr.height - 6;
  let left = Math.min(r.left, window.innerWidth - mr.width - 10);
  menu.style.top = top + "px";
  menu.style.left = Math.max(10, left) + "px";
  const away = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener("mousedown", away, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", away, true), 0);
  return menu;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// A tiny event bus for cross-view communication.
const listeners = {};
export const bus = {
  on(ev, fn) {
    (listeners[ev] ||= []).push(fn);
    return () => (listeners[ev] = listeners[ev].filter((f) => f !== fn));
  },
  emit(ev, data) {
    for (const fn of listeners[ev] || []) fn(data);
  },
};
