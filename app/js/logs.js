import { h, modal, toast } from "./ui.js";

const MAX_BYTES = 128 * 1024;

function boundedText(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  if (bytes.length <= MAX_BYTES) return { text: String(text || ""), truncated: false };
  const tail = new TextDecoder().decode(bytes.subarray(bytes.length - MAX_BYTES));
  const newline = tail.indexOf("\n");
  return { text: newline >= 0 ? tail.slice(newline + 1) : tail, truncated: true };
}

export function showLiveLog() {
  let alive = true, paused = false, reading = false, timer = null, unsubscribe = null, queuedManual = false;
  const output = h("pre", { class: "diagnostic-log", tabindex: "0", "aria-label": "Local app log" }, "Loading logs…");
  const status = h("div", { class: "diagnostic-log-status small muted", role: "status" }, "Live updates enabled");
  const location = h("div", { class: "diagnostic-log-location small muted" });
  const pause = h("button", { class: "btn sm", type: "button", onclick: () => {
    paused = !paused;
    pause.textContent = paused ? "Resume live updates" : "Pause live updates";
    status.textContent = paused ? "Paused — Refresh still reads the latest log." : "Live updates enabled";
    if (paused) { clearTimeout(timer); timer = null; }
    else schedule();
  } }, "Pause live updates");
  const refreshButton = h("button", { class: "btn sm", type: "button", onclick: () => refresh(true) }, "Refresh");
  const copy = h("button", { class: "btn sm", type: "button", onclick: async () => {
    try { await navigator.clipboard.writeText(output.textContent); toast("Log copied."); }
    catch { toast("Could not copy the log. Open the logs folder to access the file.", { kind: "bad" }); }
  } }, "Copy log");
  const open = h("button", { class: "btn sm", type: "button", onclick: async () => {
    try { await window.ml.logs.openFolder(); }
    catch { toast("Could not open the logs folder.", { kind: "bad" }); }
  } }, "Open logs folder");

  function schedule() {
    if (!alive || paused || timer) return;
    timer = setTimeout(() => { timer = null; void refresh(false); }, 250);
  }
  async function refresh(manual = true) {
    if (!alive || (!manual && paused)) return;
    if (reading) { if (manual) queuedManual = true; else schedule(); return; }
    reading = true;
    refreshButton.disabled = true;
    try {
      const result = await window.ml.logs.read();
      if (!alive || (!manual && paused)) return;
      const pinned = output.scrollHeight - output.scrollTop - output.clientHeight < 30;
      const oldScroll = output.scrollTop;
      const bounded = boundedText(result.text);
      output.textContent = bounded.text || "No log entries yet.";
      output.scrollTop = pinned ? output.scrollHeight : oldScroll;
      location.textContent = result.file || "";
      status.textContent = `${paused ? "Paused" : "Live"} · Updated ${new Date().toLocaleTimeString()}${result.truncated || bounded.truncated ? " · Showing the latest 128 KB" : ""}`;
    } catch {
      if (alive) status.textContent = "Could not read the app log. Refresh to try again.";
    } finally {
      reading = false;
      refreshButton.disabled = false;
      if (queuedManual && alive) { queuedManual = false; void refresh(true); }
    }
  }
  const dialog = modal({
    title: "Live app log",
    width: "min(1050px, 94vw)",
    body: h("div", { class: "diagnostic-log-view" },
      h("p", { class: "small muted diagnostic-log-note" }, "Logs stay on this computer. Credentials and private content are redacted. Review logs before sharing them."),
      h("div", { class: "diagnostic-log-toolbar" }, pause, refreshButton, copy, open), status, location, output),
    actions: [{ label: "Close" }],
    onClose: () => { alive = false; clearTimeout(timer); timer = null; unsubscribe?.(); unsubscribe = null; },
  });
  try { unsubscribe = window.ml.logs.onEntry(() => schedule()); }
  catch { status.textContent = "Live updates are unavailable. Use Refresh to read the log."; }
  void refresh(true);
  return dialog;
}
