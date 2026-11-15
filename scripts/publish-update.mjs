// Publish the built release in dist/ to the update server's R2 bucket, so every
// installed copy is prompted to update. Uploads installers first and the
// latest*.yml manifests last, so clients never see a manifest whose files are
// still uploading.
//
//   npm run dist:win && npm run release:publish
//   node scripts/publish-update.mjs --dir <folder>   publish the files in <folder>
//   node scripts/publish-update.mjs --check          verify only, upload nothing
//
// Before uploading anything it verifies the release: every file a manifest
// lists must be present with the manifest's size and SHA-512, and the
// portable download the in-app updater links to must be there.
//
// Credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ENDPOINT from the
// environment, or else from ../mylecture-website/.env. They never go in the app.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { manualDownloadName } from "../electron/updater.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"];

// The parts of an electron-builder latest*.yml the updater relies on.
export function parseManifest(text) {
  const version = (/^version:\s*['"]?([^'"\s]+)/m.exec(text) || [])[1] || null;
  const files = [];
  let entry = null;
  for (const line of String(text).split(/\r?\n/)) {
    const item = /^\s*-\s+url:\s*['"]?([^'"\s]+)/.exec(line);
    if (item) { entry = { url: item[1] }; files.push(entry); continue; }
    if (!entry) continue;
    const field = /^\s+(sha512|size):\s*['"]?([^'"\s]+)/.exec(line);
    if (field) entry[field[1]] = field[1] === "size" ? Number(field[2]) : field[2];
    else if (/^\S/.test(line)) entry = null;
  }
  return { version, files };
}

const sha512 = (file) => crypto.createHash("sha512").update(fs.readFileSync(file)).digest("base64");

// Which files to publish from `dir`, after checking them. Throws on anything wrong.
export function verifyRelease(dir, version) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const installers = files.filter(f => f.startsWith(`MyLecture-${version}-`) && /\.(exe|dmg|zip|blockmap|AppImage)$/.test(f));
  const manifests = files.filter(f => /^latest(-mac|-linux)?\.yml$/.test(f))
    .filter(f => parseManifest(fs.readFileSync(path.join(dir, f), "utf8")).version === version);
  if (!installers.length || !manifests.length) {
    throw new Error(`No release files for version ${version} in ${dir}. Build first (npm run dist:win), and bump "version" in package.json for each release.`);
  }
  const problems = [];
  for (const name of manifests) {
    const { files: listed } = parseManifest(fs.readFileSync(path.join(dir, name), "utf8"));
    if (!listed.length) problems.push(`${name} lists no files`);
    for (const { url, sha512: want, size } of listed) {
      const file = path.join(dir, url);
      if (!fs.existsSync(file)) { problems.push(`${name} lists ${url}, which is missing`); continue; }
      if (Number.isFinite(size) && fs.statSync(file).size !== size) problems.push(`${url} is ${fs.statSync(file).size} bytes; ${name} says ${size}`);
      if (!want) problems.push(`${name} has no sha512 for ${url}`);
      else if (sha512(file) !== want) problems.push(`${url} does not match the sha512 in ${name}`);
    }
    // Portable Windows builds update by opening this file's download page.
    const manual = name === "latest.yml" && manualDownloadName({ version, platform: "win32", arch: "x64" });
    if (manual && !installers.includes(manual)) problems.push(`${manual} (the portable download) is missing`);
  }
  if (problems.length) throw new Error(`The release in ${dir} failed verification:\n  - ${problems.join("\n  - ")}`);
  return { installers, manifests };
}

function credentials() {
  const env = { ...process.env };
  const file = path.join(root, "..", "mylecture-website", ".env");
  if (CREDENTIALS.some(key => !env[key]) && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ENDPOINT)\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  for (const key of CREDENTIALS) {
    if (!env[key]) throw new Error(`${key} is not set (environment or ../mylecture-website/.env).`);
  }
  return env;
}

async function main(argv) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const dirArg = argv.indexOf("--dir");
  // Releases are kept by version (dist/<version>/); a fresh local build is flat in dist/.
  const dist = dirArg >= 0 ? path.resolve(argv[dirArg + 1] || "")
    : fs.existsSync(path.join(root, "dist", version)) ? path.join(root, "dist", version) : path.join(root, "dist");

  let release;
  try { release = verifyRelease(dist, version); } catch (e) { console.error(e.message); process.exit(1); }
  const { installers, manifests } = release;
  console.log(`MyLecture ${version} in ${dist} verified: ${installers.length} installer files, ${manifests.join(", ")}.`);
  if (argv.includes("--check")) return;

  const env = credentials();
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { Upload } = await import("@aws-sdk/lib-storage");
  const bucket = env.UPDATE_BUCKET || "mylecture-releases";
  const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });

  async function upload(name) {
    const file = path.join(dist, name);
    const size = fs.statSync(file).size;
    const started = Date.now();
    await new Upload({
      client: s3,
      params: { Bucket: bucket, Key: name, Body: fs.createReadStream(file), ContentLength: size },
      partSize: 64 * 1024 * 1024, queueSize: 4,
    }).done();
    console.log(`Uploaded ${name} (${(size / 1048576).toFixed(1)} MB) in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  // Two installers at a time (each is a multipart upload holding up to 4 parts
  // of 64 MB in memory), then the manifests strictly after all of them.
  const queue = [...installers];
  await Promise.all([0, 1].map(async () => { while (queue.length) await upload(queue.shift()); }));
  for (const name of manifests) await upload(name);
  console.log(`\nPublished MyLecture ${version}. Installed copies are prompted to update the next time they start.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
