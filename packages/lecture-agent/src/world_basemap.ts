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
        '  Use as the geographic background for world/region supply-chain maps.',
        '  Overlay markers, arcs, and labels in SVG/HTML on top — never invent freehand continent polygons.',
        '  See .agents/mylecture-visuals/world-map-basemap.md for lon/lat → pixel projection.',
    ].join('\n');
}
