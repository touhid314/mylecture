// In-app updates. Release files are served at <server>/updates by
// ../mylecture-app-admin/server (Cloudflare R2).
//
// Checked once when the app starts; there is no polling.
//
// Windows installer builds: electron-updater downloads the new installer in the
// background, then the user is prompted "Update now", which restarts into the
// new version. If they choose Later, it installs when the app is closed.
// macOS: builds are not notarized, so they cannot self-install and a browser
// download would be quarantined. The app checks the latest GitHub release and,
// when it is newer and has a build for this Mac, prompts on every launch with
// the one-line install command (scripts/install-mac.command) to run in Terminal.
// The Windows portable .exe and Linux: "Update now" opens the new download.
import { createRequire } from "node:module";

export const MAC_INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/touhid314/mylecture/main/scripts/install-mac.command | bash";
export const GITHUB_LATEST_RELEASE = "https://api.github.com/repos/touhid314/mylecture/releases/latest";


export function compareVersions(a, b) {
  const parse = v => {
    const [core, pre = ""] = String(v).replace(/^v/, "").split("+")[0].split(/-(.*)/s);
    return { nums: core.split(".").map(n => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] || 0) !== (y.nums[i] || 0)) return (x.nums[i] || 0) > (y.nums[i] || 0) ? 1 : -1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

export function manifestVersion(yml) {
  const m = /^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m.exec(String(yml || ""));
  return m ? m[1] : null;
}

// Where an update comes from on this install.
export function updateMode({ isPackaged, platform, env = {}, argv = [] }) {
  if (!isPackaged || argv.includes("--dev") || argv.includes("--smoke-test") || env.CI) return "off";
  if (platform === "win32") return env.PORTABLE_EXECUTABLE_FILE ? "manual" : "auto";
  if (platform === "darwin") return "command";
  return "manual";
}

export function manualDownloadName({ version, platform, arch }) {
  if (platform === "darwin") return `MyLecture-${version}-mac-${arch}.dmg`;
  if (platform === "win32") return `MyLecture-${version}-win-${arch}-portable.exe`;
  return null;
}

export function createUpdater({
  app, shell, send, log = () => {}, isBusy = () => false, feedUrl = "",
  env = process.env, argv = process.argv, platform = process.platform, arch = process.arch,
  fetchImpl = globalThis.fetch, loadAutoUpdater,
}) {
  const feed = String(feedUrl || "").replace(/\/+$/, "");
  const mode = feed ? updateMode({ isPackaged: app.isPackaged, platform, env, argv }) : "off";
  const current = app.getVersion();
  let state = { status: "idle", mode, current };
  let auto = null, checking = false;

  const set = patch => {
    state = { ...state, ...patch };
    send("update:state", state);
  };

  function setupAuto() {
    const load = loadAutoUpdater || (() => createRequire(import.meta.url)("electron-updater").autoUpdater);
    auto = load();
    auto.setFeedURL({ provider: "generic", url: feed });
    auto.autoDownload = true;
    auto.autoInstallOnAppQuit = true;
    auto.disableDifferentialDownload = true;
    auto.logger = null;
    auto.on("update-available", info => { log("info", "update.available", { version: info?.version }); set({ status: "downloading", version: info?.version, percent: 0 }); });
    auto.on("download-progress", p => set({ status: "downloading", percent: Math.round(p?.percent || 0) }));
    auto.on("update-downloaded", info => { log("info", "update.downloaded", { version: info?.version }); set({ status: "ready", version: info?.version }); });
    auto.on("update-not-available", () => { if (state.status !== "ready") set({ status: "idle" }); });
    auto.on("error", error => {
      log("warn", "update.error", { error: String(error?.message || error) });
      if (state.status !== "ready") set({ status: "idle" });
    });
  }

  async function checkManual() {
    const manifest = platform === "darwin" ? "latest-mac.yml" : platform === "linux" ? "latest-linux.yml" : "latest.yml";
    const response = await fetchImpl(`${feed}/${manifest}`, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) return;
    const version = manifestVersion(await response.text());
    const file = version && manualDownloadName({ version, platform, arch });
    if (!file || compareVersions(version, current) <= 0) return;
    log("info", "update.available", { version, mode: "manual" });
    set({ status: "available", version, downloadUrl: `${feed}/${encodeURIComponent(file)}` });
  }

  // macOS: the newest published GitHub release, if it has a build for this Mac.
  async function checkCommand() {
    const response = await fetchImpl(GITHUB_LATEST_RELEASE, {
      cache: "no-store", credentials: "omit",
      headers: { accept: "application/vnd.github+json", "user-agent": "MyLecture-updater" },
    });
    if (!response.ok) return;
    const release = JSON.parse(await response.text());
    const version = String(release?.tag_name || "").replace(/^v/, "");
    const macArch = arch === "arm64" ? "arm64" : "x64";
    const hasBuild = (release?.assets || []).some(a => new RegExp(`-mac-${macArch}\\.zip$`).test(String(a?.name)));
    if (!version || release?.draft || release?.prerelease || !hasBuild || compareVersions(version, current) <= 0) return;
    log("info", "update.available", { version, mode: "command" });
    set({ status: "available", version, command: MAC_INSTALL_COMMAND });
  }

  async function check() {
    if (mode === "off" || checking || state.status === "ready") return;
    checking = true;
    try {
      if (mode === "auto") await auto.checkForUpdates();
      else if (mode === "command") await checkCommand();
      else await checkManual();
    } catch (error) {
      log("warn", "update.checkFailed", { error: String(error?.message || error) });
    } finally {
      checking = false;
    }
  }

  return {
    get state() { return state; },
    start() {
      if (mode === "off") return Promise.resolve();
      if (mode === "auto") setupAuto();
      // One check per launch; no polling while the app is open.
      return check();
    },
    check,
    // macOS: open Terminal so the user can paste the install command.
    async openTerminal() {
      for (const p of ["/System/Applications/Utilities/Terminal.app", "/Applications/Utilities/Terminal.app"]) {
        if (!(await shell.openPath(p))) return { ok: true };
      }
      return { ok: false };
    },
    // Returns { busy: true } when a job is running and force was not given.
    async install({ force = false } = {}) {
      if (!force && isBusy()) return { busy: true };
      if (state.status === "ready" && auto) {
        log("info", "update.install", { version: state.version });
        setImmediate(() => auto.quitAndInstall(true, true));
        return { ok: true };
      }
      if (state.status === "available" && state.downloadUrl) {
        await shell.openExternal(state.downloadUrl);
        return { ok: true, opened: true };
      }
      return { ok: false };
    },
  };
}
