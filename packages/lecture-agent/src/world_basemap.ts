import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, '..');
const bundledBasemapPath = path.join(packageRoot, 'assets', 'world-basemap.svg');

export const WORLD_BASEMAP_RELATIVE_PATH = 'assets/world-basemap.svg';

/** Copy the bundled Natural Earth basemap into a generation workspace. */
export function ensureWorldBasemapInWorkspace(workspaceDir: string): string {
    if (!fs.existsSync(bundledBasemapPath)) {
        throw new Error(`Bundled world basemap missing: ${bundledBasemapPath}`);
    }
    const destination = path.join(workspaceDir, WORLD_BASEMAP_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(bundledBasemapPath, destination);
    return WORLD_BASEMAP_RELATIVE_PATH;
}

/** Asset manifest line for the animator when video generation runs. */
export function formatWorldBasemapDescription(relativePath: string = WORLD_BASEMAP_RELATIVE_PATH): string {
    return [
        `- ${relativePath}: Natural Earth 110m land basemap (public domain), 1920x1080 SVG.`,
        '  Required background for world/region/country maps. Overlay markers/arcs/labels only.',
        '  Never invent freehand continent, country, coastline, or border polygons.',
        '  Country close-ups: zoom via SVG viewBox from lon/lat bounds — do not redraw the country.',
        '  See .agents/mylecture-visuals/world-map-basemap.md for lon/lat → pixel and viewBox helpers.',
    ].join('\n');
}
