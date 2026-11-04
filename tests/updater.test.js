import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { compareVersions, manifestVersion, updateMode, manualDownloadName, createUpdater } from "../electron/updater.js";

test("version comparison and manifest parsing", () => {
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("0.9.9", "1.0.0"), -1);
  assert.equal(manifestVersion("version: 0.2.0\nfiles:\n  - url: x.exe\n"), "0.2.0");
  assert.equal(manifestVersion("version: '1.0.0-beta.2'\n"), "1.0.0-beta.2");
  assert.equal(manifestVersion("<html>"), null);
});

test("update mode per install type", () => {
  assert.equal(updateMode({ isPackaged: false, platform: "win32" }), "off");
  assert.equal(updateMode({ isPackaged: true, platform: "win32", argv: ["--smoke-test"] }), "off");
  assert.equal(updateMode({ isPackaged: true, platform: "win32", argv: ["--dev"] }), "off");
  assert.equal(updateMode({ isPackaged: true, platform: "win32", env: { CI: "true" } }), "off");
  assert.equal(updateMode({ isPackaged: true, platform: "win32" }), "auto");
  assert.equal(updateMode({ isPackaged: true, platform: "win32", env: { PORTABLE_EXECUTABLE_FILE: "C:\\x.exe" } }), "manual");
  assert.equal(updateMode({ isPackaged: true, platform: "darwin" }), "manual");
  assert.equal(manualDownloadName({ version: "0.2.0", platform: "darwin", arch: "arm64" }), "MyLecture-0.2.0-mac-arm64.dmg");
  assert.equal(manualDownloadName({ version: "0.2.0", platform: "win32", arch: "x64" }), "MyLecture-0.2.0-win-x64-portable.exe");
});

function harness({ platform = "win32", env = {}, feedUrl = "https://u.example/updates", version = "0.1.0", busy = false, manifest = "version: 0.2.0\n" } = {}) {
  const sent = [], opened = [], fetched = [];
  const auto = Object.assign(new EventEmitter(), {
    feed: null, installs: [],
    setFeedURL(o) { this.feed = o; },
    async checkForUpdates() { this.emit("update-available", { version: "0.2.0" }); this.emit("update-downloaded", { version: "0.2.0" }); },
    quitAndInstall(...a) { this.installs.push(a); },
  });
  const updater = createUpdater({
    app: { isPackaged: true, getVersion: () => version },
    shell: { openExternal: async u => opened.push(u) },
    send: (ch, p) => sent.push([ch, p]),
    isBusy: () => busy, feedUrl, env, argv: [], platform, arch: "x64",
    fetchImpl: async url => { fetched.push(url); return { ok: true, text: async () => manifest }; },
    loadAutoUpdater: () => auto,
  });
  return { updater, auto, sent, opened, fetched };
}

test("Windows installer builds download in the background, then install on Update now", async () => {
  const t = harness({ feedUrl: "https://u.example/updates/" });
  await t.updater.start();
  assert.deepEqual(t.auto.feed, { provider: "generic", url: "https://u.example/updates" });
  assert.equal(t.auto.autoInstallOnAppQuit, true);
  assert.equal(t.updater.state.status, "ready");
  assert.equal(t.updater.state.version, "0.2.0");
  assert.equal(t.sent.at(-1)[0], "update:state");
  assert.deepEqual(await t.updater.install(), { ok: true });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(t.auto.installs, [[true, true]]);
});

test("a running job asks for confirmation before installing", async () => {
  const t = harness({ busy: true });
  await t.updater.start();
  assert.deepEqual(await t.updater.install(), { busy: true });
  assert.deepEqual(await t.updater.install({ force: true }), { ok: true });
});

test("macOS and portable builds prompt and open the matching download", async () => {
  const mac = harness({ platform: "darwin", manifest: "version: 0.2.0\n" });
  await mac.updater.start();
  assert.match(mac.fetched[0], /\/latest-mac\.yml$/);
  assert.equal(mac.updater.state.status, "available");
  assert.deepEqual(await mac.updater.install(), { ok: true, opened: true });
  assert.match(mac.opened[0], /\/MyLecture-0\.2\.0-mac-x64\.dmg$/);

  const portable = harness({ env: { PORTABLE_EXECUTABLE_FILE: "C:\\MyLecture.exe" } });
  await portable.updater.start();
  assert.match(portable.updater.state.downloadUrl, /MyLecture-0\.2\.0-win-x64-portable\.exe$/);
});

test("no server address means no update checks", async () => {
  const t = harness({ feedUrl: "" });
  await t.updater.start();
  assert.equal(t.updater.state.mode, "off");
  assert.equal(t.fetched.length, 0);
});

test("no prompt when already up to date", async () => {
  const t = harness({ platform: "darwin", version: "0.2.0" });
  await t.updater.start();
  assert.equal(t.updater.state.status, "idle");
  assert.equal(t.sent.length, 0);
});
