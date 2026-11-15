// Video themes: the built-in ones (resources/themes/*.md, read-only) plus the
// user's own, which live in <userData>/themes/<id>.json. Editing a built-in
// theme saves an override with the same id; resetting deletes the override.
//
// A theme is { id, name, description, look, instructions }:
//   instructions  the markdown the video agent follows (layout, fonts, rules)
//   look          { background, text, muted, accents[3], font }: the colors and
//                 font the preview card draws, also handed to the agent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// Same folder as run.js's RESOURCES (not imported, to avoid a module cycle).
const BUILTIN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "resources", "themes");
// Kept for existing projects, but not offered for new videos.
const HIDDEN = new Set(["fonts-colors", "none", "sat-tutor"]);
const NAMES = {
  default: "Default", "3b1b": "3Blue1Brown", "fonts-colors": "Fonts & colors", "hand-drawn": "Hand-drawn",
  light: "Light", none: "None", reel: "Reel", "sat-tutor": "SAT tutor", "stickman-compare": "Stickman compare", "thin-line": "Thin-line",
};
// What each built-in theme looks like, read from its instructions.
const BUILTIN_LOOKS = {
  default: { background: "#121212", text: "#f4f4f5", muted: "#a1a1aa", accents: ["#38bdf8", "#facc15", "#f472b6"], font: "Lato" },
  "3b1b": { background: "#0e0e10", text: "#ffffff", muted: "#b3b3b3", accents: ["#58c4dd", "#ffff00", "#83c167"], font: "Helvetica Neue" },
  light: { background: "#ffffff", text: "#121212", muted: "#525252", accents: ["#0369a1", "#b45309", "#be185d"], font: "Lato" },
  reel: { background: "#1f2023", text: "#ffffff", muted: "#a1a1aa", accents: ["#22d3ee", "#facc15", "#fb7185"], font: "Roboto" },
  "hand-drawn": { background: "#fafafa", text: "#1a1a1a", muted: "#555555", accents: ["#2563eb", "#dc2626", "#16a34a"], font: "Architects Daughter" },
  "thin-line": { background: "#121212", text: "#e5e5e5", muted: "#8a8a8a", accents: ["#00e5ff", "#ff9f1c", "#b388ff"], font: "JetBrains Mono" },
  "stickman-compare": { background: "#ffffff", text: "#1a1a1a", muted: "#555555", accents: ["#1a1a1a", "#2563eb", "#dc2626"], font: "Roboto" },
  "fonts-colors": { background: "#121212", text: "#f4f4f5", muted: "#a1a1aa", accents: ["#38bdf8", "#facc15", "#f472b6"], font: "Lato" },
  "sat-tutor": { background: "#ffffff", text: "#121212", muted: "#525252", accents: ["#2563eb", "#16a34a", "#dc2626"], font: "Lato" },
  none: { background: "#121212", text: "#f4f4f5", muted: "#a1a1aa", accents: ["#38bdf8", "#facc15", "#f472b6"], font: "Lato" },
};
const DESCRIPTIONS = {
  default: "Dark charcoal background, clean Lato text.",
  "3b1b": "Dark, calm and precise, with blue and yellow math highlights.",
  light: "Plain white background with dark text and blue accents.",
  reel: "Bold, animation-heavy portrait style for Reels and Shorts.",
  "hand-drawn": "Everything looks written by hand on white paper.",
  "thin-line": "Minimal technical look: dark background, thin lines, monospace.",
  "stickman-compare": "White background with a hand-drawn stickman comparing two things.",
};
const FALLBACK_LOOK = BUILTIN_LOOKS.default;
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_INSTRUCTIONS = 50000;

let userDir = "";
export function setUserThemesDir(dir) { userDir = dir; }

const builtinIds = () => {
  try { return fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)); } catch { return []; }
};
const isBuiltin = (id) => ID.test(id) && fs.existsSync(path.join(BUILTIN_DIR, `${id}.md`));
// Some built-ins came from a rich-text export: undo its escapes for reading and editing.
const clean = (text) => text.replace(/&#x20;/g, " ").replace(/\\([_&#*[\]()-])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
const nameOf = (id) => NAMES[id] || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function firstLine(body) {
  const line = body.split(/\r?\n/).map((l) => l.replace(/[#*`>{}"]/g, "").trim()).find((l) => l && !/^theme$/i.test(l));
  return (line || "").slice(0, 120);
}

export function normalizeLook(look = {}, base = FALLBACK_LOOK) {
  const color = (v, d) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : d);
  const accents = Array.isArray(look.accents) ? look.accents : [];
  const font = typeof look.font === "string" ? look.font.replace(/[^\w .'-]/g, "").trim().slice(0, 60) : "";
  return {
    background: color(look.background, base.background),
    text: color(look.text, base.text),
    muted: color(look.muted, base.muted),
    accents: [0, 1, 2].map((i) => color(accents[i], base.accents[i])),
    font: font || base.font,
  };
}

function builtin(id) {
  const instructions = clean(fs.readFileSync(path.join(BUILTIN_DIR, `${id}.md`), "utf8"));
  return { id, name: nameOf(id), description: DESCRIPTIONS[id] || firstLine(instructions), look: normalizeLook(BUILTIN_LOOKS[id]), instructions, builtin: true, edited: false };
}
function userFile(id) { return userDir && ID.test(id) ? path.join(userDir, `${id}.json`) : null; }
function readUser(id) {
  const file = userFile(id);
  if (!file) return null;
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!t || typeof t.instructions !== "string") return null;
    return t;
  } catch { return null; }
}

// -> full theme, or null when there is no such theme.
export function getTheme(id) {
  id = String(id || "").trim().toLowerCase().replace(/\.md$/, "");
  const base = isBuiltin(id) ? builtin(id) : null;
  const saved = readUser(id);
  if (!saved) return base;
  return {
    id,
    name: String(saved.name || base?.name || nameOf(id)).slice(0, 60),
    description: String(saved.description ?? base?.description ?? "").slice(0, 160),
    look: normalizeLook(saved.look, base?.look),
    instructions: saved.instructions,
    builtin: !!base,
    edited: !!base,
    updatedAt: saved.updatedAt,
  };
}

// Themes offered for new videos: built-ins first, then the user's own by name.
export function listThemes({ includeHidden = false } = {}) {
  const builtins = builtinIds().filter((id) => includeHidden || !HIDDEN.has(id)).map(getTheme);
  let own = [];
  try {
    own = fs.readdirSync(userDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
      .filter((id) => ID.test(id) && !isBuiltin(id)).map(getTheme).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {}
  const order = ["default", "light", "3b1b", "reel", "hand-drawn", "thin-line", "stickman-compare"];
  builtins.sort((a, b) => ((order.indexOf(a.id) + 1) || 99) - ((order.indexOf(b.id) + 1) || 99));
  return [...builtins, ...own];
}

function slug(name) {
  return String(name).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme";
}

// Create (no id) or update a theme. -> the saved theme.
export function saveTheme(input = {}) {
  if (!userDir) throw new Error("Themes are not available yet.");
  const name = String(input.name || "").trim().slice(0, 60);
  if (!name) throw new Error("Give the theme a name.");
  const instructions = String(input.instructions || "").replace(/\r\n/g, "\n").trim();
  if (!instructions) throw new Error("Describe how the theme should look.");
  if (instructions.length > MAX_INSTRUCTIONS) throw new Error("The theme description is too long.");
  let id = String(input.id || "").trim().toLowerCase();
  if (id && !ID.test(id)) throw new Error("Unknown theme.");
  if (id && !isBuiltin(id) && !readUser(id)) throw new Error("This theme no longer exists.");
  if (!id) id = `my-${slug(name)}-${crypto.randomBytes(3).toString("hex")}`;
  const base = isBuiltin(id) ? builtin(id) : null;
  const theme = {
    name,
    description: String(input.description ?? "").trim().slice(0, 160) || firstLine(instructions),
    look: normalizeLook(input.look, base?.look),
    instructions,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(userDir, { recursive: true });
  const file = userFile(id);
  fs.writeFileSync(file + ".tmp", JSON.stringify(theme, null, 2));
  fs.renameSync(file + ".tmp", file);
  return getTheme(id);
}

// Deletes the user's theme, or restores a built-in theme to its original.
export function deleteTheme(id) {
  const file = userFile(String(id || "").toLowerCase());
  if (!file) throw new Error("Unknown theme.");
  fs.rmSync(file, { force: true });
  return { ok: true, restored: isBuiltin(id) ? getTheme(id) : null };
}

// The prompt text for a theme id; null when the id is not a theme.
// Unedited built-ins are passed exactly as written. Edited and user themes add
// their colors and font, which the user picked in the editor.
export function themeInstructions(id) {
  const t = getTheme(id);
  if (!t) return null;
  if (t.builtin && !t.edited) return fs.readFileSync(path.join(BUILTIN_DIR, `${t.id}.md`), "utf8").trim();
  const { background, text, muted, accents, font } = t.look;
  return `${t.instructions}\n\n## Colors and font\n- Background: ${background}\n- Main text: ${text}\n- Secondary text: ${muted}\n- Accent colors: ${accents.join(", ")}\n- Font family: '${font}'`;
}
