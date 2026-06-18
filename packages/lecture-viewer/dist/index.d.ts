/**
 * Public entrypoint for @mylecture/lecture-viewer.
 *
 * Keep this file small: it defines the package surface that external repos
 * import, while implementation stays in viewer-html.ts and player/index.ts.
 */
export { createViewerHtml } from './viewer-html.js';
export { buildAudioTimeline, buildGameTimeline, buildInteractiveTimeline, buildPreviewTimeline, buildSubtitleTimeline, createLecturePlayer, detectDocumentViewport, detectMetadataViewport, estimateTextDuration, lectureViewerVersion, normalizeSectionKind, viewportFromAspectRatio } from './player/index.js';
