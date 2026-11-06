// "Download OmniVoice" popup, shared by the Create voice menu and Settings.
// It is the shared install popup (install-dialog.js): the install runs in the
// main process, so closing the popup does not stop it.
import { showInstaller, componentInstalled } from "./install-dialog.js";

export const omniVoiceInstalled = () => componentInstalled("omnivoice");

export function showOmniVoiceDownloader({ onDone } = {}) {
  return showInstaller("omnivoice", { onDone });
}
