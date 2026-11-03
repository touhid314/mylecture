// Library: completed MP4 renders from the exports folder.
import { h, icon, fmtDate, toast } from "./ui.js";

export class LibraryView {
  constructor(root) {
    this.root = root;
    this.items = [];
    this.query = "";
    this.search = h("input", { class: "input", placeholder: "Search rendered videos...", style: { width: "260px" }, oninput: (e) => {
      this.query = e.target.value.toLowerCase();
      this.paint();
    } });
    this.grid = h("div", { class: "lib-grid" });
    root.append(h("div", { class: "lib-head" }, h("h2", {}, "Library"), this.search,
      h("button", { class: "btn", onclick: () => this.load() }, icon("refresh"), "Refresh"),
      h("button", { class: "btn", onclick: () => window.ml.shell.openExports() }, icon("folder"), "Exports")), this.grid);
    window.ml.exporter.onProgress((p) => {
      if (p.kind === "mp4" && p.phase === "done" && p.file && this.root.classList.contains("active")) this.load();
    });
    window.addEventListener("focus", () => { if (this.root.classList.contains("active")) this.load(); });
  }

  onShow() { this.load(); }

  async load() {
    try {
      this.items = await window.ml.videos.list();
      this.paint();
    } catch {
      this.grid.replaceChildren(h("div", { class: "empty" }, "Could not load rendered videos. Try Refresh."));
    }
  }

  async open(video) {
    const error = await window.ml.shell.openPath(video.file);
    if (error) toast(error, { kind: "bad" });
  }

  paint() {
    const list = this.items.filter((video) => !this.query || video.title.toLowerCase().includes(this.query));
    this.grid.replaceChildren();
    if (!list.length) {
      this.grid.appendChild(h("div", { class: "empty", style: { gridColumn: "1 / -1" } }, icon("film"),
        h("div", {}, this.items.length ? "No matches." : "No rendered videos yet. Export a lesson as MP4 to add it here.")));
      return;
    }
    for (const video of list) {
      this.grid.appendChild(h("div", { class: "lib-card" },
        h("button", { class: "lib-thumb rendered-thumb", title: `Play ${video.title}`, onclick: () => this.open(video) }, icon("play")),
        h("div", { class: "lib-body" },
          h("b", { title: video.title }, video.title),
          h("div", { class: "small faint" }, `${(video.bytes / 1024 / 1024).toFixed(1)} MB · ${fmtDate(video.updatedAt)}`),
          h("div", { class: "lib-actions" }, h("span", { class: "badge" }, "MP4"), h("div", { class: "grow" }),
            h("button", { class: "btn sm", onclick: () => this.open(video) }, icon("play"), "Play"),
            h("button", { class: "btn ghost sm", onclick: () => window.ml.shell.showItem(video.file) }, icon("folder"), "Show file")))));
    }
  }
}
