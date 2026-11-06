import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addHermesWheels } from "../scripts/hermes-wheels.mjs";

test("Intel wheels supplement the exact locked package, once, with integrity metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-wheel-lock-"));
  try {
    const file = path.join(dir, "uv.lock");
    fs.writeFileSync(file, 'version = 1\n\n[[package]]\nname = "cryptography"\nversion = "50.0.2"\nwheels = [\n    { url = "https://example.org/upstream.whl" },\n]\n\n[[package]]\nname = "other"\nversion = "1"\n');
    const wheel = { name: "cryptography", version: "50.0.2", url: "https://example.org/intel.whl", hash: `sha256:${"a".repeat(64)}`, size: 123 };
    addHermesWheels(dir, [wheel]);
    const updated = fs.readFileSync(file, "utf8");
    assert(updated.includes('"https://example.org/upstream.whl"'));
    assert(updated.includes(`hash = "${wheel.hash}", size = 123`));
    addHermesWheels(dir, [wheel]);
    assert.equal(fs.readFileSync(file, "utf8"), updated);
    assert.throws(() => addHermesWheels(dir, [{ ...wheel, version: "51.0.0" }]), /Rebuild the Intel Mac wheel/);
    assert.throws(() => addHermesWheels(dir, [{ ...wheel, hash: "bad" }]), /integrity/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
