// Connecting an AI account: install the provider's CLI and sign in with the
// user's own subscription. Sign-in happens in the provider's official tool,
// in a terminal window we open for the user; MyLecture never sees passwords.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shell } from "electron";
import { findExecutable } from "./engines/cli-util.js";

const WIN = process.platform === "win32";

export const SERVICES = {
  codex: {
    title: "GPT",
    plan: "ChatGPT Plus, Pro, Business or Enterprise subscription",
    signup: "https://chatgpt.com/pricing",
    install: { cmd: "npm install -g @openai/codex", needsNpm: true },
    login: "codex login",
  },
  antigravity: {
    title: "Gemini",
    plan: "Google account (a Google AI plan gives higher limits)",
    signup: "https://one.google.com/about/google-ai-plans/",
    install: { url: "https://antigravity.google/download" },
    login: "agy",
  },
  "claude-code": {
    title: "Claude",
    plan: "Claude Pro or Max subscription",
    signup: "https://claude.ai/upgrade",
    install: {
      cmd: WIN ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"' : "curl -fsSL https://claude.ai/install.sh | bash",
    },
    login: "claude",
  },
};

// Opens a visible terminal running `command`, left open so the user can follow it.
export function openTerminal(title, command) {
  if (WIN) {
    const script = path.join(os.tmpdir(), `mylecture-${Date.now()}.cmd`);
    fs.writeFileSync(script, `@echo off\r\ntitle ${title}\r\necho ${title}\r\necho.\r\n${command}\r\necho.\r\necho When this is done, close this window and return to MyLecture.\r\npause\r\n`, "utf8");
    spawn("cmd.exe", ["/c", "start", '""', "cmd.exe", "/k", script], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return;
  }
  if (process.platform === "darwin") {
    const escaped = `${command}; echo; echo 'When this is done, return to MyLecture.'`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    spawn("osascript", ["-e", `tell application "Terminal" to do script "${escaped}"`, "-e", 'tell application "Terminal" to activate'], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
    if (findExecutable([term])) {
      spawn(term, ["-e", "bash", "-lc", `${command}; exec bash`], { detached: true, stdio: "ignore" }).unref();
      return;
    }
  }
  throw new Error(`Open a terminal and run: ${command}`);
}

// action: "install" | "login" | "signup"
export function connectService(id, action) {
  const svc = SERVICES[id];
  if (!svc) throw new Error("Unknown service");
  if (action === "signup") return void shell.openExternal(svc.signup);
  if (action === "install") {
    if (svc.install.url) return void shell.openExternal(svc.install.url);
    if (svc.install.needsNpm && !findExecutable(["npm"])) {
      shell.openExternal("https://nodejs.org/en/download");
      throw new Error(`Setting up ${svc.title} needs Node.js. Install Node.js from the page that just opened, then try again.`);
    }
    return void openTerminal(`Setting up ${svc.title} for MyLecture`, svc.install.cmd);
  }
  if (action === "login") return void openTerminal(`Sign in to ${svc.title} for MyLecture`, svc.login);
  throw new Error("Unknown action");
}
