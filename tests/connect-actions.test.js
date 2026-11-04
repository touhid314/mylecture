import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const state = { scripts: [], spawned: [], external: [], executables: {} };
globalThis.__connectActionsFixture = state;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/electron/connect.js") && ["electron", "node:child_process", "node:fs"].includes(specifier)) return { url: `test:connect-${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "test:connect-electron") return { format: "module", shortCircuit: true, source: "export const shell={openExternal:url=>globalThis.__connectActionsFixture.external.push(url)};" };
    if (url === "test:connect-node:child_process") return { format: "module", shortCircuit: true, source: "export function spawn(...args){globalThis.__connectActionsFixture.spawned.push(args);return {unref(){}};}" };
    if (url === "test:connect-node:fs") return { format: "module", shortCircuit: true, source: "export default {writeFileSync:(file,text)=>globalThis.__connectActionsFixture.scripts.push({file,text})};" };
    if (url.endsWith("/electron/engines/cli-util.js")) return { format: "module", shortCircuit: true, source: "export const findExecutable=names=>globalThis.__connectActionsFixture.executables[names[0]] || (names[0]==='x-terminal-emulator'?'/usr/bin/xterm':null);" };
    return nextLoad(url, context);
  },
});
const { connectService, accountSwitchCommand } = await import("../electron/connect.js");
test.after(() => { hooks.deregister(); delete globalThis.__connectActionsFixture; });

function terminalText() {
  return process.platform === "win32" ? state.scripts.at(-1).text : JSON.stringify(state.spawned.at(-1));
}

test("normal Connect opens provider login and never signs out the existing account", () => {
  for (const [id, command] of [["codex", "codex login"], ["claude-code", "claude auth login --claudeai"], ["antigravity", "agy"]]) {
    connectService(id, "login");
    assert(terminalText().includes(command));
    assert.doesNotMatch(terminalText(), /logout/);
  }
});

test("explicit GPT and Claude switches use supported logout then subscription login", () => {
  assert.equal(accountSwitchCommand("codex"), process.platform === "win32" ? "call codex logout && call codex login" : "codex logout && codex login");
  assert.equal(accountSwitchCommand("claude-code"), process.platform === "win32" ? "call claude auth logout && call claude auth login --claudeai" : "claude auth logout && claude auth login --claudeai");
  for (const id of ["codex", "claude-code"]) {
    connectService(id, "switch-account");
    assert(terminalText().includes(accountSwitchCommand(id).replace(/\r\n/g, "\\r\\n")));
  }
});

test("Gemini switching uses official interactive logout guidance without inventing auth commands", () => {
  const command = accountSwitchCommand("antigravity");
  assert.match(command, /enter \/logout in the Gemini prompt/);
  assert.match(command, /other account/);
  assert.match(command, /agy$/);
  assert.doesNotMatch(command, /agy (?:auth|logout|login)|-p|--print/);
  connectService("antigravity", "switch-account");
  assert.match(terminalText(), /\/logout/);
});

test("unsupported actions never launch a terminal or touch credentials", () => {
  const count = state.spawned.length;
  assert.throws(() => connectService("unknown", "login"), /Unknown service/);
  assert.throws(() => connectService("codex", "delete-account"), /Unknown action/);
  assert.equal(state.spawned.length, count);
});

test("account switches resolve installed CLI paths and quote spaces", () => {
  const executable = process.platform === "win32" ? "C:\\Program Files\\Claude\\claude.exe" : "/opt/Claude App/claude";
  state.executables.claude = executable;
  try {
    const command = accountSwitchCommand("claude-code");
    const quoted = process.platform === "win32" ? `"${executable}"` : `'${executable}'`;
    assert(command.includes(`${quoted} auth logout`));
    assert(command.includes(`${quoted} auth login --claudeai`));
  } finally { delete state.executables.claude; }
});
