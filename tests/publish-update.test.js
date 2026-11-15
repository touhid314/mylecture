import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseManifest, verifyRelease } from "../scripts/publish-update.mjs";

const V = "9.8.7";
const sha512 = (b) => crypto.createHash("sha512").update(b).digest("base64");

// A Windows release as the Release workflow uploads it: installer, blockmap, portable, latest.yml.
function release(t, { manifestFor = V, tamper, drop } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-publish-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const setup = Buffer.from("installer-bytes");
  const files = {
    [`MyLecture-${V}-win-x64.exe`]: setup,
    [`MyLecture-${V}-win-x64.exe.blockmap`]: Buffer.from("blockmap"),
    [`MyLecture-${V}-win-x64-portable.exe`]: Buffer.from("portable-bytes"),
    [`MyLecture-${V}-mac-arm64.zip`]: Buffer.from("mac-zip"),
  };
  for (const [name, body] of Object.entries(files)) if (name !== drop) fs.writeFileSync(path.join(dir, name), body);
  if (tamper) fs.writeFileSync(path.join(dir, tamper), "changed after the manifest was written");
  fs.writeFileSync(path.join(dir, "latest.yml"), [
    `version: ${manifestFor}`,
    "files:",
    `  - url: MyLecture-${V}-win-x64.exe`,
    `    sha512: ${sha512(setup)}`,
    `    size: ${setup.length}`,
    `path: MyLecture-${V}-win-x64.exe`,
    `sha512: ${sha512(setup)}`,
    "releaseDate: '2026-11-15T00:00:00.000Z'",
    "",
  ].join("\n"));
  return dir;
}

test("parseManifest reads the version and every listed file", () => {
  const m = parseManifest("version: 1.2.3\nfiles:\n  - url: a.exe\n    sha512: AAA==\n    size: 10\n  - url: b.zip\n    sha512: BBB==\n    size: 20\npath: a.exe\nsha512: AAA==\n");
  assert.equal(m.version, "1.2.3");
  assert.deepEqual(m.files, [{ url: "a.exe", sha512: "AAA==", size: 10 }, { url: "b.zip", sha512: "BBB==", size: 20 }]);
});

test("a complete, unmodified release verifies, manifests separate from installers", (t) => {
  const { installers, manifests } = verifyRelease(release(t), V);
  assert.deepEqual(manifests, ["latest.yml"]);
  assert.equal(installers.length, 4);
  assert.ok(!installers.includes("latest.yml"));
});

test("an installer changed after its manifest was written is refused", (t) => {
  assert.throws(() => verifyRelease(release(t, { tamper: `MyLecture-${V}-win-x64.exe` }), V), /does not match the sha512|bytes; latest.yml says/);
});

test("a file the manifest lists must be present", (t) => {
  assert.throws(() => verifyRelease(release(t, { drop: `MyLecture-${V}-win-x64.exe` }), V), /missing/);
});

test("the portable download the in-app updater links to must be present", (t) => {
  assert.throws(() => verifyRelease(release(t, { drop: `MyLecture-${V}-win-x64-portable.exe` }), V), /portable download/);
});

test("a manifest for another version is not published", (t) => {
  assert.throws(() => verifyRelease(release(t, { manifestFor: "9.8.6" }), V), /No release files/);
});
