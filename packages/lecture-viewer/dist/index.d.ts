/**
 * Public entrypoint for @mylecture/lecture-viewer.
 *
 * Keep this file small: it defines the package surface that external repos
 * import, while implementation stays in player/index.ts.
 */
export { buildAudioTimeline, buildGameTimeline, buildInteractiveTimeline, buildPreviewTimeline, buildSubtitleTimeline, createLecturePlayer, detectDocumentViewport, detectMetadataViewport, estimateTextDuration, lectureViewerVersion, normalizeSectionKind, viewportFromAspectRatio } from './player/index.js';
