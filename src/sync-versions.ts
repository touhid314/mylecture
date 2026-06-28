/**
 * sync-versions.ts
 * Summer 2026, Touhidul Islam
 *
 * Keeps version constants/contracts synchronized across the repository.
 * Reads the latest configuration from versions.json and propagates the
 * correct contract and IDE version numbers to all downstream codebases
 * and contract documentation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Read versions.json
const versionsPath = path.join(rootDir, 'versions.json');
if (!fs.existsSync(versionsPath)) {
  console.error(`Error: versions.json not found at ${versionsPath}`);
  process.exit(1);
}

const { contractVersion, ideVersion } = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
console.log(`Syncing versions... Contract Version: ${contractVersion}, IDE Version: ${ideVersion}`);

// Helper to replace content if it changed
function updateFile(filePath: string, transform: (content: string) => string) {
  const absolutePath = path.resolve(rootDir, filePath);
  if (!fs.existsSync(absolutePath)) {
    console.warn(`Warning: File not found: ${absolutePath}`);
    return;
  }
  const original = fs.readFileSync(absolutePath, 'utf8');
  const updated = transform(original);
  if (original !== updated) {
    fs.writeFileSync(absolutePath, updated, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

// 2. Update packages/lecture-viewer/src/player/index.ts
updateFile('packages/lecture-viewer/src/player/index.ts', content => {
  return content.replace(
    /export const lectureViewerVersion = ['"][^'"]+['"];/,
    `export const lectureViewerVersion = '${ideVersion}';`
  );
});

// 3. Update packages/lecture-viewer/package.json
updateFile('packages/lecture-viewer/package.json', content => {
  const pkg = JSON.parse(content);
  pkg.version = `${ideVersion}.0`;
  return JSON.stringify(pkg, null, 2) + '\n';
});

// 4. Update packages/lecture-agent/src/validate_contract.cjs
updateFile('packages/lecture-agent/src/validate_contract.cjs', content => {
  return content.replace(
    /must be a valid version like '[^']+'/,
    `must be a valid version like '${contractVersion}'`
  );
});

// 5. Update packages/lecture-agent/.agents/mylecture-contracts/html-input-contract.md
updateFile('packages/lecture-agent/.agents/mylecture-contracts/html-input-contract.md', content => {
  return content.replace(
    /^# HTML Input Contract - v\d+\.\d+/m,
    `# HTML Input Contract - v${contractVersion}`
  );
});

console.log('Version synchronization complete!');
