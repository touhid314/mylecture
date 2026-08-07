import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { EditorAgent } from "../../packages/lecture-agent/src/editor-agent/coding_agent.ts";
import { LLM_Model } from "../../packages/lecture-agent/src/utils/llm_model.ts";
import {
  matchVideoPlanConstBlock,
  matchVideoPlanInlineBlock,
} from "../visual-edit-protect.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const RUBRIC_PATH = path.join(repoRoot, "src/coursegen/prompts/script-rubric.md");

export type ScriptReviewMeta = {
  passed: boolean;
  findings: string[];
  repaired: boolean;
  skipped?: boolean;
  initialFindings?: string[];
};

export function isScriptReviewEnabled(): boolean {
  const raw = process.env.VIDEO_SCRIPT_REVIEW?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return true;
}

function resolveReviewModel(model: string): string {
  return process.env.VIDEO_REVIEW_MODEL?.trim() || model;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(unfenced);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(unfenced.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

type NarrationPlanSegment = { text?: string; narration?: string };

function parseVideoPlanBlock(block: string): NarrationPlanSegment[] | null {
  const arrayStart = block.indexOf("[");
  const arrayEnd = block.lastIndexOf("]");
  if (arrayStart < 0 || arrayEnd <= arrayStart) return null;

  try {
    // Evaluate only the balanced array literal, never the surrounding generated page.
    const plan = vm.runInNewContext(
      `(${block.slice(arrayStart, arrayEnd + 1)})`,
      Object.create(null),
      { timeout: 100 },
    );
    return Array.isArray(plan) ? (plan as NarrationPlanSegment[]) : null;
  } catch {
    return null;
  }
}

function readVideoPlanFromHtml(html: string): NarrationPlanSegment[] | null {
  const block = matchVideoPlanInlineBlock(html) ?? matchVideoPlanConstBlock(html);
  return block ? parseVideoPlanBlock(block) : null;
}

function narrationLinesFromPlan(plan: NarrationPlanSegment[]): string[] {
  const segments: string[] = [];
  for (const segment of plan) {
    // Contract field is `text` (see html-input-contract.md); accept legacy `narration` too.
    const line = segment?.text?.trim() || segment?.narration?.trim();
    if (line) segments.push(line);
  }
  return segments;
}

export function extractNarrationScript(html: string): string | null {
  const plan = readVideoPlanFromHtml(html);
  if (!plan) return null;
  const segments = narrationLinesFromPlan(plan);
  return segments.length > 0 ? segments.join("\n\n") : null;
}

function extractNarrationFromHtmlPaths(htmlPaths: string[]): string | null {
  const blocks: string[] = [];
  for (const htmlPath of htmlPaths) {
    const html = readFileSync(htmlPath, "utf-8");
    const narration = extractNarrationScript(html);
    if (narration) blocks.push(narration);
  }
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}

function normalizeReview(raw: unknown): { passed: boolean; findings: string[] } {
  let result: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    result = parseJsonObject(raw);
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    result = raw as Record<string, unknown>;
  }
  if (!result) {
    return { passed: false, findings: ["Script rubric returned invalid JSON"] };
  }
  const passed = Boolean(result.passed);
  const findings = Array.isArray(result.findings)
    ? result.findings.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!passed && findings.length === 0) {
    findings.push("Script review failed with no specific findings");
  }
  return { passed, findings };
}

function buildRepairPrompt(options: {
  userPrompt: string;
  findings: string[];
  htmlPaths: string[];
  targetSeconds?: number;
}): string {
  const target = options.targetSeconds ?? 60;
  const filenames = options.htmlPaths.map((htmlPath) => path.basename(htmlPath));
  return [
    "A narration-quality review of the generated lecture found issues. Revise narration to fix them.",
    `Original user request: ${options.userPrompt}`,
    `Target duration: about ${Math.round(target / 60)} minute(s)`,
    `Video scene files: ${filenames.join(", ")}`,
    "",
    "--- findings to fix ---",
    ...options.findings.map((finding) => `- ${finding}`),
    "",
    "Edit only the listed video scene files. Keep segment ids, visuals, and structure.",
  ].join("\n");
}

export async function runScriptGate(options: {
  htmlPath: string;
  htmlPaths?: string[];
  userPrompt: string;
  workspaceDir: string;
  model: string;
  targetSeconds?: number;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<{ html: string; htmlPath: string; scriptReview: ScriptReviewMeta; extraTokens: { input: number; output: number } | null }> {
  let htmlPath = options.htmlPath;
  let html = readFileSync(htmlPath, "utf-8");
  const narrationHtmlPaths =
    options.htmlPaths && options.htmlPaths.length > 0 ? options.htmlPaths : [htmlPath];

  if (!isScriptReviewEnabled()) {
    return {
      html,
      htmlPath,
      scriptReview: { passed: true, findings: [], repaired: false, skipped: true },
      extraTokens: null,
    };
  }

  options.onLog?.("Running narration quality review…");
  const narration = extractNarrationFromHtmlPaths(narrationHtmlPaths);
  if (!narration) {
    const label =
      narrationHtmlPaths.length === 1
        ? path.basename(narrationHtmlPaths[0]) || "index.html"
        : `${narrationHtmlPaths.length} scene file(s)`;
    return {
      html,
      htmlPath,
      scriptReview: {
        passed: false,
        findings: [`No narration segments found in ${label}`],
        repaired: false,
      },
      extraTokens: null,
    };
  }

  const rubric = readFileSync(RUBRIC_PATH, "utf8").trim();
  const reviewModel = resolveReviewModel(options.model);
  const llm = new LLM_Model(reviewModel, rubric);
  const reviewPrompt = [
    `User request: ${options.userPrompt}`,
    options.targetSeconds ? `Target duration: ${options.targetSeconds}s` : "",
    "",
    "--- narration script ---",
    narration,
  ]
    .filter(Boolean)
    .join("\n");

  const reviewResponse = await llm.generate(reviewPrompt, null, null, null, null, true);
  const review = normalizeReview(reviewResponse);
  if (review.passed) {
    options.onLog?.("Narration review passed");
    return {
      html,
      htmlPath,
      scriptReview: { passed: true, findings: review.findings, repaired: false },
      extraTokens: null,
    };
  }

  options.onLog?.(`Narration review found ${review.findings.length} issue(s); running repair…`);
  const agent = new EditorAgent({
    model: options.model,
    workspaceDir: options.workspaceDir,
    onLog: options.onLog,
  });
  const session = agent.startChat();
  await session.sendMessage(
    buildRepairPrompt({
      userPrompt: options.userPrompt,
      findings: review.findings,
      htmlPaths: narrationHtmlPaths,
      targetSeconds: options.targetSeconds,
    }),
    undefined,
    options.signal,
  );

  html = readFileSync(htmlPath, "utf-8");

  options.onLog?.("Re-running narration quality review after repair…");
  const reviewAfterResponse = await llm.generate(
    [
      `User request: ${options.userPrompt}`,
      options.targetSeconds ? `Target duration: ${options.targetSeconds}s` : "",
      "",
      "--- narration script ---",
      extractNarrationFromHtmlPaths(narrationHtmlPaths) ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    null,
    null,
    null,
    null,
    true,
  );
  const reviewAfter = normalizeReview(reviewAfterResponse);
  const repairTokens = session.getTokenUsage();

  return {
    html,
    htmlPath,
    scriptReview: {
      passed: reviewAfter.passed,
      findings: reviewAfter.findings,
      repaired: true,
      initialFindings: review.findings,
    },
    extraTokens: {
      input: repairTokens.input,
      output: repairTokens.output,
    },
  };
}
