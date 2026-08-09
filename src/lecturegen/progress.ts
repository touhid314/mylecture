import type { LectureGenProgress } from "./types.ts";

export type ProgressUpdate = Omit<
  LectureGenProgress,
  "sourceVersion" | "sequence" | "updatedAt"
>;

type ProgressInterpreterState = {
  currentScene: number;
  totalScenes: number;
  completedScenes: number;
  repairAttempt: number;
};

/**
 * Converts known internal stage boundaries into fixed public copy. Raw model or
 * validator output is never forwarded to the website.
 */
export function createProgressInterpreter(): (line: string) => ProgressUpdate | null {
  const state: ProgressInterpreterState = {
    currentScene: 0,
    totalScenes: 0,
    completedScenes: 0,
    repairAttempt: 0,
  };

  return (line: string): ProgressUpdate | null => {
    if (/Generating the concept answer/i.test(line)) {
      return { stage: "answer", message: "Understanding your request" };
    }
    if (/Writing the audiovisual script/i.test(line)) {
      return { stage: "script", message: "Writing the video script" };
    }

    const split = line.match(/Split the script into (\d+) narration-based animation block/i);
    if (split) {
      state.totalScenes = Number.parseInt(split[1], 10);
      return {
        stage: "scene-generation",
        message: `Preparing ${state.totalScenes} scene${state.totalScenes === 1 ? "" : "s"}`,
        completedScenes: 0,
        totalScenes: state.totalScenes,
      };
    }

    const animating = line.match(/Animating .* from script block (\d+)\/(\d+)/i);
    if (animating) {
      state.currentScene = Number.parseInt(animating[1], 10);
      state.totalScenes = Number.parseInt(animating[2], 10);
      state.completedScenes = Math.max(0, state.currentScene - 1);
      state.repairAttempt = 0;
      return {
        stage: "scene-generation",
        message: `Creating scene ${state.currentScene} of ${state.totalScenes}`,
        currentScene: state.currentScene,
        completedScenes: state.completedScenes,
        totalScenes: state.totalScenes,
      };
    }

    if (/validation passed/i.test(line) && state.currentScene > 0) {
      state.completedScenes = Math.max(state.completedScenes, state.currentScene);
      return {
        stage: "scene-validation",
        message: `Scene ${state.currentScene} of ${state.totalScenes} is ready`,
        currentScene: state.currentScene,
        completedScenes: state.completedScenes,
        totalScenes: state.totalScenes,
      };
    }

    if (/validation failed|Animator repair attempt failed|Repair edits introduced/i.test(line)) {
      state.repairAttempt += 1;
      return {
        stage: "scene-repair",
        message: `Refining scene ${state.currentScene || 1} of ${state.totalScenes || 1}`,
        currentScene: state.currentScene || 1,
        completedScenes: state.completedScenes,
        totalScenes: state.totalScenes || 1,
        repairAttempt: state.repairAttempt,
        maximumRepairs: 5,
      };
    }

    if (/Running narration quality review|Re-running narration quality review/i.test(line)) {
      return {
        stage: "narration-review",
        message: "Reviewing narration",
        completedScenes: state.completedScenes,
        totalScenes: state.totalScenes || undefined,
      };
    }

    return null;
  };
}
