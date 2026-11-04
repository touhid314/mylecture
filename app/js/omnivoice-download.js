// "Download OmniVoice" popup, shared by the Create voice menu and Settings.
// The install itself runs in the main process (electron/components.js), so
// closing this popup does not stop it; reopening shows the live progress.
import { h, modal, toast } from "./ui.js";

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export async function omniVoiceInstalled() {
  try {
    return !!(await window.ml.components.status()).find((c) => c.id === "omnivoice")?.installed;
  } catch { return false; }
}

export async function showOmniVoiceDownloader({ onDone } = {}) {
  const status = h("div", { class: "small muted", style: { minHeight: "18px", overflowWrap: "anywhere" } });
  const fill = h("div", { class: "omni-dl-fill" });
  const bar = h("div", { class: "omni-dl-bar" }, fill);
  let go = null; // the footer's Download button, found after the popup opens
  const body = h("div", { class: "omni-dl" },
    h("p", { style: { marginTop: 0 } }, "OmniVoice is a high-quality, expressive voice that runs on your computer."),
    h("ul", { class: "small muted", style: { margin: "0 0 12px", paddingLeft: "18px", lineHeight: 1.6 } },
      h("li", {}, "Download: about 6 GB (Python, PyTorch and the OmniVoice model)."),
      h("li", {}, "Uses your NVIDIA graphics card if you have one; otherwise it runs slower on the processor."),
      h("li", {}, "Takes about 5 to 20 minutes, depending on your connection. You can close this window; the download continues.")),
    bar, status);

  let done = false;
  const show = (p) => {
    if (!p) return;
    const busy = p.state === "installing";
    bar.hidden = !(busy || p.state === "done");
    bar.classList.toggle("busy", busy && p.percent == null);
    fill.style.width = p.state === "done" ? "100%" : p.percent != null ? `${p.percent}%` : "";
    status.style.color = p.state === "error" ? "var(--bad)" : "";
    status.textContent = p.state === "done" ? "OmniVoice is ready. Pick an OmniVoice voice to use it." : p.message || "";
    if (!go) return;
    go.hidden = p.state === "done";
    go.disabled = busy;
    go.textContent = busy ? "Downloading…" : p.state === "error" ? "Try again" : "Download";
  };

  const unsubscribe = window.ml.components.onProgress((p) => {
    if (p.id !== "omnivoice") return;
    show(p);
    if (p.state === "done" && !done) { done = true; onDone?.(); }
  });
  const start = async () => {
    show({ state: "installing", message: "Starting…", percent: null });
    try {
      await window.ml.components.install("omnivoice");
    } catch (e) {
      show({ state: "error", message: friendly(e) });
      toast(`OmniVoice: ${friendly(e)}`, { kind: "bad", timeout: 9000 });
    }
  };
  const { el } = modal({
    title: "Download OmniVoice", width: "460px", body,
    actions: [{ label: "Close" }, { label: "Download", primary: true, run: () => { void start(); return false; } }],
    onClose: () => unsubscribe?.(),
  });
  go = [...el.querySelectorAll(".modal-foot button")].find((b) => b.textContent === "Download");

  bar.hidden = true;
  const current = (await window.ml.components.status().catch(() => [])).find((c) => c.id === "omnivoice");
  if (current?.installed) show({ state: "done" });
  else show(current?.progress);

}
