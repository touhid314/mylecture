// Publish the built release in dist/ to the update server's R2 bucket, so every
// installed copy is prompted to update. Uploads installers first and the
// latest*.yml manifests last, so clients never see a manifest whose files are
// still uploading.
//
//   npm run dist:win && npm run release:publish
//
// Credentials: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_ENDPOINT from the
// environment, or else from ../mylecture-website/.env. They never go in the app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const BUCKET = process.env.UPDATE_BUCKET || "mylecture-releases";
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;

function credentials() {
  const env = { ...process.env };
  const file = path.join(root, "..", "mylecture-website", ".env");
  if ((!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ENDPOINT) && fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ENDPOINT)\s*=\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"]) {
    if (!env[key]) throw new Error(`${key} is not set (environment or ../mylecture-website/.env).`);
  }
  return env;
}

const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
const installers = files.filter(f => f.startsWith(`MyLecture-${version}-`) && /\.(exe|dmg|zip|blockmap|AppImage)$/.test(f));
const manifests = files.filter(f => /^latest(-mac|-linux)?\.yml$/.test(f))
  .filter(f => new RegExp(`^version:\s*['"]?${version.replace(/\./g, "\.")}['"]?\s*$`, "m").test(fs.readFileSync(path.join(dist, f), "utf8")));
if (!installers.length || !manifests.length) {
  console.error(`No release files for version ${version} in dist/. Build first (npm run dist:win), and bump "version" in package.json for each release.`);
  process.exit(1);
}

const env = credentials();
const s3 = new S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });

async function upload(name) {
  const file = path.join(dist, name);
  const size = fs.statSync(file).size;
  process.stdout.write(`Uploading ${name} (${(size / 1048576).toFixed(1)} MB)… `);
  await new Upload({
    client: s3,
    params: { Bucket: BUCKET, Key: name, Body: fs.createReadStream(file), ContentLength: size },
    partSize: 64 * 1024 * 1024, queueSize: 4,
  }).done();
  console.log("done");
}

for (const name of installers) await upload(name);
for (const name of manifests) await upload(name);
console.log(`\nPublished MyLecture ${version}. Installed copies are prompted to update the next time they start.`);
