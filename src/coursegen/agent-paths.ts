import { existsSync } from 'node:fs';
import path from 'node:path';
import { rootDir } from './paths.ts';

/** Sibling mylecture-agent checkout (agent split from packages/lecture-agent). */
export function getAgentRoot() {
  return path.resolve(rootDir, '..', 'mylecture-agent');
}

export function resolveAgentSrc(...parts: string[]) {
  return path.join(getAgentRoot(), 'src', ...parts);
}

export function requireAgentFile(...parts: string[]) {
  const filePath = resolveAgentSrc(...parts);
  if (!existsSync(filePath)) {
    throw new Error(
      `MyLecture Agent file not found at ${filePath}. ` +
        `Expected sibling checkout at ${getAgentRoot()}.`
    );
  }
  return filePath;
}
