// Bundle entry: the ORIGINAL mylecture-agent LectureGen stages, unchanged.
// Only the LLM transport (utils/llm_model, repair-model), the browser
// (playwright) and env loading are swapped for app shims at bundle time.
export { generateAnswer } from '../../mylecture-agent/src/answer_generator.ts';
export { writeScript } from '../../mylecture-agent/src/script_writer.ts';
export { generateMetadata } from '../../mylecture-agent/src/metadata_generator.ts';
export { stripImageRequests } from '../../mylecture-agent/src/asset_fetcher.ts';
export { getScriptTrimmerChunkSizes, trimScriptByNarration, validateAudiovisualScript, countNarrationWords } from '../../mylecture-agent/src/script_trimmer.ts';
export {
  AnimatorSession, animateScriptBlock, getAnimatorMaxPreviousHtmls, slicePreviousHtmls,
  validateAndRepairHtml, validationFindings, animatorSystemPrompt,
} from '../../mylecture-agent/src/animator.ts';
export { RepairBudget } from '../../mylecture-agent/src/repair-budget.ts';
export { viewportForAspectRatio } from '../../mylecture-agent/src/aesthetic-layout.ts';
export { layoutRepairEnabled, measureAndRepairLayout } from '../../mylecture-agent/src/layout-gate.ts';
export { ensureWorldBasemapInWorkspace, formatWorldBasemapDescription } from '../../mylecture-agent/src/utils/world_basemap.ts';
export { normalizeTtsText } from '../../mylecture-agent/src/resolve-render/tts-normalize.ts';
export { invokeRenderSection, getInvokeRenderSectionSource } from '../../mylecture-agent/src/resolve-render/invoke-render-section.ts';
export { EXPORT_CSS } from '../../mylecture-agent/src/lecture-page.cjs';
export { chromium } from './shims/playwright.js';
export { parseAnimatorEdits } from '../../mylecture-agent/src/animator.ts';
export { tool_edits } from '../../mylecture-agent/src/utils/file_edits.ts';
export { build_prompt } from '../../mylecture-agent/src/prompt_builder.ts';
