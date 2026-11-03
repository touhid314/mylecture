// Preload for the validator's offscreen pages (contextIsolation: false, so
// this runs in the page's main world before any page script).
// Runs Playwright-style init scripts and forwards uncaught errors ("pageerror").
const { ipcRenderer } = require("electron");

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};
const channel = arg("ml-channel");
let scripts = [];
try {
  scripts = JSON.parse(Buffer.from(arg("ml-init"), "base64").toString("utf8"));
} catch {}
for (const code of scripts) {
  try {
    (0, eval)(code);
  } catch (e) {
    console.error("init script failed", e);
  }
}
const report = (err) => {
  try {
    ipcRenderer.send(channel, { name: (err && err.name) || "Error", message: String((err && err.message) || err) });
  } catch {}
};
window.addEventListener("error", (e) => report(e.error || { message: e.message }));
window.addEventListener("unhandledrejection", (e) => report(e.reason || { message: "Unhandled rejection" }));
