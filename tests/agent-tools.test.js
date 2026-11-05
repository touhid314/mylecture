import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { browserServer, codexMcpConfig } from "../electron/engines/browser-mcp.js";
import { agentConfigArgs, CODEX_AGENT_NOTE } from "../electron/engines/codex.js";

test("browser server is headless Playwright with screenshots saved in the project", () => {
  const win = browserServer({ workspace: "C:/p", platform: "win32" });
  assert.equal(win.command, "cmd");
  assert.deepEqual(win.args.slice(0, 2), ["/c", "npx"]);
  for (const flag of ["--headless", "--isolated", "--allow-unrestricted-file-access"]) assert(win.args.includes(flag), flag);
  assert.equal(win.args[win.args.indexOf("--browser") + 1], "msedge");
  assert.equal(win.args[win.args.indexOf("--output-dir") + 1], path.join("C:/p", ".browser"));
  assert.equal(browserServer({ platform: "linux" }).command, "npx");
});

test("Codex agent config enables live web search and the browser", () => {
  const args = agentConfigArgs("C:/p");
  const config = args.filter((_, i) => i % 2 === 1);
  assert(args.filter((_, i) => i % 2 === 0).every((f) => f === "-c"));
  assert(config.includes("web_search=live"));
  assert(config.some((c) => c.startsWith("mcp_servers.browser.args=[")));
  assert(config.every((c) => !/\s/.test(c)), "no spaces, so the .cmd shim passes them intact");
  assert.deepEqual(codexMcpConfig("C:/it's"), [], "paths TOML literal strings cannot hold are skipped");
  assert.match(CODEX_AGENT_NOTE, /must be inside the current project folder/);
});
