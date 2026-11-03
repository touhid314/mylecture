import { bus, toast } from "./ui.js";
import { StudyView } from "./study.js";
import { CreateView } from "./create.js";
import { LibraryView } from "./library.js";
import { SettingsView } from "./settings.js";
import { ExportCenter } from "./exports.js";

export const state = {
  settings: null,
  info: null,
  view: "study",
};

const views = {};

async function boot() {
  state.info = await window.ml.info();
  state.settings = await window.ml.settings.get();
  document.body.classList.toggle("light", state.settings.uiTheme === "light");

  const exportsCenter = new ExportCenter();
  views.study = new StudyView(document.getElementById("view-study"), { state, exportsCenter });
  views.create = new CreateView(document.getElementById("view-create"), { state, exportsCenter });
  views.library = new LibraryView(document.getElementById("view-library"), { state, exportsCenter });
  views.settings = new SettingsView(document.getElementById("view-settings"), { state });

  document.querySelectorAll(".rail-btn").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey) return;
    if (e.key === "1") show("study");
    else if (e.key === "2") show("create");
    else if (e.key === "3") show("library");
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
  show("study");
}

function show(name, args = {}) {
  state.view = name;
  document.querySelectorAll(".rail-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  views[name]?.onShow?.(args);
}

boot();
