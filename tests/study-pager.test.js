import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LESSONS_PER_PAGE, pageNumbers } from "../app/js/study/paging.js";

const show = (page, pages) => pageNumbers(page, pages).map((p) => (p == null ? "…" : p + 1)).join(" ");

test("lessons are listed 15 per page, with compact page numbers", () => {
  assert.equal(LESSONS_PER_PAGE, 15);
  assert.equal(show(0, 1), "1");
  assert.equal(show(0, 3), "1 2 3");
  assert.equal(show(0, 10), "1 2 3 4 … 10");
  assert.equal(show(4, 10), "1 … 4 5 6 … 10");
  assert.equal(show(9, 10), "1 … 7 8 9 10"); // mirrors the first page
  // A gap of one page shows that page instead of an ellipsis.
  assert.equal(show(3, 10), "1 2 3 4 5 … 10");
});

test("the Your lessons list pages through lessons and survives deletes", { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-pager-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-pager.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 45000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Pager test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    assert.equal(r.first.cards.length, 15);
    assert.equal(r.first.cards[0], "Lesson 1");
    assert.deepEqual([r.first.count, r.first.current, r.first.prevDisabled, r.first.nextDisabled], ["1–15 of 42", "1", true, false]);
    assert.deepEqual([r.second.cards[0], r.second.count], ["Lesson 16", "16–30 of 42"]);
    assert.deepEqual([r.third.cards.length, r.third.count, r.third.nextDisabled], [12, "31–42 of 42", true]);
    // Page 3 emptied by deletes: the list falls back to the last page left.
    assert.deepEqual([r.afterDelete.current, r.afterDelete.count, r.afterDelete.pages], ["2", "16–30 of 30", ["1", "2"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
