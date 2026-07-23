import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { downloadImage } from '../tools/getimg.js';
import { safeRelativeFile } from './shared.js';

export type AssetDescription = {
    prompt: string;
    path: string;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number;
};

const NAMED_GETIMG_PATTERN = /\[\(getimg:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*out:\s*(?:'([^']*)'|"([^"]*)")\s*\)\]/gi;
const LEGACY_GETIMG_PATTERN = /\[\(getimg:\s*(?:'([^']*)'|"([^"]*)")\s*\)\]/gi;

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
}

export function collectImageRequests(script: string): Array<{ prompt: string; path: string }> {
    const requests: Array<{ prompt: string; path: string }> = [];
    const occupied = new Set<string>();

    for (const match of script.matchAll(NAMED_GETIMG_PATTERN)) {
        const prompt = (match[1] || match[2]).trim();
        const relativePath = safeRelativeFile(match[3] || match[4]);
        const key = relativePath.toLowerCase();
        if (occupied.has(key)) throw new Error(`Duplicate requested asset filename: ${relativePath}`);
        occupied.add(key);
        requests.push({ prompt, path: relativePath });
    }

    // Backward compatibility with the current prompt's original short form.
    for (const match of script.matchAll(LEGACY_GETIMG_PATTERN)) {
        const prompt = (match[1] || match[2]).trim();
        const base = slug(prompt);
        let relativePath = `assets/${base}.png`;
        let suffix = 2;
        while (occupied.has(relativePath.toLowerCase())) relativePath = `assets/${base}-${suffix++}.png`;
        occupied.add(relativePath.toLowerCase());
        requests.push({ prompt, path: relativePath });
    }
    return requests;
}

export function stripImageRequests(script: string): string {
    return script
        .replace(NAMED_GETIMG_PATTERN, '[Use a code-drawn visual; external images are disabled.]')
        .replace(LEGACY_GETIMG_PATTERN, '[Use a code-drawn visual; external images are disabled.]');
}

export async function fetchAssets(script: string, workspaceDir: string): Promise<AssetDescription[]> {
    const descriptions: AssetDescription[] = [];
    for (const request of collectImageRequests(script)) {
        const absolutePath = path.resolve(workspaceDir, request.path);
        const workspaceRoot = path.resolve(workspaceDir);
        if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspaceRoot + path.sep)) {
            throw new Error(`Asset path escapes workspace: ${request.path}`);
        }
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        await downloadImage({
            prompt: request.prompt,
            mode: 'search',
            out: absolutePath,
            watchman: false
        });
        const metadata = await sharp(absolutePath).metadata();
        descriptions.push({
            prompt: request.prompt,
            path: request.path.replaceAll('\\', '/'),
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            format: metadata.format ?? null,
            bytes: fs.statSync(absolutePath).size
        });
    }
    return descriptions;
}

export function formatAssetDescriptions(assets: AssetDescription[]): string {
    if (assets.length === 0) return 'No external image assets were requested by the script.';
    return assets.map(asset =>
        `- ${asset.path}: ${asset.width || '?'}x${asset.height || '?'} ${asset.format || 'image'}, ${asset.bytes} bytes; requested as "${asset.prompt}"`
    ).join('\n');
}
