// A real web browser for every agent: the Playwright MCP server (headless
// Edge on Windows, Chrome elsewhere). Agents can open pages, click, type,
// read JavaScript-heavy sites, download, and take screenshots of web pages
// and of their own scene files (file:// URLs).
import path from "node:path";

export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.84";
export const BROWSER_SERVER = "browser";

export function browserServer({ workspace, platform = process.platform } = {}) {
  const args = [
    "-y", PLAYWRIGHT_MCP,
    "--headless", "--isolated",
    "--browser", platform === "win32" ? "msedge" : "chrome",
    "--caps", "vision,pdf",
    "--allow-unrestricted-file-access",
    ...(workspace ? ["--output-dir", path.join(workspace, ".browser")] : []),
  ];
  // MCP clients spawn without a shell; npx is a .cmd on Windows.
  return platform === "win32" ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args };
}

// Claude Code: --mcp-config JSON.
export function claudeMcpConfig(workspace) {
  return JSON.stringify({ mcpServers: { [BROWSER_SERVER]: browserServer({ workspace }) } });
}

// Codex: -c overrides (TOML literal strings need no escaping).
export function codexMcpConfig(workspace) {
  const { command, args } = browserServer({ workspace });
  const lit = (s) => `'${s}'`;
  if ([command, ...args].some((a) => /['"%\r\n]/.test(a))) return [];
  return [
    `mcp_servers.${BROWSER_SERVER}.command=${lit(command)}`,
    `mcp_servers.${BROWSER_SERVER}.args=[${args.map(lit).join(",")}]`,
    `mcp_servers.${BROWSER_SERVER}.startup_timeout_sec=180`,
    `mcp_servers.${BROWSER_SERVER}.default_tools_approval_mode=approve`,
  ];
}

export const BROWSER_NOTE = "You also have a real web browser (the \"browser\" MCP tools): open any page, click, type, scroll, read JavaScript-heavy sites, and take screenshots. Look at screenshots to judge pages and images. To check your own scenes visually, open file:///<absolute path>/indexN.html?export=1 and take a screenshot. For desktop screenshots use a shell command.";
