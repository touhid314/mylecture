# World map basemap (Natural Earth)

Bundled asset copied into every video generation workspace:

```text
assets/world-basemap.svg
```

- **Source:** Natural Earth 110m land (public domain)
- **viewBox:** `0 0 1920 1080`
- **Projection:** equirectangular, latitude clipped to -58°..84°, padding 48px left/right, 36px top, 72px bottom

## Usage in HTML

1. Use `assets/world-basemap.svg` as the map background (`<image href="assets/world-basemap.svg" x="0" y="0" width="1920" height="1080"/>` inside your stage SVG).
2. Place markers, arcs, heat circles, and labels in the **same** 1920×1080 SVG coordinate system.
3. **Never** invent freehand continent, country, coastline, or border polygons when this asset is available.

## Country / region close-ups

Do **not** redraw Croatia, Taiwan, etc. as simplified blobs. Zoom the basemap:

1. Keep the full-world `<image … width="1920" height="1080"/>`.
2. Set the parent SVG `viewBox` from lon/lat bounds via `viewBoxForBounds` (pad ~0.5–2° so neighbors stay visible).
3. City/hazard positions still use `projectLonLat` — they stay correct under viewBox zoom.

110m is a world-scale coastline: at extreme zoom small countries look a bit coarse, but real Natural Earth geometry always beats freehand outlines.

## Lon/lat → pixel (matches the bundled SVG)

```javascript
function projectLonLat(lon, lat) {
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
  const x = padL + ((lon - lonMin) / (lonMax - lonMin)) * (W - padL - padR);
  const y = padT + ((latMax - lat) / (latMax - latMin)) * (H - padT - padB);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

function viewBoxForBounds(lonMin, latMin, lonMax, latMax) {
  const sw = projectLonLat(lonMin, latMin);
  const ne = projectLonLat(lonMax, latMax);
  return `${sw.x} ${ne.y} ${ne.x - sw.x} ${sw.y - ne.y}`;
}

// Croatia example: viewBoxForBounds(13.0, 42.0, 20.5, 47.0)
```

Example cities (approximate):

| Place   | lon   | lat  | x (px) | y (px) |
|---------|-------|------|--------|--------|
| Taiwan  | 121.0 | 23.7 | 1573   | 468    |
| Hungary | 19.5  | 47.2 | 1059   | 349    |
| Lebanon | 35.5  | 33.9 | 1140   | 416    |

## Script cues

In `V:` lines, describe the map as: “Use bundled `assets/world-basemap.svg` as background; zoom viewBox to …; plot nodes at …” — do **not** use getimg/getmap directives for basemaps, and do **not** invent country outlines.
