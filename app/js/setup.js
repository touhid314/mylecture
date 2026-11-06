// Progress window for `MyLecture --setup-components=...` (run by the Windows
// installer). The main process installs; this only shows progress.
const ids = new URLSearchParams(location.search).get("ids")?.split(",").filter(Boolean) || [];
const list = document.getElementById("list");
const rows = {};

function row(c) {
  const el = document.createElement("div");
  el.className = "comp";
  el.innerHTML = '<div class="comp-top"><b></b><span class="comp-state">Waiting</span></div><div class="comp-msg"></div><div class="bar"><div></div></div><div class="comp-detail"></div>';
  el.querySelector("b").textContent = `${c.title} (${c.size})`;
  list.append(el);
  rows[c.id] = el;
}

function show(p) {
  const el = rows[p.id];
  if (!el) return;
  const state = el.querySelector(".comp-state");
  state.className = `comp-state ${p.state || ""}`;
  if (p.startedAt) el.dataset.started = p.startedAt;
  el.dataset.busy = p.state === "installing" ? "1" : "";
  const secs = el.dataset.started ? Math.floor((Date.now() - Number(el.dataset.started)) / 1000) : 0;
  state.textContent = p.state === "done" ? "Done" : p.state === "error" ? "Failed" : `Installing… ${p.percent != null ? p.percent + "% · " : ""}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  // The installer's latest output line, so a long step visibly moves.
  el.querySelector(".comp-detail").textContent = p.state === "installing" ? p.detail || "" : "";
  el.querySelector(".comp-msg").textContent = p.state === "error" ? `${p.message} You can install it later from Settings → AI engines & voices.` : p.message || "";
  const bar = el.querySelector(".bar");
  bar.classList.toggle("busy", p.state === "installing" && p.percent == null);
  bar.firstElementChild.style.width = p.state === "done" ? "100%" : p.percent != null ? `${p.percent}%` : "";
  bar.hidden = p.state === "error";
}

const all = await window.ml.components.status();
for (const c of all.filter(c => ids.includes(c.id))) row(c);
const latest = {};
window.ml.components.onProgress((p) => { latest[p.id] = p; show(p); });
// Keep the elapsed time ticking between progress events.
setInterval(() => { for (const p of Object.values(latest)) if (p.state === "installing") show(p); }, 1000);
window.ml.components.onSetupDone(({ failed }) => {
  document.getElementById("summary").textContent = failed ? `${failed} could not be installed.` : "All done.";
  const close = document.getElementById("close");
  close.hidden = false;
  close.onclick = () => window.close();
});
