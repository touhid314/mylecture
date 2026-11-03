// Minimal Playwright stand-in backed by Electron offscreen BrowserWindows.
// Implements exactly the APIs used by the original validator and layout gate:
// chromium.launch(), browser.newPage({viewport}), browser.close(),
// page.addInitScript, page.goto, page.addStyleTag, page.waitForFunction,
// page.evaluate, page.on('pageerror'), page.close.
import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Bundled into electron/lecturegen/src/lecturegen.mjs -> preload lives next to it.
const PRELOAD = path.join(here, "page-preload.cjs");

let channelSeq = 0;

function serialize(fnOrString, arg) {
  if (typeof fnOrString === "string") return fnOrString;
  return `(${fnOrString.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`;
}

class Page {
  constructor(viewport) {
    this.viewport = viewport || { width: 1920, height: 1080 };
    this.initScripts = [];
    this.handlers = { pageerror: [], console: [] };
    this.win = null;
    this.channel = `ml-pageerror-${++channelSeq}`;
    this._onErr = (_e, err) => {
      const e = Object.assign(new Error(err?.message || "Error"), { name: err?.name || "Error" });
      for (const fn of this.handlers.pageerror) fn(e);
    };
    ipcMain.on(this.channel, this._onErr);
  }
  on(ev, fn) {
    (this.handlers[ev] ||= []).push(fn);
  }
  async addInitScript(script, arg) {
    const code = typeof script === "function" ? serialize(script, arg) : script?.content ?? String(script);
    this.initScripts.push(code);
  }
  async goto(url, { timeout = 30000 } = {}) {
    const init = Buffer.from(JSON.stringify(this.initScripts)).toString("base64");
    this.win = new BrowserWindow({
      show: false,
      width: this.viewport.width,
      height: this.viewport.height,
      useContentSize: true,
      enableLargerThanScreen: true,
      webPreferences: {
        offscreen: true,
        sandbox: false,
        contextIsolation: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        preload: PRELOAD,
        additionalArguments: [`--ml-init=${init}`, `--ml-channel=${this.channel}`],
      },
    });
    this.win.webContents.setAudioMuted(true);
    const load = this.win.loadURL(url);
    let timer;
    await Promise.race([load, new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`Timeout ${timeout}ms exceeded navigating to ${url}`)), timeout)))]).finally(() => clearTimeout(timer));
    return null;
  }
  async addStyleTag({ content }) {
    await this.win.webContents.insertCSS(content);
  }
  async evaluate(fn, arg) {
    return this.win.webContents.executeJavaScript(serialize(fn, arg), true);
  }
  async waitForFunction(fn, arg, { timeout = 30000, polling = 100 } = {}) {
    const code = serialize(fn, arg);
    const until = Date.now() + timeout;
    for (;;) {
      let ok = false;
      try {
        ok = await this.win.webContents.executeJavaScript(code, true);
      } catch {}
      if (ok) return true;
      if (Date.now() > until) throw new Error(`Timeout ${timeout}ms exceeded waiting for function`);
      await new Promise((r) => setTimeout(r, polling));
    }
  }
  async close() {
    ipcMain.removeListener(this.channel, this._onErr);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

class Browser {
  constructor() {
    this.pages = new Set();
  }
  async newPage({ viewport } = {}) {
    const p = new Page(viewport);
    this.pages.add(p);
    return p;
  }
  async close() {
    for (const p of this.pages) await p.close();
    this.pages.clear();
  }
}

export const chromium = {
  async launch() {
    return new Browser();
  },
};
export default { chromium };
