# World map basemap (Natural Earth)

Bundled asset copied into every video generation workspace:

```text
assets/world-basemap.svg
```

- **Source:** Natural Earth 110m land (public domain)
- **viewBox:** `0 0 1920 1080`
- **Projection:** equirectangular via d3 `geoEquirectangular().fitExtent`, latitude clipped to -58°..84°, padding 48px left/right, 36px top, 72px bottom
- **Aspect lock:** equal degrees-per-pixel for longitude and latitude; the map is vertically centered in the padded frame (not stretch-to-fill latitude)

## Usage in HTML

1. Use `assets/world-basemap.svg` as the map background (`<image href="assets/world-basemap.svg" x="0" y="0" width="1920" height="1080"/>` inside your stage SVG).
2. Place markers, arcs, heat circles, and labels in the **same** 1920×1080 SVG coordinate system.
3. **Never** invent freehand continent, country, coastline, or border polygons when this asset is available.

## Country / region close-ups

Do **not** redraw countries as simplified blobs. Zoom the basemap:

1. Keep the full-world `<image … width="1920" height="1080"/>`.
2. Set the parent SVG `viewBox` from lon/lat bounds via `viewBoxForBounds` (pad ~0.5–2° so neighbors stay visible).
3. City/hazard positions still use `projectLonLat` — they stay correct under viewBox zoom.
4. **Never** bake marker pixel coordinates into static SVG attributes (`cx`/`cy`, `transform="translate(...)"`). At runtime: `const p = projectLonLat(lon, lat); element.setAttribute('transform', \`translate(\${p.x},\${p.y})\`)`.

Does not support bounds that cross the antimeridian (±180°); split or pad within one hemisphere.

110m is a world-scale coastline: at extreme zoom small countries look a bit coarse, but real Natural Earth geometry always beats freehand outlines.

## CRITICAL: longitude first, then latitude

Arguments are always **longitude, then latitude** (eastings, northings). Never pass `(lat, lon)`.

Swapping India bounds `(68, 8, 97, 35)` → `(8, 68, 35, 97)` zooms to Africa (longitude 8–35°) instead of India. The helpers auto-correct swapped lon/lat when latitude values exceed ±90° and longitude values do not.

## Lon/lat → pixel (matches the bundled SVG)

Verify helpers against the bundled SVG; do not invent pixel coordinates.

```javascript
function projectLonLat(lon, lat) {
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lon, lat] = [lat, lon];
  const W = 1920;
  const H = 1080;
  const padL = 48;
  const padT = 36;
  const padR = 48;
  const padB = 72;
  const lonMin = -180;
  const lonMax = 180;
  const latMin = -58;
  const latMax = 84;
  // Same °/px as bundled SVG (d3 fitExtent aspect lock — NOT stretch-to-fill lat).
  const scale = (W - padL - padR) / (lonMax - lonMin);
  const mapH = (latMax - latMin) * scale;
  const y0 = padT + ((H - padT - padB) - mapH) / 2;
  const x = padL + (lon - lonMin) * scale;
  const y = y0 + (latMax - lat) * scale;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function viewBoxForBounds(lonMin, latMin, lonMax, latMax) {
  if ((Math.abs(latMin) > 90 || Math.abs(latMax) > 90) && Math.abs(lonMin) <= 90 && Math.abs(lonMax) <= 90) {
    [lonMin, latMin, lonMax, latMax] = [latMin, lonMin, latMax, lonMax];
  }
  if (lonMin > lonMax) [lonMin, lonMax] = [lonMax, lonMin];
  if (latMin > latMax) [latMin, latMax] = [latMax, latMin];
  const sw = projectLonLat(lonMin, latMin);
  const ne = projectLonLat(lonMax, latMax);
  const w = Math.round((ne.x - sw.x) * 10) / 10;
  const h = Math.round((sw.y - ne.y) * 10) / 10;
  return `${sw.x} ${ne.y} ${w} ${h}`;
}

// viewBoxForBounds(lonMin, latMin, lonMax, latMax)
```

## Script cues

In `V:` lines, include lon/lat bounds and city coordinates (longitude first) — not vague region names alone. Describe the map as: “Use bundled `assets/world-basemap.svg` as background; zoom viewBox to …; plot nodes at …” — do **not** use getimg/getmap directives for basemaps, and do **not** invent country outlines.
