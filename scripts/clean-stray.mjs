// Removes stray empty files that shell mishaps leave behind (e.g. "typeof",
// "x.id", "{" created by a stray ">" redirect). Only deletes files that are
// empty AND untracked AND not ignored, so real work is never touched.
//   node scripts/clean-stray.mjs [--dry-run] [extra-folder...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dry = process.argv.includes("--dry-run");
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: repo, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((f) => path.join(repo, f));

// Extra folders (outside the repo): only their top level, only empty files
// that look like code fragments, never anything with an extension we know.
const extra = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const looksLikeFragment = (name) => /^[^.]*$|[(){}\[\]=+,;'"`]|^\w+\.\w+\(?\)?$/.test(name) && !/\.(md|txt|csv|json|js|mjs|cjs|bat|png|mp4|wav|html|css|py)$/i.test(name);
for (const dir of extra) {
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name);
    if (looksLikeFragment(name)) untracked.push(f);
  }
}

let removed = 0;
for (const f of untracked) {
  let st;
  try {
    st = fs.lstatSync(f);
  } catch {
    continue;
  }
  if (!st.isFile() || st.size !== 0) continue;
  console.log(`${dry ? "would remove" : "removed"}: ${path.relative(repo, f) || f}`);
  if (!dry) fs.rmSync(f);
  removed++;
}
console.log(removed ? `${removed} stray file(s) ${dry ? "found" : "removed"}.` : "No stray files.");
