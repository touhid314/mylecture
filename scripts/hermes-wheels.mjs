import fs from "node:fs";
import path from "node:path";

// Supplement the upstream lock with our prebuilt Intel Mac wheel for the
// exact same package version. Other platforms keep their upstream wheels.
export function addHermesWheels(source, wheels) {
  const file = path.join(source, "uv.lock");
  const original = fs.readFileSync(file, "utf8");
  const packages = original.split(/(?=^\[\[package\]\])/m);
  for (const wheel of wheels) {
    const block = packages.findIndex((entry) => entry.includes(`\nname = ${JSON.stringify(wheel.name)}\n`));
    if (block < 0 || !packages[block].includes(`\nversion = ${JSON.stringify(wheel.version)}\n`)) {
      throw new Error(`Rebuild the Intel Mac wheel: Hermes changed ${wheel.name} ${wheel.version}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(wheel.hash) || !Number.isSafeInteger(wheel.size) || wheel.size <= 0) throw new Error("Invalid Hermes wheel integrity metadata");
    if (packages[block].includes(JSON.stringify(wheel.url))) continue;
    if (!packages[block].includes("wheels = [\n")) throw new Error(`No wheel list for ${wheel.name}`);
    packages[block] = packages[block].replace("wheels = [\n", `wheels = [\n    { url = ${JSON.stringify(wheel.url)}, hash = ${JSON.stringify(wheel.hash)}, size = ${wheel.size} },\n`);
  }
  const updated = packages.join("");
  if (updated !== original) fs.writeFileSync(file, updated);
}
