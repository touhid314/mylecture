// Bake MyLecture's server address (stats + updates, see
// ../mylecture-app-admin/server) into the next desktop build. Public URL only:
// no keys or admin credentials belong in this file or in the app.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/configure-server.mjs https://your-worker.workers.dev (or --disable)");
  process.exit(1);
}
let url = "";
if (input !== "--disable") {
  let parsed;
  try { parsed = new URL(input); } catch { console.error("Enter a valid HTTPS server URL."); process.exit(1); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    console.error("Use the server's HTTPS base URL, without credentials, paths or query parameters.");
    process.exit(1);
  }
  url = parsed.origin;
}
const config = fileURLToPath(new URL("../electron/server-config.json", import.meta.url));
fs.writeFileSync(config, JSON.stringify({ url }, null, 2) + "\n");
// electron-builder writes the update manifest for this feed.
const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.build.publish = url ? [{ provider: "generic", url: `${url}/updates` }] : undefined;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(url ? `Server configured: ${url}. Rebuild the app to include it.` : "Server disabled in future builds (no stats, no updates).");
