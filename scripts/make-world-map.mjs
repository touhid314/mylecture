// Builds app/assets/world-map.json for the tutor's map command: every
// country's outline, in the projection of the video agent's basemap
// (electron/assets/world-basemap.svg), so maps from both line up.
//   node scripts/make-world-map.mjs <path to world-atlas countries-50m.json>
// Data: Natural Earth (public domain), via the world-atlas package (ISC).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2];
if (!src) throw new Error("Usage: node scripts/make-world-map.mjs countries-50m.json");

// Same projection as the bundled basemap (see world-map-basemap.md).
const W = 1920, H = 1080, padL = 48, padT = 36, padR = 48, padB = 72, latMin = -58, latMax = 84;
const scale = (W - padL - padR) / 360;
const y0 = padT + ((H - padT - padB) - (latMax - latMin) * scale) / 2;
const px = (lon, lat) => [padL + (lon + 180) * scale, y0 + (latMax - lat) * scale];

const topo = JSON.parse(fs.readFileSync(src, "utf8"));
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
// Delta-decoded, dequantized arcs in lon/lat.
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
});
const ring = (ids) => {
  const pts = [];
  for (const id of ids) {
    const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
    pts.push(...(pts.length ? a.slice(1) : a));
  }
  return pts;
};
const r1 = (v) => Math.round(v * 10) / 10;

// Ring longitudes made continuous across the antimeridian (for areas,
// centres and boxes; drawing uses the raw ones).
const unwrap = (pts) => {
  let off = 0;
  return pts.map(([lon, lat], i) => {
    if (i) {
      const d = lon + off - (pts[i - 1][0] + off);
      if (d > 180) off -= 360;
      else if (d < -180) off += 360;
    }
    return [lon + off, lat];
  });
};
const ringArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return a / 2;
};
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

// Rings that cross the antimeridian are drawn unbroken (longitudes made
// continuous), plus a copy shifted by 360 degrees, so the part past the edge
// shows on the other side; the map clips everything to its extent.
// Latitudes below the map's range are kept and clipped, not flattened.
function drawPath(polygons) {
  let d = "";
  const draw = (pts, shift) => {
    pts.forEach(([lon, lat], i) => {
      const [x, y] = px(lon + shift, lat);
      d += (i ? "L" : "M") + r1(x) + "," + r1(y);
    });
    d += "Z";
  };
  for (const poly of polygons) for (const ids of poly) {
    const pts = unwrap(ring(ids));
    draw(pts, 0);
    const lo = Math.min(...pts.map((p) => p[0])), hi = Math.max(...pts.map((p) => p[0]));
    if (hi > 180) draw(pts, -360);
    if (lo < -180) draw(pts, 360);
  }
  return d;
}

// The country's main pieces (at least 20% of its largest): what to zoom to
// and where to put the label, without far-away islands and territories.
function geometryInfo(polygons) {
  const outers = polygons.map((p) => unwrap(ring(p[0]))).map((pts) => ({ pts, area: Math.abs(ringArea(pts)) }));
  const biggest = Math.max(...outers.map((o) => o.area));
  const main = outers.filter((o) => o.area >= biggest * 0.2);
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const o of main) for (const [lon, lat] of o.pts) {
    if (lat < latMin) continue;
    box[0] = Math.min(box[0], lon); box[1] = Math.min(box[1], lat);
    box[2] = Math.max(box[2], lon); box[3] = Math.max(box[3], lat);
  }
  // Area-weighted centroid of the largest piece.
  const pts = outers.reduce((a, b) => (b.area > a.area ? b : a)).pts;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const c = x1 * y2 - x2 * y1;
    a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const center = Math.abs(a) > 1e-9 ? [r2(wrap(cx / (3 * a))), r2(cy / (3 * a))] : [r2(wrap((box[0] + box[2]) / 2)), r2((box[1] + box[3]) / 2)];
  // Boxes past ±180° can't be shown on this map: clamp them.
  return { box: [r2(Math.max(-180, box[0])), r2(box[1]), r2(Math.min(180, box[2])), r2(box[3])], center };
}

function polygonsOf(geom) {
  return geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
}

const countries = [];
for (const g of topo.objects.countries.geometries) {
  const name = g.properties?.name;
  const polys = polygonsOf(g);
  if (!name || !polys.length) continue;
  countries.push({ name, id: g.id || "", d: drawPath(polys), ...geometryInfo(polys) });
}
countries.sort((a, b) => a.name.localeCompare(b.name));

// Land is drawn from the countries themselves (same data as the borders, so
// coastlines and borders match); the projection is the basemap's.
const out = { source: "Natural Earth 1:50m countries (public domain) via world-atlas (ISC); projection of electron/assets/world-basemap.svg", width: W, height: H, projection: { padL, padT, padR, padB, latMin, latMax }, countries };
const file = path.join(root, "app", "assets", "world-map.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${countries.length} countries, ${(fs.statSync(file).size / 1024).toFixed(0)} KB -> ${path.relative(root, file)}`);
