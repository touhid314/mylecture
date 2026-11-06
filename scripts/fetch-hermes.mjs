// Puts Hermes Agent's source (the pinned release, trimmed to what runs) in
// vendor/hermes, which electron-builder ships as resources/hermes. The app
// copies it into place when the user turns Hermes on, so only Python and
// Hermes's packages are downloaded then.
//
//   node scripts/fetch-hermes.mjs            download if missing, then trim
//   node scripts/fetch-hermes.mjs --zip X    use a local copy of the release zip
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HERMES_VERSION, HERMES_SOURCE_URL, HERMES_BUNDLE_MARKER } from "../electron/engines/hermes.js";
import { downloadFile } from "../electron/components.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "vendor", "hermes");
const cache = path.join(root, "vendor", ".cache");
const marker = path.join(out, HERMES_BUNDLE_MARKER);

// Development and documentation only; nothing here runs in `hermes chat`.
export const HERMES_TRIM = [
  "tests", "tests-js", "apps", "website", "evals", "contributors", "docker", "nix",
  ".github", "ui-tui", "web", "optional-skills", "assets",
  "package.json", "package-lock.json", "eslint.config.shared.mjs", "justfile",
  "lefthook.yml", "flake.nix", "flake.lock", "Dockerfile",
];

if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8").trim() === HERMES_VERSION) {
  console.log(`Hermes Agent ${HERMES_VERSION} is already in vendor/hermes.`);
  process.exit(0);
}

const arg = process.argv.indexOf("--zip");
let zip = arg > 0 ? path.resolve(process.argv[arg + 1]) : path.join(cache, `hermes-agent-${HERMES_VERSION}.zip`);
if (!fs.existsSync(zip)) {
  fs.mkdirSync(cache, { recursive: true });
  console.log(`Downloading ${HERMES_SOURCE_URL}`);
  await downloadFile(HERMES_SOURCE_URL, zip + ".part");
  fs.renameSync(zip + ".part", zip);
}

const unpack = path.join(cache, "unpack");
fs.rmSync(unpack, { recursive: true, force: true });
fs.mkdirSync(unpack, { recursive: true });
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
execFileSync(tar, ["-xf", zip, "-C", unpack], { stdio: "inherit" });
const top = fs.readdirSync(unpack).find((d) => fs.statSync(path.join(unpack, d)).isDirectory());
if (!top || !fs.existsSync(path.join(unpack, top, "pyproject.toml"))) throw new Error("Not a Hermes Agent source zip.");

fs.rmSync(out, { recursive: true, force: true });
fs.renameSync(path.join(unpack, top), out);
fs.rmSync(unpack, { recursive: true, force: true });
for (const name of HERMES_TRIM) fs.rmSync(path.join(out, name), { recursive: true, force: true });
fs.writeFileSync(marker, HERMES_VERSION + "\n");

let bytes = 0, files = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { bytes += fs.statSync(f).size; files++; } } };
walk(out);
console.log(`Hermes Agent ${HERMES_VERSION} ready in vendor/hermes: ${files} files, ${(bytes / 1048576).toFixed(1)} MB.`);
