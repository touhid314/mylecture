import { createWriteStream, existsSync } from "node:fs";import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateLecture } from "../../packages/lecture-agent/src/lecturegen.ts";
import { EditorAgent } from "../../packages/lecture-agent/src/editor-agent/coding_agent.ts";
import {
  buildLectureGenCallbackPayload,
  postLectureGenCallback,
  resolveMeteringOperationId,
} from "./callback.ts";
import { formatGenerationLengthFromSeconds } from "./duration.ts";
import {
  appendJobLog,
  clearAbortController,
  clearCallbackPending,
  flushPersist,
  getJobRecord,
  markJobSourceReady,
  registerAbortController,
  setCallbackPending,
  setJobError,
  setJobStatus,
  setJobUsage,
  setLastEditRequest,
} from "./job-store.ts";
import { runScriptGate } from "./script-gate.ts";
import { downloadWorkspaceFromStorage } from "./source-bundle.ts";
import {
  putIntermediateText,
  putOutputText,
  removeIntermediatePrefix,
  sourceHtmlKey,
  uploadWorkspaceDir,
} from "./storage.ts";
import type { LectureGenCreateRequest, LectureGenEditRequest } from "./types.ts";
import { buildJobUsageFromSessions } from "./usage.ts";

function readEnvString(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function defaultModel(): string {
  return readEnvString("AGENT_MODEL", "gemini-3.5-flash");
}

async function writeAttachments(
  workspaceDir: string,
  attachments: LectureGenCreateRequest["attachments"],
): Promise<string[]> {
  if (!attachments?.length) return [];
  const uploadsDir = path.join(workspaceDir, "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const paths: string[] = [];
  for (const attachment of attachments) {
    const safeName = path.basename(attachment.filename);
    const dest = path.join(uploadsDir, safeName);
    await writeFile(dest, Buffer.from(attachment.dataBase64, "base64"));
    paths.push(dest);
  }
  return paths;
}

async function uploadPracticeArtifacts(
  generationId: string,
  sourceVersion: number,
  workspaceDir: string,
  storageBase: string,
  includeInteractive: boolean,
  includeGame: boolean,
  onLog?: (line: string) => void,
): Promise<{ interactiveUploaded: boolean; gameUploaded: boolean }> {
  let interactiveUploaded = false;
  let gameUploaded = false;

  if (includeInteractive) {
    const interactivePath = path.join(workspaceDir, "interactive.html");
    if (!existsSync(interactivePath)) {
      throw new Error("interactive.html was requested but not produced");
    }
    const html = await readFile(interactivePath, "utf-8");
    await putOutputText(`${storageBase}/interactive.html`, html, "text/html; charset=utf-8");
    interactiveUploaded = true;
    onLog?.("Uploaded interactive.html to website output bucket");
  }

  if (includeGame) {
    const gamePath = path.join(workspaceDir, "game.html");
    if (!existsSync(gamePath)) {
      throw new Error("game.html was requested but not produced");
    }
    const html = await readFile(gamePath, "utf-8");
    await putOutputText(`${storageBase}/game.html`, html, "text/html; charset=utf-8");
    gameUploaded = true;
    onLog?.("Uploaded game.html to website output bucket");
  }

  return { interactiveUploaded, gameUploaded };
}

async function persistSource(
  generationId: string,
  sourceVersion: number,
  html: string | null,
  workspaceDir: string,
): Promise<void> {
  if (html) {
    await putIntermediateText(
      sourceHtmlKey(generationId, sourceVersion),
      html,
      "text/html; charset=utf-8",
    );
  }
  await uploadWorkspaceDir(generationId, sourceVersion, workspaceDir);
}

async function notifyWebsite(
  generationId: string,
  sourceVersion: number,
  status: "source_ready" | "failed",
  opts?: {
    usage?: ReturnType<typeof buildJobUsageFromSessions>;
    error?: string;
    interactiveUploaded?: boolean;
    gameUploaded?: boolean;
  },
): Promise<void> {
  const record = getJobRecord(generationId);
  if (!record?.websiteJobId) return;

  const pending = {
    status,
    sourceVersion,
    usage: opts?.usage ?? record.usage,
    error: opts?.error,
    interactiveReady: opts?.interactiveUploaded,
    gameReady: opts?.gameUploaded,
  };
  setCallbackPending(generationId, pending);
  await flushPersist(generationId);

  const delivered = await postLectureGenCallback(
    buildLectureGenCallbackPayload({
      websiteJobId: record.websiteJobId,
      generationId,
      sourceVersion,
      status,
      usage: pending.usage,
      meteringOperationId: resolveMeteringOperationId(record),
      error: pending.error,
      interactiveReady: pending.interactiveReady,
      gameReady: pending.gameReady,
    }),
  );

  if (delivered) {
    clearCallbackPending(generationId);
    await flushPersist(generationId);
  }
}

export async function runCreateJob(
  generationId: string,
  request: LectureGenCreateRequest,
): Promise<void> {
  const record = getJobRecord(generationId);
  if (!record) return;

  const controller = new AbortController();
  registerAbortController(generationId, controller);

  let workspaceDir: string | null = null;
  const includeVideo = request.includeVideo !== false;
  const includeInteractive = request.includeInteractive === true;
  const includeGame = request.includeGame === true;

  try {
    setJobStatus(generationId, "generating");
    appendJobLog(generationId, "Starting lecture generation");

    workspaceDir = await mkdtemp(path.join(os.tmpdir(), "lecturegen-gen-"));
    const attachmentPaths = await writeAttachments(workspaceDir, request.attachments);
    const model = request.model?.trim() || defaultModel();
    const generationLength =
      request.generationLength?.trim() ||
      formatGenerationLengthFromSeconds(request.targetSeconds);

    const result = await generateLecture({
      request: request.prompt,
      model,
      scriptModel: request.scriptModel,
      animatorModel: request.animatorModel,
      workspaceDir,
      attachments: attachmentPaths,
      generationLength,
      aspectRatio: request.aspectRatio,
      theme: request.theme,
      teachingStyle: request.teachingStyle,
      includeVideo,
      includeInteractive,
      includeGame,
      enableGetimg: request.enableGetimg,
      tokenTrackerSessionId: generationId,
      onLog: (line) => appendJobLog(generationId, line),
      signal: controller.signal,
    });

    let sourceHtml: string | null = null;
    let repairTokens: { input: number; output: number } | null = null;

    if (includeVideo) {
      const gate = await runScriptGate({
        htmlPath: result.entryFile,
        userPrompt: request.prompt,
        workspaceDir: result.workspaceDir,
        model,
        targetSeconds: request.targetSeconds,
        onLog: (line) => appendJobLog(generationId, line),
        signal: controller.signal,
      });

      if (!gate.scriptReview.passed) {
        const detail =
          gate.scriptReview.findings.join("; ") || "Script review failed";
        throw new Error(detail);
      }

      sourceHtml = gate.html;
      repairTokens = gate.extraTokens;
    }

    const sourceVersion = record.sourceVersion;
    await persistSource(generationId, sourceVersion, sourceHtml, result.workspaceDir);

    let practiceUpload = { interactiveUploaded: false, gameUploaded: false };
    if (record.websiteStorageBase) {
      practiceUpload = await uploadPracticeArtifacts(
        generationId,
        sourceVersion,
        result.workspaceDir,
        record.websiteStorageBase,
        includeInteractive,
        includeGame,
        (line) => appendJobLog(generationId, line),
      );
    }

    const usage = buildJobUsageFromSessions({
      model,
      sessionIds: [generationId],
      repairTokens,
    });
    setJobUsage(generationId, usage);

    await markJobSourceReady(generationId, sourceVersion);
    appendJobLog(generationId, "Source ready for render");
    await notifyWebsite(generationId, sourceVersion, "source_ready", {
      usage,
      interactiveUploaded: practiceUpload.interactiveUploaded,
      gameUploaded: practiceUpload.gameUploaded,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      await setJobError(generationId, "Generation cancelled");
      appendJobLog(generationId, "Generation cancelled");
      return;
    }
    const message = error instanceof Error ? error.message : "Generation failed";
    await setJobError(generationId, message);
    appendJobLog(generationId, `ERROR: ${message}`);
    await notifyWebsite(generationId, record.sourceVersion, "failed", {
      error: message,
    });
  } finally {
    clearAbortController(generationId);
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function runEditJob(
  generationId: string,
  request: LectureGenEditRequest,
): Promise<void> {
  const record = getJobRecord(generationId);
  if (!record) return;

  setLastEditRequest(generationId, request);

  const controller = new AbortController();
  registerAbortController(generationId, controller);

  let workspaceDir: string | null = null;
  const includeVideo = record.createRequest?.includeVideo !== false;

  try {
    const sourceVersion = record.sourceVersion;
    const baseVersion = record.lastReadySourceVersion;
    appendJobLog(
      generationId,
      `Starting edit (source v${sourceVersion}, base v${baseVersion})`,
    );

    const restored = await downloadWorkspaceFromStorage(generationId, baseVersion);
    workspaceDir = restored.workspaceDir;
    const indexPath = path.join(workspaceDir, "index.html");

    const attachmentPaths = await writeAttachments(workspaceDir, request.attachments);
    const model = defaultModel();
    const editPrompt =
      `You are editing an existing renderer-ready lecture video. ` +
      `The current HTML is in index.html. Apply this change: ${request.instruction}`;

    const agent = new EditorAgent({
      model,
      workspaceDir,
      onLog: (line) => appendJobLog(generationId, line),
    });
    const session = agent.startChat();
    await session.sendMessage(editPrompt, undefined, controller.signal);

    let sourceHtml: string | null = null;
    let repairTokens: { input: number; output: number } | null = null;

    if (includeVideo && existsSync(indexPath)) {
      const gate = await runScriptGate({
        htmlPath: indexPath,
        userPrompt: request.instruction,
        workspaceDir,
        model,
        onLog: (line) => appendJobLog(generationId, line),
        signal: controller.signal,
      });

      if (!gate.scriptReview.passed) {
        const detail =
          gate.scriptReview.findings.join("; ") || "Script review failed";
        throw new Error(detail);
      }

      sourceHtml = gate.html;
      repairTokens = gate.extraTokens;
    }

    await persistSource(generationId, sourceVersion, sourceHtml, workspaceDir);

    const includeInteractive = record.createRequest?.includeInteractive === true;
    const includeGame = record.createRequest?.includeGame === true;
    let practiceUpload = { interactiveUploaded: false, gameUploaded: false };
    if (record.websiteStorageBase) {
      practiceUpload = await uploadPracticeArtifacts(
        generationId,
        sourceVersion,
        workspaceDir,
        record.websiteStorageBase,
        includeInteractive,
        includeGame,
        (line) => appendJobLog(generationId, line),
      );
    }

    const usage = buildJobUsageFromSessions({
      model,
      sessionIds: [generationId],
      repairTokens,
    });
    setJobUsage(generationId, usage);

    await markJobSourceReady(generationId, sourceVersion);
    appendJobLog(generationId, "Edited source ready for render");
    await notifyWebsite(generationId, sourceVersion, "source_ready", {
      usage,
      interactiveUploaded: practiceUpload.interactiveUploaded,
      gameUploaded: practiceUpload.gameUploaded,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      await setJobError(generationId, "Edit cancelled");
      appendJobLog(generationId, "Edit cancelled");
      return;
    }
    const message = error instanceof Error ? error.message : "Edit failed";
    await setJobError(generationId, message);
    appendJobLog(generationId, `ERROR: ${message}`);
    await notifyWebsite(generationId, record.sourceVersion, "failed", {
      error: message,
    });
  } finally {
    clearAbortController(generationId);
    if (workspaceDir) {
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function deleteGenerationArtifacts(generationId: string): Promise<void> {
  await removeIntermediatePrefix(`${generationId}/`);
}
