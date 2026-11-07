import { bus, toast } from "./ui.js";
import { StudyView } from "./study/tutor-view.js";
import { CreateView } from "./create.js";
import { LibraryView } from "./library.js";
import { SettingsView } from "./settings.js";
import { ExportCenter } from "./exports.js";
import { FEATURES } from "./features.js";
import { showWelcome } from "./connect.js";
import { initUpdates } from "./updates.js";

// Page errors occur in the renderer's main world; the isolated preload's
// global error events do not see them.
window.addEventListener("error", event => window.ml.logs?.reportError?.({ kind: "error", message: String(event.message || "Renderer error"), stack: String(event.error?.stack || ""), line: event.lineno }));
window.addEventListener("unhandledrejection", event => window.ml.logs?.reportError?.({ kind: "unhandledrejection", message: String(event.reason?.message || event.reason || "Unhandled rejection"), stack: String(event.reason?.stack || "") }));

export const state = {
  settings: null,
  info: null,
  view: FEATURES.study ? "study" : "create",
};

const views = {};

async function boot() {
  state.info = await window.ml.info();
  state.settings = await window.ml.settings.get();
  document.body.classList.toggle("light", state.settings.uiTheme === "light");

  const exportsCenter = new ExportCenter();
  views.create = new CreateView(document.getElementById("view-create"), { state, exportsCenter });
  if (FEATURES.study) views.study = new StudyView(document.getElementById("view-study"), { state, createView: views.create });
  else {
    // Study is under development (feature/study): only Create ships for now.
    document.querySelector('.rail-btn[data-view="study"]')?.remove();
    document.getElementById("view-study")?.remove();
  }
  views.library = new LibraryView(document.getElementById("view-library"), { state, exportsCenter });
  views.settings = new SettingsView(document.getElementById("view-settings"), { state });

  document.querySelectorAll(".rail-btn").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey) return;
    const order = [...document.querySelectorAll(".rail-btn[data-view]")].map((b) => b.dataset.view).filter((v) => v !== "settings");
    if (/^[1-9]$/.test(e.key) && order[Number(e.key) - 1]) show(order[Number(e.key) - 1]);
    else if (e.key === ",") show("settings");
    else return;
    e.preventDefault();
  });

  bus.on("navigate", ({ view, ...args }) => show(view, args));
  bus.on("settings-changed", (s) => {
    state.settings = s;
    document.body.classList.toggle("light", s.uiTheme === "light");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e.reason);
    toast(String(e.reason?.message || e.reason).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), { kind: "bad", timeout: 7000 });
  });
  show(state.view);
  initUpdates().catch(() => {});
  // First run: connect an AI account before anything else.
  if (!state.settings.onboarded) showWelcome(state, { onDone: (goto) => goto && show(goto) });
}

function show(name, args = {}) {
  if (!views[name]) name = FEATURES.study ? "study" : "create";
  state.view = name;
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  views[name]?.onShow?.(args);
}

boot();
