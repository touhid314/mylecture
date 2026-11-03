// Export jobs UI + the "Publish" helper for social platforms.
import { h, icon, toast, modal } from "./ui.js";

const KIND_LABEL = { mp4: "MP4 video", html: "Interactive HTML", srt: "Captions (SRT)", vtt: "Captions (VTT)", contract: "MyLecture contract bundle" };

export class ExportCenter {
  constructor() {
    this.list = h("div", { class: "export-list" });
    document.body.appendChild(this.list);
    this.items = new Map();
    window.ml.exporter.onProgress((p) => this._progress(p));
  }

  async start(lectureId, kind, opts = {}) {
    const { jobId } = await window.ml.exporter.start({ lectureId, kind, fps: opts.fps, captions: opts.captions, height: opts.height });
    const bar = h("i");
    const label = h("span", { class: "small muted" }, "Preparing…");
    const cancel = h("button", { class: "btn ghost sm icon", title: "Cancel", onclick: () => window.ml.exporter.cancel(jobId) }, icon("x"));
    const el = h(
      "div",
      { class: "export-item" },
      h("div", { class: "row" }, icon(kind === "mp4" ? "film" : "download"), h("b", { class: "grow", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, opts.title || "Export"), cancel),
      h("div", { class: "row" }, h("span", { class: "small" }, KIND_LABEL[kind] || kind), h("div", { class: "grow" }), label),
      h("div", { class: "progress" }, bar),
    );
    this.list.appendChild(el);
    this.items.set(jobId, { el, bar, label, kind, title: opts.title, lectureId, cancel });
  }

  _progress(p) {
    const it = this.items.get(p.jobId);
    if (!it) return;
    if (p.phase === "audio") {
      it.label.textContent = `Voicing ${Math.round(p.progress * 100)}%`;
      it.bar.style.width = p.progress * 10 + "%";
    } else if (p.phase === "frames") {
      it.label.textContent = `Rendering ${Math.round(p.progress * 100)}%${p.eta ? ` · ${Math.ceil(p.eta)}s left` : ""}`;
      it.bar.style.width = 10 + p.progress * 90 + "%";
    } else if (p.phase === "done") {
      it.bar.style.width = "100%";
      it.label.textContent = "Done";
      it.cancel.remove();
      it.el.appendChild(
        h(
          "div",
          { class: "row" },
          h("button", { class: "btn sm", onclick: () => window.ml.shell.showItem(p.file) }, icon("folder"), "Show"),
          it.kind !== "contract" ? h("button", { class: "btn sm", onclick: () => window.ml.shell.openPath(p.file) }, icon("play"), "Open") : null,
          it.kind === "mp4" ? h("button", { class: "btn sm primary", onclick: () => publishModal(p.file, it.lectureId) }, icon("share"), "Publish") : null,
          h("div", { class: "grow" }),
          h("button", { class: "btn ghost sm icon", onclick: () => it.el.remove() }, icon("x")),
        ),
      );
      this.items.delete(p.jobId);
    } else if (p.phase === "error") {
      it.label.textContent = "Failed";
      it.label.style.color = "var(--bad)";
      it.cancel.remove();
      it.el.appendChild(h("div", { class: "small", style: { color: "var(--bad)", whiteSpace: "pre-wrap", maxHeight: "80px", overflow: "auto" } }, p.message));
      it.el.appendChild(h("div", { class: "row" }, h("div", { class: "grow" }), h("button", { class: "btn ghost sm", onclick: () => it.el.remove() }, "Dismiss")));
      this.items.delete(p.jobId);
    }
  }
}

export async function publishModal(file, lectureId) {
  const lec = lectureId ? await window.ml.lectures.get(lectureId) : null;
  const title = lec?.title || "MyLecture";
  const first = lec?.scenes?.[0]?.beats?.map((b) => b.text).join(" ") || "";
  const tags = Array.from(new Set((title + " " + (lec?.question || "")).toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []))
    .filter((w) => !["what", "does", "that", "this", "with", "from", "explain", "work", "works", "about", "into", "your", "how", "why"].includes(w))
    .slice(0, 5)
    .map((w) => "#" + w);
  const caption = `${title}\n\n${first}\n\n${[...tags, "#learnontiktok", "#education", "#mylecture"].join(" ")}`;
  const ta = h("textarea", { class: "textarea", rows: 7 });
  ta.value = caption;
  const plat = (name, url, note) =>
    h("button", { class: "btn", style: { justifyContent: "flex-start" }, onclick: () => {
      navigator.clipboard.writeText(ta.value);
      window.ml.shell.showItem(file);
      window.ml.shell.openExternal(url);
      toast(`Caption copied. Drag the video from the folder into ${name}.`, { kind: "good", timeout: 6000 });
    } }, icon("share"), h("span", { class: "grow", style: { textAlign: "left" } }, name), h("span", { class: "small faint" }, note));
  const vertical = lec?.aspect === "9:16";
  modal({
    title: "Publish your video",
    body: h(
      "div",
      {},
      h("div", { class: "field" }, h("label", {}, "Caption"), ta, h("div", { class: "hint" }, "Edit the caption, then pick a platform: the caption is copied, the video's folder opens, and the upload page opens in your browser.")),
      h(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } },
        plat("YouTube", vertical ? "https://www.youtube.com/upload" : "https://studio.youtube.com", vertical ? "Shorts" : "Studio"),
        plat("TikTok", "https://www.tiktok.com/tiktokstudio/upload", vertical ? "" : "best in 9:16"),
        plat("Instagram", "https://www.instagram.com/", vertical ? "Reels" : "best in 9:16"),
        plat("Facebook", "https://www.facebook.com/", "Reels / post"),
        plat("LinkedIn", "https://www.linkedin.com/feed/?shareActive=true", ""),
        plat("X", "https://x.com/compose/post", ""),
      ),
      !vertical ? h("p", { class: "small muted" }, "Tip: for Shorts, Reels and TikTok, create a vertical (9:16) version in Create → Aspect.") : null,
    ),
    actions: [
      { label: "Copy caption", run: () => { navigator.clipboard.writeText(ta.value); toast("Copied", { kind: "good", timeout: 1500 }); return false; } },
      { label: "Done", primary: true },
    ],
  });
}
