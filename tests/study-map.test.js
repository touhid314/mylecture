import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { indexWorld, findCountry, viewFor, project } from "../app/js/study/map.js";
import { createTutorParser } from "../electron/tutor/protocol.js";
import { TUTOR_SYSTEM } from "../electron/tutor/prompt.js";

const world = indexWorld(JSON.parse(fs.readFileSync(new URL("../app/assets/world-map.json", import.meta.url), "utf8")));

test("the world map has every country, in the video basemap's projection", () => {
  assert.ok(world.countries.length > 200);
  // Same formula as electron/assets/world-basemap.svg (lon 0 / lat 0 and the corners).
  assert.deepEqual(project(-180, 84).map(Math.round), [48, 36 + Math.round((972 - 142 * (1824 / 360)) / 2)]);
  assert.equal(Math.round(project(0, 0)[0]), 960);
  // Swapped (lat, lon) is corrected.
  assert.deepEqual(project(35.7, 139.7), project(139.7, 35.7)); // an impossible latitude means (lat, lon) was given
});

test("countries are found by everyday names", () => {
  const cases = { USA: "United States of America", uk: "United Kingdom", "DR Congo": "Dem. Rep. Congo", "Ivory Coast": "Côte d'Ivoire", "Czech Republic": "Czechia", Bosnia: "Bosnia and Herz.", "the Netherlands": "Netherlands", "Saint Kitts and Nevis": "St. Kitts and Nevis", Niger: "Niger", Sudan: "Sudan", india: "India" };
  for (const [ask, name] of Object.entries(cases)) assert.equal(findCountry(world, ask)?.name, name, ask);
  assert.equal(findCountry(world, "Atlantis"), null);
});

test("views zoom to countries without far-away territories, at 16:9", () => {
  const [, , w, h] = viewFor({ focus: "France" }, world);
  assert.ok(Math.abs(w / h - 16 / 9) < 0.01);
  const [x0] = project(-6, 46), [x1] = project(10, 46);
  const v = viewFor({ focus: "France" }, world);
  assert.ok(v[0] <= x0 && v[0] + v[2] >= x1 && v[2] < 300, `France view ${v}`); // not French Guiana
  assert.deepEqual(viewFor({ view: "world" }, world), [0, 0, 1920, 1080]);
  // Fit to what's drawn when no view is given.
  const fit = viewFor({ places: [{ lon: 139.7, lat: 35.7 }, { lon: 135.5, lat: 34.7 }] }, world);
  const [tx, ty] = project(139.7, 35.7);
  assert.ok(tx > fit[0] && tx < fit[0] + fit[2] && ty > fit[1] && ty < fit[1] + fit[3] && fit[2] < 200);
});

test("map lines parse as board actions with ids", () => {
  const out = [];
  const p = createTutorParser((a) => out.push(a));
  p.feed('map#m1: {"focus":"Japan","places":[{"id":"tokyo","lon":139.7,"lat":35.7,"label":"Tokyo"}]}\ngeo: {"view":"world"}\nend: wait\n');
  p.end();
  assert.equal(out[0].type, "map");
  assert.equal(out[0].id, "m1");
  assert.equal(out[0].data.places[0].id, "tokyo");
  assert.equal(out[1].type, "map");
  assert.match(TUTOR_SYSTEM, /# Maps/);
  assert.match(TUTOR_SYSTEM, /LONGITUDE FIRST/);
  assert.match(TUTOR_SYSTEM, /{zoom:m1.india}/);
  assert.match(TUTOR_SYSTEM, /{trace:m1.silk}/);
  assert.match(TUTOR_SYSTEM, /"update":true/);
});

test("maps zoom in and out, update in place and trace routes on the board", { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-map-report-"));
  const report = path.join(dir, "report.json");
  const electron = createRequire(import.meta.url)("electron");
  const fixture = fileURLToPath(new URL("fixtures/study-map.mjs", import.meta.url));
  try {
    try { await promisify(execFile)(electron, [fixture, report], { timeout: 75000, windowsHide: true }); } catch {}
    assert.ok(fs.existsSync(report), "Map test did not report");
    const r = JSON.parse(fs.readFileSync(report, "utf8"));
    assert.equal(r.error, undefined, r.error);
    const { world: m, update: u, trace: t } = r;
    for (const k of ["land", "delhiInIndia", "londonHidden", "mover", "revealed", "londonShown", "zoomIn", "zoomCountry"]) assert.equal(m[k], true, k);
    assert.equal(m.countries, 2);
    assert.equal(m.viewWorld, "0 0 1920 1080");
    // Zooming in passes through intermediate views and ends close in...
    assert.ok(m.zoomLog.some((w) => w > 400 && w < 1500) && m.zoomLog.at(-1) < 400, m.zoomLog.join(" "));
    assert.ok(m.japanWidth < 300, `Japan ${m.japanWidth}`);
    // ...and back out to the map's own view.
    assert.equal(m.backOut, "0 0 1920 1080");
    // Labels keep their size on screen at any zoom.
    assert.ok(Math.abs(m.labelZoomed - m.labelWorld) <= 3, `${m.labelWorld} vs ${m.labelZoomed}`);
    assert.deepEqual(u, { keptDelhi: true, keptLondonShown: true, zoomed: true, addedMumbai: true, stillDelhi: true, maps: 1 });
    // A crowded map moves in so its places are clear, labels apart.
    assert.equal(r.crowd.zoomedIn, true);
    assert.equal(r.crowd.overlaps, 0, JSON.stringify(r.crowd));
    assert.equal(r.crowd.keptChosenWorld, true);
    // Revealing something outside the view widens the view to include it.
    assert.deepEqual(r.frame, { londonOffAtStart: true, inViewRevealStays: true, londonInView: true, bostonStillInView: true, pointInViewStays: true });
    assert.deepEqual(t, { waiting: true, midDrawn: true, baghLit: true, xianNotYet: true, resumed: true, done: true, xianLit: true, followMoved: true, greatCircleNorth: true });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("specific bounds win over a general world view", () => {
  const v = viewFor({ view: "world", bounds: [-10, 15, 125, 55] }, world);
  assert.ok(v[2] < 1920 * 0.8, `view ${v}`);
  const [x] = project(108.9, 34.3); // Chang'an is in it
  assert.ok(x > v[0] && x < v[0] + v[2]);
});

test("view-only updates keep the map, update:true adds, a new list replaces", async () => {
  const { mergeSpec, greatCircle } = await import("../app/js/study/map.js");
  const first = { view: "world", places: [{ id: "a", lon: 1, lat: 1 }], caption: "x" };
  assert.deepEqual(mergeSpec(first, { focus: "India" }), { places: first.places, caption: "x", focus: "India" });
  assert.deepEqual(mergeSpec(first, { update: true, places: [{ id: "b", lon: 2, lat: 2 }, { id: "a", lon: 3, lat: 3 }] }).places.map((p) => [p.id, p.lon]), [["b", 2], ["a", 3]]);
  assert.deepEqual(mergeSpec(first, { places: [{ id: "c", lon: 0, lat: 0 }] }).places.map((p) => p.id), ["c"]);
  // New York to London: the great circle goes further north than either end.
  const gc = greatCircle([-74, 40.7], [-0.13, 51.5]);
  assert.ok(Math.max(...gc.map((p) => p[1])) > 52);
  // Tokyo to San Francisco crosses the antimeridian without a jump.
  const pac = greatCircle([139.7, 35.7], [-122.4, 37.8]);
  assert.ok(pac.every((p, i) => !i || Math.abs(p[0] - pac[i - 1][0]) < 20));
});
