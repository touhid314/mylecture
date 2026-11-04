// Progress window for `MyLecture --setup-components=...` (run by the Windows
// installer). The main process installs; this only shows progress.
const ids = new URLSearchParams(location.search).get("ids")?.split(",").filter(Boolean) || [];
const list = document.getElementById("list");
const rows = {};

function row(c) {
  const el = document.createElement("div");
  el.className = "comp";
  el.innerHTML = '<div class="comp-top"><b></b><span class="comp-state">Waiting</span></div><div class="comp-msg"></div><div class="bar"><div></div></div>';
  el.querySelector("b").textContent = `${c.title} (${c.size})`;
  list.append(el);
  rows[c.id] = el;
}

function show(p) {
  const el = rows[p.id];
  if (!el) return;
  const state = el.querySelector(".comp-state");
  state.className = `comp-state ${p.state || ""}`;
  state.textContent = p.state === "done" ? "Done" : p.state === "error" ? "Failed" : "Installing…";
  el.querySelector(".comp-msg").textContent = p.state === "error" ? `${p.message} You can install it later from Settings → AI engines & voices.` : p.message || "";
  const bar = el.querySelector(".bar");
  bar.classList.toggle("busy", p.state === "installing" && p.percent == null);
  bar.firstElementChild.style.width = p.state === "done" ? "100%" : p.percent != null ? `${p.percent}%` : "";
  bar.hidden = p.state === "error";
}

const all = await window.ml.components.status();
for (const c of all.filter(c => ids.includes(c.id))) row(c);
window.ml.components.onProgress(show);
window.ml.components.onSetupDone(({ failed }) => {
  document.getElementById("summary").textContent = failed ? `${failed} could not be installed.` : "All done.";
  const close = document.getElementById("close");
  close.hidden = false;
  close.onclick = () => window.close();
});
