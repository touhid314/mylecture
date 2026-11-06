// End-to-end check of Hermes Agent on this machine, as MyLecture uses it:
// installs it from the bundled source (vendor/hermes) with MyLecture's own
// installer into a folder whose path has a space (like macOS's
// "Application Support"), then runs real agent tasks against a local
// stand-in for an OpenAI-compatible API (no key needed):
//   1. two projects one after the other each write their own file
//      (a lingering Hermes gateway must not keep the first project's folder);
//   2. a write outside the project folder is refused.
//
//   node scripts/fetch-hermes.mjs && node scripts/check-hermes.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { ComponentManager } from "../electron/components.js";
import { hermesBundle, setHermesToolsDir, hermesExe } from "../electron/engines/hermes.js";
import { makeApiEngine } from "../electron/engines/api.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "ml-hermes-check-"));
const userData = path.join(base, "My Lecture");
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
function bundledSource() {
  if (!process.argv.includes("--packaged")) return process.argv[2] || path.join(root, "vendor", "hermes");
  const candidates = process.platform === "win32"
    ? [path.join(root, "dist", "win-unpacked", "resources", "hermes")]
    : ["mac-arm64", "mac", "mac-universal"].map((dir) => path.join(root, "dist", dir, "MyLecture.app", "Contents", "Resources", "hermes"));
  return candidates.find((dir) => hermesBundle(dir)) || candidates[0];
}
const source = path.resolve(bundledSource());
if (!hermesBundle(source)) fail(`Bundled Hermes source missing or wrong version: ${source}`);
const deadline = setTimeout(() => fail("Hermes check timed out after 15 minutes"), 15 * 60 * 1000);

// --- Install ---------------------------------------------------------------
const manager = new ComponentManager({
  userData, modelDir: path.join(userData, "models"), tts: {}, getSettings: () => ({}), saveSettings: () => {},
  hermesSource: source,
});
let last = "";
const t0 = Date.now();
manager.on("progress", (p) => {
  if (p.id !== "hermes") return;
  if (p.message && p.message !== last) { last = p.message; console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${p.message}`); }
  if (p.detail) console.log(`    ${p.detail}`);
});
try { await manager.install("hermes"); } catch (e) { fail(`install: ${e.message}`); }
if (!manager.installed("hermes")) fail("installed but not found");
setHermesToolsDir(path.join(userData, "tools"));
console.log(`Installed in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${hermesExe()}`);

// --- A stand-in model ------------------------------------------------------
// Asks for one write_file call (the path comes from the prompt), then answers.
const requests = [];
const writes = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests.push(`${req.method} ${req.url}`);
    console.log(`  API: ${req.method} ${req.url}`);
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ object: "list", data: [{ id: "check-model", object: "model", owned_by: "check" }] }));
    }
    let json = {};
    try { json = JSON.parse(body || "{}"); } catch {}
    const msgs = json.messages || [];
    const text = msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""))).join("\n");
    const target = /WRITE_JSON (\{[^\n]+\})/.exec(text);
    const input = target ? JSON.parse(target[1]) : null;
    const toolDone = msgs.some((m) => m.role === "tool");
    if (input && json.tools?.length && !toolDone) writes.push(input);
    const message = input && json.tools?.length && !toolDone
      ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: JSON.stringify(input) } }] }
      : { role: "assistant", content: "Done." };
    const finish = message.tool_calls ? "tool_calls" : "stop";
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (json.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "check-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      if (message.tool_calls) chunk({ role: "assistant", tool_calls: message.tool_calls.map((c, index) => ({ index, ...c })) });
      else chunk({ role: "assistant", content: message.content });
      chunk({}, finish);
      res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "check-model", choices: [], usage })}\n\n`);
      return res.end("data: [DONE]\n\n");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 0, model: "check-model", choices: [{ index: 0, message, finish_reason: finish }], usage }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const config = { provider: "compatible", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "check" };
const engine = makeApiEngine(() => config);

async function task(workspace, file, content) {
  const t = Date.now();
  const steps = [];
  const r = await engine.agent({
    system: "You work in the current folder.", user: `WRITE_JSON ${JSON.stringify({ path: file, content })}`, workspace,
    onActivity: (a) => a.type === "step" && steps.push(a.text),
  });
  console.log(`  ${((Date.now() - t) / 1000).toFixed(0)}s, steps: ${steps.join(", ") || "none"}, reply: ${r.text.trim().slice(0, 80)}`);
  if (!r.text.trim()) throw new Error("Hermes returned no reply");
}

// --- 1. Two projects in a row ----------------------------------------------
for (const name of ["first", "second"]) {
  const ws = path.join(base, `project ${name}`);
  fs.mkdirSync(ws);
  console.log(`Task in "${name}" project:`);
  try { await task(ws, `${name}.txt`, `hello-${name}`); } catch (e) { fail(`${name} task: ${e.message}`); }
  const out = path.join(ws, `${name}.txt`);
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8").trim() !== `hello-${name}`) fail(`${name}.txt was not written in its project (model calls: ${requests.length})`);
}

// --- 2. Outside the project ------------------------------------------------
const outside = path.join(base, "outside.txt");
const ws3 = path.join(base, "project third");
fs.mkdirSync(ws3);
console.log("Task writing outside its project:");
try { await task(ws3, outside, "escaped"); } catch (e) { console.log(`  (ended with: ${e.message.slice(0, 120)})`); }
if (fs.existsSync(outside)) fail("a write outside the project folder was allowed");
if (!writes.some((w) => w.path === outside)) fail("outside write was never attempted by the model");

server.close();
clearTimeout(deadline);
console.log("PASS: Hermes installs, works in each project, and stays inside it.");
try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
process.exit(0);
