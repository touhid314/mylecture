// Video themes: a sample-slide preview of a theme's look, and the theme
// manager where users edit any theme (built-in ones can be reset) or add their own.
import { h, icon, toast, modal, confirmBox } from "./ui.js";

const FONTS = ["Lato", "Roboto", "Inter", "Helvetica Neue", "Arial", "Open Sans", "Montserrat", "Poppins", "Georgia",
  "Playfair Display", "Merriweather", "Times New Roman", "JetBrains Mono", "Fira Code", "Consolas", "Architects Daughter", "Caveat", "Comic Neue"];
const BLANK_LOOK = { background: "#121212", text: "#f4f4f5", muted: "#a1a1aa", accents: ["#38bdf8", "#facc15", "#f472b6"], font: "Lato" };
const NEW_INSTRUCTIONS = `# Theme

# Background
Solid background, no grid.

# Font
Use the theme font for all text. Titles bold.

# Colors
Use the accent colors for highlights, one color per concept, kept consistent across the video.

# Style
Clean and uncluttered. Describe the mood, layout and animation style you want here.`;

// A generic family close to the font, for when it is not installed here.
function fontStack(font) {
  const f = String(font || "");
  const generic = /mono|code|consolas|courier/i.test(f) ? "monospace"
    : /hand|daughter|marker|caveat|script|comic|indie/i.test(f) ? "cursive"
    : /serif|times|georgia|playfair|merriweather|garamond|cmu|computer modern/i.test(f) && !/sans/i.test(f) ? "serif" : "sans-serif";
  return `'${f.replace(/'/g, "")}', ${generic}`;
}

// A sample slide in the theme's colors and font: title, text, a highlighted
// equation, and a small chart in the accent colors. Scales with its width.
export function themePreview(look = BLANK_LOOK, { compact = false } = {}) {
  const l = { ...BLANK_LOOK, ...look, accents: [...(look.accents || BLANK_LOOK.accents)] };
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 200 120");
  svg.setAttribute("class", "tp-chart");
  svg.setAttribute("aria-hidden", "true");
  const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); svg.append(n); return n; };
  add("line", { x1: 12, y1: 108, x2: 196, y2: 108, stroke: l.muted, "stroke-width": 1.5 });
  add("line", { x1: 12, y1: 108, x2: 12, y2: 6, stroke: l.muted, "stroke-width": 1.5 });
  [40, 68, 54, 88].forEach((v, i) => add("rect", { x: 26 + i * 26, y: 108 - v, width: 16, height: v, rx: 2, fill: l.accents[i % 3], opacity: 0.9 }));
  add("path", { d: "M 14 100 C 70 98, 120 70, 194 12", fill: "none", stroke: l.accents[1], "stroke-width": 3, "stroke-linecap": "round" });
  add("circle", { cx: 194, cy: 12, r: 4, fill: l.accents[1] });
  const el = h("div", { class: "tp" + (compact ? " compact" : ""), style: { background: l.background, color: l.text, fontFamily: fontStack(l.font) } },
    h("div", { class: "tp-text" },
      h("div", { class: "tp-title" }, "How things grow"),
      h("div", { class: "tp-sub", style: { color: l.muted } }, "A first look at rates of change"),
      compact ? null : h("div", { class: "tp-eq" }, "speed = ", h("span", { style: { color: l.accents[0] } }, "distance"), " ÷ ", h("span", { style: { color: l.accents[1] } }, "time")),
      compact ? null : h("ul", { class: "tp-list" },
        h("li", {}, h("span", { class: "tp-dot", style: { background: l.accents[0] } }), "Start with what we know"),
        h("li", {}, h("span", { class: "tp-dot", style: { background: l.accents[2] } }), "Watch how it changes"))),
    svg);
  return el;
}

const clone = (t) => JSON.parse(JSON.stringify(t));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Opens the manager. selected: theme id to open on. onChange(themes) runs after
// any save or delete; onUse(id) when the user picks "Use for new videos".
export async function openThemeManager({ selected, onChange, onUse } = {}) {
  let themes = (await window.ml.themes.list()).filter((t) => t.id !== "auto");
  let current = null; // full theme being edited (unsaved edits live in draft)
  let draft = null;

  const list = h("div", { class: "tm-list", role: "listbox", "aria-label": "Themes" });
  const bigPreview = h("div", { class: "tm-preview" });
  const nameIn = h("input", { class: "input", maxlength: "60", "aria-label": "Theme name", placeholder: "Theme name" });
  const descIn = h("input", { class: "input", maxlength: "160", "aria-label": "Short description", placeholder: "One line about the look (optional)" });
  const fontIn = h("input", { class: "input", list: "tm-fonts", maxlength: "60", "aria-label": "Font", placeholder: "Font family" });
  const fontList = h("datalist", { id: "tm-fonts" }, FONTS.map((f) => h("option", { value: f })));
  const colorKeys = [["background", "Background"], ["text", "Text"], ["muted", "Secondary text"], ["accent0", "Accent 1"], ["accent1", "Accent 2"], ["accent2", "Accent 3"]];
  const colors = Object.fromEntries(colorKeys.map(([k]) => [k, h("input", { type: "color", class: "tm-color-input" })]));
  const instructions = h("textarea", { class: "input tm-instructions", spellcheck: "false", "aria-label": "Theme instructions for the video agent" });
  const badge = h("span", { class: "badge" });
  const resetBtn = h("button", { class: "btn sm", onclick: () => removeCurrent() });
  const dupBtn = h("button", { class: "btn sm", title: "Copy this theme into a new one of your own", onclick: () => duplicate() }, icon("plus"), "Duplicate");
  const saveBtn = h("button", { class: "btn sm primary", onclick: () => save() }, "Save");
  const useBtn = h("button", { class: "btn sm", title: "Select this theme for new videos", onclick: async () => { if (await save({ quiet: true }) !== false) { onUse?.(current.id); m.close(); } } }, "Use for new videos");

  const look = () => ({
    background: colors.background.value, text: colors.text.value, muted: colors.muted.value,
    accents: [colors.accent0.value, colors.accent1.value, colors.accent2.value], font: fontIn.value.trim() || "Lato",
  });
  const read = () => ({ id: current?.id, name: nameIn.value.trim(), description: descIn.value.trim(), look: look(), instructions: instructions.value });
  const fields = (t) => ({ id: t.id, name: t.name, description: t.description, look: t.look, instructions: t.instructions });
  const dirty = () => current && !same(fields(read()), fields(draft));

  function paintPreview() { bigPreview.replaceChildren(themePreview(look())); }
  function paintButtons() {
    const d = dirty();
    saveBtn.disabled = !d && !current?.isNew;
    badge.textContent = current?.isNew ? "New" : current?.builtin ? (current.edited ? "Built-in · edited" : "Built-in") : "Yours";
    resetBtn.style.display = current?.isNew || (current?.builtin && !current.edited) ? "none" : "";
    resetBtn.replaceChildren(current?.builtin ? icon("refresh") : icon("trash"), current?.builtin ? "Reset to original" : "Delete");
    resetBtn.classList.toggle("danger", !current?.builtin);
    dupBtn.style.display = current?.isNew ? "none" : "";
  }
  function paintList() {
    list.replaceChildren(...themes.map((t) => {
      const active = current && t.id === current.id;
      return h("button", { class: "tm-item" + (active ? " active" : ""), role: "option", "aria-selected": String(!!active), title: t.description || t.name, onclick: () => select(t.id) },
        themePreview(t.look, { compact: true }),
        h("span", { class: "tm-item-name" }, t.name),
        h("span", { class: "tm-item-kind" }, t.builtin ? (t.edited ? "Edited" : "Built-in") : "Yours"));
    }), h("button", { class: "tm-item tm-new", onclick: () => create() }, h("span", { class: "tm-new-plus" }, icon("plus")), h("span", { class: "tm-item-name" }, "New theme")));
  }
  function load(t) {
    current = t; draft = clone(t);
    nameIn.value = t.name; descIn.value = t.description || ""; fontIn.value = t.look.font; instructions.value = t.instructions;
    colors.background.value = t.look.background; colors.text.value = t.look.text; colors.muted.value = t.look.muted;
    t.look.accents.forEach((c, i) => { colors[`accent${i}`].value = c; });
    paintPreview(); paintList(); paintButtons();
  }
  async function leave() {
    if (!dirty()) return true;
    return confirmBox("Discard changes?", `Your changes to “${current.name || "this theme"}” are not saved.`, "Discard");
  }
  async function select(id) {
    if (current?.id === id && !current.isNew) return;
    if (!(await leave())) return;
    try { load(await window.ml.themes.get(id)); } catch (e) { toast(String(e.message || e), { kind: "bad" }); }
  }
  async function create(from) {
    if (!(await leave())) return;
    const base = from || { name: "", description: "", look: BLANK_LOOK, instructions: NEW_INSTRUCTIONS };
    load({ ...clone(base), id: undefined, name: from ? `${from.name} copy` : "", builtin: false, edited: false, isNew: true });
    nameIn.focus();
  }
  async function duplicate() {
    const src = { ...read(), name: nameIn.value.trim() || current.name };
    if (dirty() && !(await confirmBox("Duplicate with your changes?", "The copy will include your unsaved changes; the original stays as it was saved.", "Duplicate"))) return;
    draft = clone(read()); // the copy carries the edits; don't ask again
    await create(src);
  }
  async function refresh() {
    themes = (await window.ml.themes.list()).filter((t) => t.id !== "auto");
    onChange?.(themes);
  }
  async function save({ quiet = false } = {}) {
    if (!dirty() && !current.isNew) return true;
    try {
      const saved = await window.ml.themes.save(read());
      await refresh();
      load(saved);
      if (!quiet) toast(`Saved “${saved.name}”.`);
      return true;
    } catch (e) { toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { kind: "bad" }); return false; }
  }
  async function removeCurrent() {
    const builtin = current.builtin;
    const ok = await confirmBox(builtin ? "Reset theme?" : "Delete theme?",
      builtin ? `“${current.name}” goes back to its original look and instructions. Your edits are lost.` : `“${current.name}” will be deleted. Videos already made with it are not changed.`,
      builtin ? "Reset" : "Delete");
    if (!ok) return;
    try {
      const r = await window.ml.themes.remove(current.id);
      await refresh();
      draft = clone(read()); // nothing left to discard
      load(r.restored || (await window.ml.themes.get(themes[0].id)));
    } catch (e) { toast(String(e.message || e), { kind: "bad" }); }
  }

  for (const input of [nameIn, descIn, fontIn, instructions, ...Object.values(colors)]) {
    input.addEventListener("input", () => { paintPreview(); paintButtons(); });
  }

  const colorGrid = h("div", { class: "tm-colors" }, colorKeys.map(([k, label]) => h("label", { class: "tm-color" }, colors[k], h("span", {}, label))));
  const editor = h("div", { class: "tm-editor" },
    h("div", { class: "tm-editor-head" }, nameIn, badge),
    bigPreview,
    h("p", { class: "tm-note muted small" }, "Preview of the colors and font. Fonts that aren’t installed on this computer show as a similar font here; videos load them from the web."),
    h("div", { class: "tm-field" }, h("span", { class: "tm-label" }, "Colors"), colorGrid),
    h("label", { class: "tm-field" }, h("span", { class: "tm-label" }, "Font"), fontIn, fontList),
    h("label", { class: "tm-field" }, h("span", { class: "tm-label" }, "Description"), descIn),
    h("label", { class: "tm-field" }, h("span", { class: "tm-label" }, "Instructions for the video agent"), instructions,
      h("span", { class: "muted small" }, "Layout, text sizes, mood, animation style, anything the videos should follow. The colors and font above are added automatically.")),
    h("div", { class: "tm-actions" }, resetBtn, dupBtn, h("div", { class: "grow" }), useBtn, saveBtn));

  const m = modal({
    title: "Themes",
    width: "min(1040px, 94vw)",
    body: h("div", { class: "tm" }, list, editor),
    actions: [{ label: "Done" }],
    // Ask before closing with unsaved edits (Escape, backdrop, or Done).
    beforeClose: leave,
  });
  const startId = themes.some((t) => t.id === selected) ? selected : themes[0]?.id;
  if (startId) load(await window.ml.themes.get(startId));
  return m;
}
