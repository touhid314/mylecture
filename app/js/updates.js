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

function show(state) {
  if (!["ready", "available"].includes(state?.status) || !state.version || prompted === state.version) return;
  prompted = state.version;
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

export async function initUpdates() {
  if (!window.ml.updates) return;
  window.ml.updates.onState(show);
  show(await window.ml.updates.state());
}
