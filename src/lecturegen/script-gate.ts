import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditorAgent } from "../../packages/lecture-agent/src/editor-agent/coding_agent.ts";
import { LLM_Model } from "../../packages/lecture-agent/src/utils/llm_model.ts";

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

function extractNarrationScript(html: string): string | null {
  const segments: string[] = [];
  const planMatch = html.match(/window\.__VIDEO_PLAN__\s*=\s*(\[[\s\S]*?\]);/);
  if (!planMatch) return null;
  try {
    const plan = JSON.parse(planMatch[1]) as Array<{ narration?: string }>;
    for (const segment of plan) {
      if (segment?.narration?.trim()) {
        segments.push(segment.narration.trim());
      }
    }
  } catch {
    return null;
  }
  return segments.length > 0 ? segments.join("\n\n") : null;
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
  targetSeconds?: number;
}): string {
  const target = options.targetSeconds ?? 60;
  return [
    "A narration-quality review of index.html found issues. Revise narration to fix them.",
    `Original user request: ${options.userPrompt}`,
    `Target duration: about ${Math.round(target / 60)} minute(s)`,
    "",
    "--- findings to fix ---",
    ...options.findings.map((finding) => `- ${finding}`),
    "",
    "Edit index.html only. Keep segment ids, visuals, and structure.",
  ].join("\n");
}

export async function runScriptGate(options: {
  htmlPath: string;
  userPrompt: string;
  workspaceDir: string;
  model: string;
  targetSeconds?: number;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<{ html: string; htmlPath: string; scriptReview: ScriptReviewMeta; extraTokens: { input: number; output: number } | null }> {
  let htmlPath = options.htmlPath;
  let html = readFileSync(htmlPath, "utf-8");

  if (!isScriptReviewEnabled()) {
    return {
      html,
      htmlPath,
      scriptReview: { passed: true, findings: [], repaired: false, skipped: true },
      extraTokens: null,
    };
  }

  options.onLog?.("Running narration quality review…");
  const narration = extractNarrationScript(html);
  if (!narration) {
    return {
      html,
      htmlPath,
      scriptReview: {
        passed: false,
        findings: ["No narration segments found in index.html"],
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
      targetSeconds: options.targetSeconds,
    }),
    undefined,
    options.signal,
  );

  htmlPath = path.join(options.workspaceDir, "index.html");
  html = readFileSync(htmlPath, "utf-8");

  options.onLog?.("Re-running narration quality review after repair…");
  const reviewAfterResponse = await llm.generate(
    [
      `User request: ${options.userPrompt}`,
      options.targetSeconds ? `Target duration: ${options.targetSeconds}s` : "",
      "",
      "--- narration script ---",
      extractNarrationScript(html) ?? "",
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
