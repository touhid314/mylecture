# World map basemap (Natural Earth)

Bundled asset copied into every video generation workspace:

```text
assets/world-basemap.svg
```

- **Source:** Natural Earth 110m land (public domain)
- **viewBox:** `0 0 1920 1080`
- **Projection:** equirectangular, latitude clipped to -58°..84°, padding 48px left/right, 36px top, 72px bottom

## Usage in HTML

1. Use `assets/world-basemap.svg` as the map background (inline `<image href="assets/world-basemap.svg">` inside your stage SVG, or embed the `#world-land` path from the file).
2. Place supply-chain nodes and arcs in the **same** SVG coordinate system (1920×1080).
3. **Never** draw freehand continent polygons when this asset is available.

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
```

Example cities (approximate):

| Place   | lon   | lat  | x (px) | y (px) |
|---------|-------|------|--------|--------|
| Taiwan  | 121.0 | 23.7 | 1573   | 468    |
| Hungary | 19.5  | 47.2 | 1059   | 349    |
| Lebanon | 35.5  | 33.9 | 1140   | 416    |

## Script cues

In `V:` lines, describe the map as: “Use bundled `assets/world-basemap.svg` as background; plot nodes at …” — do **not** use getimg/getmap directives for basemaps.
