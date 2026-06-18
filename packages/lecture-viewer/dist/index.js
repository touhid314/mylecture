/**
 * Public entrypoint for @mylecture/lecture-viewer.
 *
 * Keep this file small: it defines the package surface that external repos
 * import, while implementation stays in viewer-html.ts and player/index.ts.
 */
export { createViewerHtml } from './viewer-html.js';
// Player helpers are exported individually so hosts can either use the full
// player controller or reuse the timeline/viewport utilities in their own UI.
export { buildAudioTimeline, buildGameTimeline, buildInteractiveTimeline, buildPreviewTimeline, buildSubtitleTimeline, createLecturePlayer, detectDocumentViewport, detectMetadataViewport, estimateTextDuration, lectureViewerVersion, normalizeSectionKind, viewportFromAspectRatio } from './player/index.js';
