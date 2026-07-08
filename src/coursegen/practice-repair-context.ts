import { readFileSync } from 'node:fs';

/** Adaptive generation target; repair should not balloon past this without a rewrite. */
export const LARGE_PRACTICE_FILE_LINES = 450;

export type PracticeRepairSectionHint = {
  category: string;
  lines: number[];
};

const SECTION_SCANNERS: Array<{ category: string; patterns: RegExp[] }> = [
  {
    category: 'click/tap handlers and selection state',
    patterns: [
      /onclick\s*=/,
      /addEventListener\s*\(\s*['"]click/,
      /handleSlotClick/,
      /handleRowClick/,
      /ready-to-place/,
      /selectedChip/
    ]
  },
  {
    category: 'slot markers and drop targets',
    patterns: [/target-slot/, /drop-zone/, /placement-marker/, /dashed/, /data-drop-target/]
  },
  {
    category: 'mobile and responsive layout',
    patterns: [
      /@media/,
      /row-connector/,
      /number-line-svg/,
      /clamp\s*\(/,
      /content-area/,
      /interaction-panel/,
      /visual-panel/,
      /instruction-band/,
      /top-header/
    ]
  },
  {
    category: 'mobile page flow and current item render',
    patterns: [
      /current(?:Mobile)?(?:Question|Step|Index|Item)/,
      /render(?:Mobile|Current|Question|Step)/,
      /question-card/,
      /step-card/,
      /progress-dots/,
      /check(?:Answer|Btn|Button)/,
      /next(?:Question|Step|Btn|Button)/
    ]
  },
  {
    category: 'chip pool and placement DOM',
    patterns: [/chips-pool/, /placed-chips/, /integer-chip/, /renderRows/]
  }
];

export function countPracticeFileLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

export function compressLineHits(hits: number[], maxHits = 6): number[] {
  const unique = [...new Set(hits)].sort((a, b) => a - b);
  if (unique.length <= maxHits) return unique;
  const step = Math.ceil(unique.length / maxHits);
  const result: number[] = [];
  for (let i = 0; i < unique.length; i += step) {
    result.push(unique[i]!);
  }
  return result;
}

export function scanPracticeRepairHints(content: string): {
  lineCount: number;
  hints: PracticeRepairSectionHint[];
} {
  const lines = content.split('\n');
  const lineCount = lines.length;
  const hints: PracticeRepairSectionHint[] = [];

  for (const scanner of SECTION_SCANNERS) {
    const hitLines: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (scanner.patterns.some(pattern => pattern.test(lines[i]!))) {
        hitLines.push(i + 1);
      }
    }
    if (hitLines.length > 0) {
      hints.push({
        category: scanner.category,
        lines: compressLineHits(hitLines)
      });
    }
  }

  return { lineCount, hints };
}

export function formatPracticeRepairContext(htmlPath: string, maxTurns: number): string {
  let content: string;
  try {
    content = readFileSync(htmlPath, 'utf8');
  } catch {
    return '';
  }

  const { lineCount, hints } = scanPracticeRepairHints(content);
  const firstEditByTurn = Math.min(3, maxTurns);
  const lines = [
    '--- repair workflow (mandatory) ---',
    `Turn budget: ${maxTurns}. Fix only the QA findings above — no unrelated refactors.`,
    `File size: ${lineCount} lines.`,
    lineCount > LARGE_PRACTICE_FILE_LINES
      ? 'Do NOT read the entire file. Use read with start_line and limit on the regions below.'
      : 'Prefer targeted read ranges; avoid reading the whole file unless it is under 400 lines.',
    `Use at most 2 read calls before your first edits call. First edits must happen by turn ${firstEditByTurn}.`,
    'Patch the smallest code regions that fix the findings. Never rewrite all CSS or all script logic.',
    'Exception: phone/mobile page-flow repairs may add or repair a focused mobile-only render/state branch while keeping desktop behavior intact.',
    'After edits succeed, stop. Do not re-read the full file to polish.'
  ];

  if (hints.length > 0) {
    lines.push('', '--- likely edit regions (1-based line numbers) ---');
    for (const hint of hints) {
      lines.push(`- ${hint.category}: lines ${hint.lines.join(', ')}`);
    }
  }

  return lines.join('\n');
}
