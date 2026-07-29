/**
 * Build assets/world-basemap.svg from Natural Earth 110m (public domain).
 * Run: node scripts/build-world-basemap.mjs
 */
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import * as topojson from 'topojson-client';
import { geoEquirectangular, geoPath } from 'd3-geo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const W = 1920;
const H = 1080;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

const topology = await fetchJson('https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json');
const land = topojson.feature(topology, topology.objects.land);

const projection = geoEquirectangular().fitExtent(
  [[48, 36], [W - 48, H - 72]],
  {
    type: 'Polygon',
    coordinates: [[[-180, -58], [180, -58], [180, 84], [-180, 84], [-180, -58]]],
  }
);

const landPath = geoPath(projection)(land).replace(/(\d+\.\d{1,2})\d+/g, '$1');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Natural Earth 110m land (public domain). Projection: equirectangular, lat -58..84, padding 48/36/48/72. -->
  <rect width="${W}" height="${H}" fill="#0e1014"/>
  <path id="world-land" fill="#3d4654" stroke="#8b9aab" stroke-width="1.4" stroke-linejoin="round" paint-order="stroke fill" d="${landPath}"/>
</svg>
`;

const outPath = path.join(__dirname, '..', 'assets', 'world-basemap.svg');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, svg);
console.log('Wrote', outPath, 'bytes', fs.statSync(outPath).size);
