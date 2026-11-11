// "Update available" prompt. The main process (electron/updater.js) checks for
// new versions; this shows one prompt per new version per launch.
import { h, modal, confirmBox, toast } from "./ui.js";

let prompted = null;

async function install() {
  let result = await window.ml.updates.install();
  if (result?.busy) {
    const ok = await confirmBox("Stop current work and update?", "A video is still being generated, rendered or exported. Updating now restarts MyLecture and stops it.", "Update now");
    if (!ok) return false;
    result = await window.ml.updates.install({ force: true });
  }
  if (result?.opened) toast("The new installer is downloading in your browser. Open it to finish updating.", { timeout: 9000 });
  else if (!result?.ok) toast("The update isn't ready yet. Try again in a moment.", { kind: "bad" });
}

// macOS: the update is installed by running the install command in Terminal.
function showCommand(state) {
  const copyBtn = h("button", { class: "btn sm", onclick: async () => {
    try {
      await navigator.clipboard.writeText(state.command);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy"), 2000);
    } catch { toast("Could not copy. Select the command and copy it.", { kind: "bad" }); }
  } }, "Copy");
  modal({
    title: "Update available",
    width: "560px",
    body: h("div", {},
      h("p", { style: { margin: "0 0 8px" } }, `MyLecture ${state.version} is available. You have ${state.current}.`),
      h("p", { style: { margin: "0 0 8px" } }, "To update, open Terminal, paste this command and press Return:"),
      h("div", { class: "update-cmd" }, h("code", {}, state.command), copyBtn),
      h("p", { class: "muted small", style: { margin: "10px 0 0" } },
        "To open Terminal, press ⌘ + Space, type Terminal and press Return, or click Open Terminal below. The command closes MyLecture, installs the new version and opens it again. This reminder appears each time you open MyLecture until you update.")),
    actions: [
      { label: "Later" },
      { label: "Open Terminal", run: async () => {
        await navigator.clipboard.writeText(state.command).catch(() => {});
        const r = await window.ml.updates.openTerminal();
        toast(r?.ok ? "The command is copied. Paste it into Terminal (⌘ + V) and press Return." : "Could not open Terminal. Open it from Applications → Utilities.", { timeout: 9000, kind: r?.ok ? "" : "bad" });
        return false;
      } },
    ],
  });
}

function show(state, { again = false } = {}) {
  if (!["ready", "available"].includes(state?.status) || !state.version || (prompted === state.version && !again)) return;
  prompted = state.version;
  if (state.command) return showCommand(state);
  const auto = state.status === "ready";
  modal({
    title: "Update available",
    width: "420px",
    body: h("div", {},
      h("p", { style: { margin: "0 0 8px" } }, `MyLecture ${state.version} is available. You have ${state.current}.`),
      h("p", { class: "muted small", style: { margin: 0 } }, auto
        ? "Update now restarts MyLecture into the new version. If you choose Later, it updates when you close the app."
        : "Update now downloads the new installer. Open it to finish updating.")),
    actions: [
      { label: "Later" },
      { label: "Update now", primary: true, run: install },
    ],
  });
}

// Settings > About > Check for updates. Shows the update prompt (again, even
// if it was dismissed this session) or says why there is nothing to install.
export async function checkForUpdates() {
  if (!window.ml?.updates?.check) return toast("Updates aren't available in this copy of MyLecture (a development build).", { kind: "bad" });
  const r = await window.ml.updates.check().catch((e) => ({ status: "error", message: String(e?.message || e) }));
  if (r.status === "available" || r.status === "ready") return show({ ...(await window.ml.updates.state()), ...r }, { again: true });
  if (r.status === "downloading") return toast(`MyLecture ${r.version} is downloading. You'll be asked to restart when it's ready.`, { timeout: 7000 });
  if (r.status === "latest") return toast(`You have the latest version (${r.current}).`);
  if (r.status === "busy") return toast("Already checking for updates…");
  if (r.status === "off") return toast("Updates aren't available in this copy of MyLecture (a development build).", { kind: "bad" });
  toast("Couldn't check for updates. Check your internet connection and try again.", { kind: "bad", timeout: 7000 });
}

export async function initUpdates() {
  if (!window.ml.updates) return;
  window.ml.updates.onState(show);
  show(await window.ml.updates.state());
}
