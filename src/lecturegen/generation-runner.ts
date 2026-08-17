import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateLecture, type LectureGenSceneTaskState as SceneTaskState } from "../../../mylecture-agent/src/lecturegen.ts";
import { EditorAgent } from "../../../mylecture-agent/src/editor-agent/coding_agent.ts";
import {
  buildLectureGenCallbackPayload,
  buildLectureGenProgressCallbackPayload,
  postLectureGenCallback,
  resolveMeteringOperationId,
} from "./callback.ts";
import { formatGenerationLengthFromSeconds } from "./duration.ts";
import {
  resolveEditModel,
  runEditWithModelFallback,
} from "./edit-model-fallback.ts";
import {
  appendJobLog,
  clearProgressCallbackPending,
  clearAbortController,
  clearCallbackPending,
  flushPersist,
  getJobRecord,
  markJobSourceReady,
  registerAbortController,
  setCallbackPending,
  setJobError,
  setJobProgress,
  setJobStatus,
  setJobUsage,
  setLastEditRequest,
  setProgressCallbackPending,
} from "./job-store.ts";
import { createProgressInterpreter, type ProgressUpdate } from "./progress.ts";
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

function createProgressPublisher(generationId: string): {
  emit: (update: ProgressUpdate) => void;
  onLog: (line: string) => void;
  onSceneTaskState: (state: SceneTaskState) => void;
} {
  const interpret = createProgressInterpreter();
  const completedScenes = new Set<number>();
  const emit = (update: ProgressUpdate): void => {
    const progress = setJobProgress(generationId, update);
    const record = getJobRecord(generationId);
    if (!progress || !record?.websiteJobId) return;

    setProgressCallbackPending(generationId, progress);
    void flushPersist(generationId)
      .then(async () => {
        const delivered = await postLectureGenCallback(
          buildLectureGenProgressCallbackPayload({
            websiteJobId: record.websiteJobId!,
            generationId,
            progress,
          }),
        );
        if (delivered) {
          clearProgressCallbackPending(generationId, progress.sequence);
          await flushPersist(generationId);
        }
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        appendJobLog(
          generationId,
          `Progress callback delivery deferred for retry: ${detail}`,
        );
      });
  };
  return {
    emit,
    onLog: (line: string) => {
      appendJobLog(generationId, line);
      const update = interpret(line);
      if (update) emit(update);
    },
    onSceneTaskState: (state: SceneTaskState) => {
      if (state.status === "failed" || state.status === "queued") return;
      if (state.status === "complete") completedScenes.add(state.index);

      const common = {
        currentScene: state.index,
        completedScenes: completedScenes.size,
        totalScenes: state.totalScenes,
      };
      if (state.status === "generating") {
        emit({
          ...common,
          stage: "scene-generation",
          message: `Creating scene ${state.index} of ${state.totalScenes}`,
        });
      } else if (state.status === "preflight" || state.status === "validating") {
        emit({
          ...common,
          stage: "scene-validation",
          message: `Checking scene ${state.index} of ${state.totalScenes}`,
        });
      } else if (state.status === "repairing") {
        emit({
          ...common,
          stage: "scene-repair",
          message: `Refining scene ${state.index} of ${state.totalScenes}`,
          repairAttempt: state.repairAttempt,
          maximumRepairs: state.maximumRepairs,
        });
      } else if (state.status === "complete") {
        emit({
          ...common,
          stage: "scene-validation",
          message: `Scene ${state.index} of ${state.totalScenes} is ready`,
        });
      }
    },
  };
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
  const progress = createProgressPublisher(generationId);

  try {
    setJobStatus(generationId, "generating");
    appendJobLog(generationId, "Starting lecture generation");
    progress.emit({ stage: "answer", message: "Understanding your request" });

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
      // API default: off unless the client explicitly opts in (website omits this field).
      enableGetimg: request.enableGetimg === true,
      tokenTrackerSessionId: generationId,
      onLog: progress.onLog,
      onSceneTaskState: progress.onSceneTaskState,
      signal: controller.signal,
    });

    let sourceHtml: string | null = null;
    let repairTokens: { input: number; output: number } | null = null;

    if (includeVideo) {
      const gate = await runScriptGate({
        htmlPath: result.entryFile,
        htmlPaths: result.videoFiles,
        userPrompt: request.prompt,
        workspaceDir: result.workspaceDir,
        model,
        tokenTrackerSessionId: generationId,
        targetSeconds: request.targetSeconds,
        onLog: progress.onLog,
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
    progress.emit({
      stage: "source-ready",
      message: includeVideo ? "Preparing your video render" : "Preparing your activities",
    });
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
  const progress = createProgressPublisher(generationId);

  try {
    const sourceVersion = record.sourceVersion;
    const baseVersion = record.lastReadySourceVersion;
    appendJobLog(
      generationId,
      `Starting edit (source v${sourceVersion}, base v${baseVersion})`,
    );
    progress.emit({ stage: "script", message: "Applying your changes" });

    const restored = await downloadWorkspaceFromStorage(generationId, baseVersion);
    workspaceDir = restored.workspaceDir;
    const indexPath = path.join(workspaceDir, "index.html");

    const attachmentPaths = await writeAttachments(workspaceDir, request.attachments);
    const primaryModel = resolveEditModel();
    const editableFiles = (await readdir(workspaceDir)).filter((name) =>
      /^index\d*\.html$/i.test(name),
    );
    const originalEditSources = new Map(
      await Promise.all(
        editableFiles.map(async (name) => [
          name,
          await readFile(path.join(workspaceDir!, name), "utf-8"),
        ] as const),
      ),
    );
    let editAttempt = 0;
    const editPrompt =
      `You are editing an existing renderer-ready lecture video. ` +
      `The current HTML is in index.html. Apply this change: ${request.instruction}`;

    appendJobLog(generationId, `Editing with model ${primaryModel}`);
    const editResult = await runEditWithModelFallback({
      primaryModel,
      run: async (model) => {
        if (editAttempt > 0) {
          await Promise.all(
            Array.from(originalEditSources, ([name, html]) =>
              writeFile(path.join(workspaceDir!, name), html, "utf-8"),
            ),
          );
          appendJobLog(generationId, "Restored pre-edit source before fallback");
        }
        editAttempt += 1;
        const agent = new EditorAgent({
          model,
          workspaceDir,
          tokenTrackerSessionId: generationId,
          onLog: progress.onLog,
        });
        const session = agent.startChat();
        return session.sendMessage(editPrompt, undefined, controller.signal);
      },
      onFallback: (failedModel, fallbackModel, error) => {
        const detail = error instanceof Error ? error.message : String(error);
        appendJobLog(
          generationId,
          `Transient model failure on ${failedModel}; retrying edit with ${fallbackModel}: ${detail}`,
        );
        progress.emit({
          stage: "script",
          message: "The primary editor is busy; trying the backup editor",
        });
      },
    });
    const model = editResult.model;
    if (editResult.usedFallback) {
      appendJobLog(generationId, `Edit fallback succeeded with ${model}`);
    }

    let sourceHtml: string | null = null;
    let repairTokens: { input: number; output: number } | null = null;

    if (includeVideo && existsSync(indexPath)) {
      const gate = await runScriptGate({
        htmlPath: indexPath,
        userPrompt: request.instruction,
        workspaceDir,
        model,
        tokenTrackerSessionId: generationId,
        onLog: progress.onLog,
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
    progress.emit({ stage: "source-ready", message: "Preparing your updated preview" });
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
