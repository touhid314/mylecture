import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function stripInlineComment(value: string) {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && quote === null) {
      return value.slice(0, index);
    }
  }
  return value;
}

export function loadEnv(rootDir: string) {
  const envPath = path.resolve(rootDir, '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let val = stripInlineComment(match[2]).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}
