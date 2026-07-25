import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { LLM_Model } from '../../packages/lecture-agent/src/utils/llm_model.ts';
import { tryResolveReviewModel } from './models.ts';
import { isIndexHtmlName } from './paths.ts';
import type { Audience, LearningIntent } from './types.ts';

const PROMPTS_DIR = path.join(import.meta.dirname, 'prompts');

export type ScriptReviewResult = {
  passed: boolean;
  findings: string[];
};

function loadScriptRubricPrompt() {
  return readFileSync(path.join(PROMPTS_DIR, 'script-rubric.md'), 'utf8').trim();
}

function isScriptFileName(name: string) {
  return /^script\d*\.md$/i.test(name);
}

/**
 * Collect the narration script for a generated lecture folder. Prefers the
 * script*.md files the agent writes; falls back to raw index*.html so the
 * reviewer can still read narration strings when scripts are missing.
 */
export function collectScriptText(folderPath: string): { source: 'script' | 'html'; text: string } | null {
  if (!existsSync(folderPath)) return null;
  const entries = readdirSync(folderPath);

  const scriptFiles = entries
    .filter(name => isScriptFileName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (scriptFiles.length > 0) {
    const text = scriptFiles
      .map(name => `--- ${name} ---\n${readFileSync(path.join(folderPath, name), 'utf8').trim()}`)
      .join('\n\n');
    return { source: 'script', text };
  }

  const indexFiles = entries
    .filter(name => isIndexHtmlName(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (indexFiles.length === 0) return null;
  const text = indexFiles
    .map(name => `--- ${name} ---\n${readFileSync(path.join(folderPath, name), 'utf8')}`)
    .join('\n\n');
  return { source: 'html', text };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(unfenced);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Try extracting the first JSON object below.
  }

  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(unfenced.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeScriptReviewResponse(raw: unknown): ScriptReviewResult {
  let result: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    result = parseJsonObject(raw);
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    result = raw as Record<string, unknown>;
  }

  if (!result) {
    return { passed: false, findings: ['Script rubric returned invalid JSON'] };
  }

  const passed = Boolean(result.passed);
  const findings = Array.isArray(result.findings)
    ? result.findings.map(item => String(item).trim()).filter(Boolean)
    : [];
  if (!passed && findings.length === 0) {
    findings.push('Script review failed with no specific findings');
  }
  return { passed, findings };
}

export async function reviewScriptWithRubric(options: {
  folderPath: string;
  objective: string;
  audience: Audience;
  intent: LearningIntent;
  durationMinutes: number;
  courseContext?: string;
  sourceContext?: string;
  model?: string;
}): Promise<ScriptReviewResult> {
  const collected = collectScriptText(options.folderPath);
  if (!collected) {
    return { passed: false, findings: ['No script*.md or index*.html found to review'] };
  }

  const model = tryResolveReviewModel(options.model);
  if (!model) {
    throw new Error(
      'No model configured for script review (set COURSEGEN_REVIEW_MODEL or AGENT_MODEL, or pass --model).'
    );
  }

  const llm = new LLM_Model(model, loadScriptRubricPrompt(), null, true);

  const userPrompt = [
    `Learning objective: ${options.objective}`,
    `Audience level: ${options.audience}`,
    `Learning intent: ${options.intent}`,
    `Target duration: ${options.durationMinutes} minutes`,
    options.courseContext ? `Course context:\n${options.courseContext}` : '',
    collected.source === 'html'
      ? 'Note: no script.md was found; the narration below is embedded in raw HTML. Review only the narration text values.'
      : '',
    options.sourceContext
      ? `\n--- source material (authority) ---\n${options.sourceContext}`
      : '',
    '',
    '--- narration script ---',
    collected.text
  ].filter(Boolean).join('\n');

  const raw = await llm.generate(userPrompt, null, null, null, null, true, false);
  return normalizeScriptReviewResponse(raw);
}

export function buildScriptRepairMessage(options: {
  objective: string;
  findings: string[];
  grounded?: boolean;
}) {
  const lines = [
    'A narration-quality review of this lecture found that the script reads like a textbook summary instead of a teacher guiding a learner. Revise the narration to fix the findings below.',
    `Learning objective: ${options.objective}`,
    '',
    '--- findings to fix ---',
    ...options.findings.map(finding => `- ${finding}`),
    '',
    'Rules for the revision:',
    '- Update BOTH the script*.md files and the matching narration strings inside every index*.html video plan, keeping them consistent with each other.',
    '- Keep the same visuals, scene structure, segment ids, and audio file names. Change narration text only, unless a finding explicitly requires a small visual timing tweak.',
    '- Keep total narration word count close to the original (about 150 words per minute of video).',
    '- Keep the rigor and terminology level of the original; fix cadence, motivation, and engagement, not the content depth.',
    '- Do not add filler enthusiasm or decorative anecdotes; every revised beat must still serve the learning objective.'
  ];

  if (options.grounded) {
    lines.push(
      '- Stay consistent with the source grounding already in this lecture: follow source facts, definitions, and notation; do not copy source sentences; keep your own teaching arc rather than walking the source section-by-section.'
    );
  }

  return lines.join('\n');
}
