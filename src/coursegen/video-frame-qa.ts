import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import { loadAppConfig } from '../config.ts';
import { collectOverlapFindings } from './layout-overlap.ts';

export const MAX_VIDEO_FRAME_FINDINGS = 6;

const FILL_RATIO_THRESHOLD = 0.8;
const OVERFLOW_TOLERANCE_PX = 8;

export type VideoFrameBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  visible: boolean;
  content?: boolean;
  /** Deepest common ancestor of all content-bearing elements (the effective stage). */
  container?: boolean;
};

export type VideoFrameMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
  containerWidth: number;
  containerHeight: number;
  hasHorizontalOverflow: boolean;
  hasVerticalOverflow: boolean;
  fillsFrame: boolean;
  noVisibleContent: boolean;
  coverageScore: number;
};

export function isContentBearingElement(tagName: string, hasDirectText: boolean, childElementCount: number, textContent: string): boolean {
  if (['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(tagName)) return true;
  if (hasDirectText) return true;
  return childElementCount === 0 && textContent.trim().length > 0;
}

export function evaluateVideoFrameMetrics(
  viewportWidth: number,
  viewportHeight: number,
  boxes: VideoFrameBox[]
): VideoFrameMetrics {
  const visible = boxes.filter(box => box.visible);
  const contentBoxes = visible.filter(box => box.content);
  const measureBoxes = contentBoxes.length > 0 ? contentBoxes : [];
  const noVisibleContent = measureBoxes.length === 0;

  let left = viewportWidth;
  let top = viewportHeight;
  let right = 0;
  let bottom = 0;
  for (const box of measureBoxes) {
    left = Math.min(left, box.left);
    top = Math.min(top, box.top);
    right = Math.max(right, box.right);
    bottom = Math.max(bottom, box.bottom);
  }
  const contentWidth = measureBoxes.length > 0 ? Math.max(0, right - left) : 0;
  const contentHeight = measureBoxes.length > 0 ? Math.max(0, bottom - top) : 0;
  // A full-viewport stage with sparse content (one centered expression) is a valid
  // layout; only fail when the container that bounds ALL content is itself small.
  let containerWidth = 0;
  let containerHeight = 0;
  for (const box of visible.filter(candidate => candidate.container)) {
    containerWidth = Math.max(containerWidth, box.right - box.left);
    containerHeight = Math.max(containerHeight, box.bottom - box.top);
  }
  const effectiveWidth = Math.max(contentWidth, containerWidth);
  const effectiveHeight = Math.max(contentHeight, containerHeight);
  const widthRatio = effectiveWidth / viewportWidth;
  const heightRatio = effectiveHeight / viewportHeight;
  const coverageScore = measureBoxes.length > 0 ? Math.min(widthRatio, heightRatio) : 0;
  const letterboxed =
    measureBoxes.length > 0 &&
    widthRatio < FILL_RATIO_THRESHOLD &&
    heightRatio < FILL_RATIO_THRESHOLD;
  const fillsFrame = measureBoxes.length > 0 && !letterboxed;
  const hasHorizontalOverflow = visible.some(
    box => box.left < -OVERFLOW_TOLERANCE_PX || box.right > viewportWidth + OVERFLOW_TOLERANCE_PX
  );
  const hasVerticalOverflow = visible.some(
    box => box.top < -OVERFLOW_TOLERANCE_PX || box.bottom > viewportHeight + OVERFLOW_TOLERANCE_PX
  );
  return {
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    containerWidth,
    containerHeight,
    hasHorizontalOverflow,
    hasVerticalOverflow,
    fillsFrame,
    noVisibleContent,
    coverageScore
  };
}

export function mergeBestVideoFrameMetrics(current: VideoFrameMetrics, candidate: VideoFrameMetrics): VideoFrameMetrics {
  if (candidate.coverageScore > current.coverageScore) return candidate;
  if (candidate.coverageScore < current.coverageScore) return current;
  if (candidate.fillsFrame && !current.fillsFrame) return candidate;
  if (!candidate.hasHorizontalOverflow && current.hasHorizontalOverflow) return candidate;
  if (!candidate.hasVerticalOverflow && current.hasVerticalOverflow) return candidate;
  if (!candidate.noVisibleContent && current.noVisibleContent) return candidate;
  return current;
}

/** Overflow must persist at every probe so slide-in/out animations do not false-flag. */
export function aggregatePersistentOverflow(
  perProbe: Array<Pick<VideoFrameMetrics, 'hasHorizontalOverflow' | 'hasVerticalOverflow'>>
): Pick<VideoFrameMetrics, 'hasHorizontalOverflow' | 'hasVerticalOverflow'> {
  if (perProbe.length === 0) {
    return { hasHorizontalOverflow: false, hasVerticalOverflow: false };
  }
  return {
    hasHorizontalOverflow: perProbe.every(metrics => metrics.hasHorizontalOverflow),
    hasVerticalOverflow: perProbe.every(metrics => metrics.hasVerticalOverflow)
  };
}

export function probeTimesForSegmentDuration(durationSec: number): number[] {
  const duration = Math.max(0.1, durationSec);
  const candidates = [0.5, 1.5, duration / 2];
  const clamped = candidates.map(time => Math.min(Math.max(0, time), duration));
  return [...new Set(clamped.map(time => Number(time.toFixed(3))))];
}

export function formatVideoFrameFindings(
  metrics: VideoFrameMetrics,
  context: string,
  screenshotPath?: string
): string[] {
  const findings: string[] = [];
  const shot = screenshotPath ? ` (screenshot: ${screenshotPath})` : '';
  if (metrics.noVisibleContent) {
    findings.push(`[${context}] no visible content at probed times${shot}`);
  }
  if (!metrics.fillsFrame && !metrics.noVisibleContent) {
    const effectiveWidth = Math.max(metrics.contentWidth, metrics.containerWidth);
    const effectiveHeight = Math.max(metrics.contentHeight, metrics.containerHeight);
    const detail = `content container ${Math.round(effectiveWidth)}x${Math.round(effectiveHeight)} vs viewport ${metrics.viewportWidth}x${metrics.viewportHeight}`;
    findings.push(
      `[${context}] stage letterboxed on both axes — the box bounding all content does not fill the render frame (${detail})${shot}`
    );
  }
  if (metrics.hasHorizontalOverflow) {
    findings.push(`[${context}] content clipped outside the render frame (horizontal overflow)${shot}`);
  }
  if (metrics.hasVerticalOverflow) {
    findings.push(`[${context}] content clipped outside the render frame (vertical overflow)${shot}`);
  }
  return findings;
}

function extractFindingBasenames(findings: string[]): string[] {
  const names = new Set<string>();
  for (const finding of findings) {
    const match = finding.match(/^\[([^\]]+)\]/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

async function collectBoxes(page: Page): Promise<VideoFrameBox[]> {
  return page.evaluate(() => {
    const skipTags = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT', 'HEAD', 'HTML', 'BODY']);
    const boxes: Array<{
      left: number;
      top: number;
      right: number;
      bottom: number;
      visible: boolean;
      content: boolean;
      container?: boolean;
    }> = [];
    const contentElements: Element[] = [];
    const elements = document.body ? document.body.querySelectorAll('*') : [];
    elements.forEach(el => {
      if (skipTags.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      let hasDirectText = false;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
          hasDirectText = true;
          break;
        }
      }
      const isMedia = ['IMG', 'SVG', 'CANVAS', 'VIDEO'].includes(el.tagName);
      const isContent = isMedia || hasDirectText || (el.children.length === 0 && (el.textContent || '').trim().length > 0);
      if (isContent) contentElements.push(el);
      boxes.push({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        visible: true,
        content: isContent
      });
    });
    // Deepest common ancestor of all content = the effective stage. A full-viewport
    // stage with sparse content is valid; a small stage box is letterboxing.
    if (contentElements.length > 0) {
      let ancestor: Element | null = contentElements[0];
      for (const el of contentElements) {
        while (ancestor && ancestor !== document.body && !ancestor.contains(el)) {
          ancestor = ancestor.parentElement;
        }
        if (!ancestor || ancestor === document.body) break;
      }
      if (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        const rect = ancestor.getBoundingClientRect();
        boxes.push({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          visible: true,
          content: false,
          container: true
        });
      }
    }
    return boxes;
  });
}

const MAX_PROBED_SEGMENTS = 20;

/**
 * Content defects the geometry checks cannot see: literal HTML entities rendered
 * as text (e.g. innerText = "&divide;") and distinct text elements stacked on
 * top of each other (missing segment cleanup). Scanned at the settled mid-probe
 * of each segment so crossfade transitions do not false-flag.
 */
async function collectTextDefects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const findings: string[] = [];
    const leaves: Array<{ text: string; left: number; top: number; right: number; bottom: number; index: number }> = [];
    const leafElements: Element[] = [];
    const skip = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT']);
    const elements = document.body ? document.body.querySelectorAll('*') : [];
    elements.forEach(el => {
      if (skip.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      let direct = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) direct += child.textContent || '';
      }
      const text = direct.trim().replace(/\s+/g, ' ');
      if (!text) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      leafElements.push(el);
      leaves.push({ text, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, index: leafElements.length - 1 });
    });

    for (const leaf of leaves) {
      const entity = leaf.text.match(/&(?:[a-zA-Z]{2,10}|#\d{2,5});/);
      if (entity) {
        findings.push(`literal HTML entity "${entity[0]}" rendered as visible text in "${leaf.text.slice(0, 60)}" — use the real character (or innerHTML), innerText/textContent do not decode entities`);
      }
    }

    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i];
        const b = leaves[j];
        if (a.text === b.text) continue;
        if (leafElements[a.index].contains(leafElements[b.index]) || leafElements[b.index].contains(leafElements[a.index])) continue;
        const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) continue;
        const overlapArea = overlapWidth * overlapHeight;
        const areaA = (a.right - a.left) * (a.bottom - a.top);
        const areaB = (b.right - b.left) * (b.bottom - b.top);
        const smaller = Math.min(areaA, areaB);
        if (smaller > 0 && overlapArea / smaller > 0.6) {
          findings.push(`overlapping text elements: "${a.text.slice(0, 40)}" collides with "${b.text.slice(0, 40)}" — previous segment content is not being cleared/hidden by the render function`);
        }
      }
    }
    return findings;
  });
}

/** Visible leaf text snapshot used to detect stateful render functions. */
async function collectVisibleTextSnapshot(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts: string[] = [];
    const skip = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'NOSCRIPT']);
    const elements = document.body ? document.body.querySelectorAll('*') : [];
    elements.forEach(el => {
      if (skip.has(el.tagName)) return;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      let direct = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) direct += child.textContent || '';
      }
      const text = direct.trim().replace(/\s+/g, ' ');
      if (!text) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      texts.push(text);
    });
    return texts;
  });
}

type ContractInfo = {
  hasContract: boolean;
  segmentDurations: number[];
};

async function readContractInfo(page: Page): Promise<ContractInfo> {
  const raw = await page.evaluate(() => {
    const plan = (window as unknown as { __VIDEO_PLAN__?: Array<{ duration?: number }> }).__VIDEO_PLAN__;
    const renderSection = (window as unknown as {
      __RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
      __HTML_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
      __AI_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
    }).__RENDER_SECTION__
      || (window as unknown as { __HTML_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void }).__HTML_RENDER_SECTION__
      || (window as unknown as { __AI_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void }).__AI_RENDER_SECTION__;
    if (!Array.isArray(plan) || plan.length === 0 || typeof renderSection !== 'function') {
      return { hasContract: false, durations: [] as number[] };
    }
    const durations = plan.map(segment => {
      const value = segment && typeof segment === 'object' ? (segment as { duration?: number }).duration : undefined;
      return Number.isFinite(value) && (value ?? 0) > 0 ? Number(value) : 3;
    });
    return { hasContract: true, durations };
  });
  return {
    hasContract: raw.hasContract,
    segmentDurations: raw.durations.slice(0, MAX_PROBED_SEGMENTS)
  };
}

async function driveRenderSection(page: Page, segmentIndex: number, localTime: number, globalTime: number): Promise<string | null> {
  return page.evaluate(([index, local, global]) => {
    const plan = (window as unknown as { __VIDEO_PLAN__?: unknown[] }).__VIDEO_PLAN__;
    const renderSection = (window as unknown as {
      __RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
      __HTML_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
      __AI_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
    }).__RENDER_SECTION__
      || (window as unknown as { __HTML_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void }).__HTML_RENDER_SECTION__
      || (window as unknown as { __AI_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void }).__AI_RENDER_SECTION__;
    if (!Array.isArray(plan) || plan.length === 0 || typeof renderSection !== 'function') return null;
    const segment = plan[Math.min(index, plan.length - 1)];
    try {
      renderSection(segment, local, global);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, [segmentIndex, localTime, globalTime] as [number, number, number]);
}

/**
 * Probe every plan segment (not just the first) so mid-video defects are caught.
 * Overflow must persist across all probes WITHIN a segment to flag, so slide
 * in/out animations do not false-positive; letterbox uses best coverage overall.
 */
async function measureBestMetricsAtProbes(
  page: Page,
  width: number,
  height: number,
  segmentDurations: number[]
): Promise<{ metrics: VideoFrameMetrics; renderErrors: string[]; textDefects: string[] }> {
  let best = evaluateVideoFrameMetrics(width, height, []);
  let persistentHorizontal = false;
  let persistentVertical = false;
  const renderErrors: string[] = [];
  const textDefects = new Set<string>();

  const probeSegment = async (segmentIndex: number, duration: number, globalStart: number) => {
    const perProbeOverflow: Array<Pick<VideoFrameMetrics, 'hasHorizontalOverflow' | 'hasVerticalOverflow'>> = [];
    const probeTimes = probeTimesForSegmentDuration(duration);
    for (let probeIndex = 0; probeIndex < probeTimes.length; probeIndex++) {
      const probeTime = probeTimes[probeIndex];
      const renderError = await driveRenderSection(page, segmentIndex, probeTime, globalStart + probeTime);
      if (renderError && renderErrors.length < MAX_VIDEO_FRAME_FINDINGS) {
        renderErrors.push(`segment ${segmentIndex + 1} render error at t=${probeTime}s: ${renderError}`);
      }
      await page.waitForTimeout(50);
      const boxes = await collectBoxes(page);
      const metrics = evaluateVideoFrameMetrics(width, height, boxes);
      best = mergeBestVideoFrameMetrics(best, metrics);
      perProbeOverflow.push({
        hasHorizontalOverflow: metrics.hasHorizontalOverflow,
        hasVerticalOverflow: metrics.hasVerticalOverflow
      });
      if (probeIndex === probeTimes.length - 1 && textDefects.size < MAX_VIDEO_FRAME_FINDINGS) {
        for (const defect of await collectTextDefects(page)) {
          textDefects.add(`segment ${segmentIndex + 1}: ${defect}`);
        }
      }
    }
    const persistent = aggregatePersistentOverflow(perProbeOverflow);
    persistentHorizontal = persistentHorizontal || persistent.hasHorizontalOverflow;
    persistentVertical = persistentVertical || persistent.hasVerticalOverflow;
  };

  if (segmentDurations.length === 0) {
    const boxes = await collectBoxes(page);
    const metrics = evaluateVideoFrameMetrics(width, height, boxes);
    best = mergeBestVideoFrameMetrics(best, metrics);
    persistentHorizontal = metrics.hasHorizontalOverflow;
    persistentVertical = metrics.hasVerticalOverflow;
  } else {
    let globalStart = 0;
    for (let index = 0; index < segmentDurations.length; index++) {
      await probeSegment(index, segmentDurations[index], globalStart);
      globalStart += segmentDurations[index];
    }
  }

  return {
    metrics: {
      ...best,
      hasHorizontalOverflow: persistentHorizontal,
      hasVerticalOverflow: persistentVertical
    },
    renderErrors,
    textDefects: [...textDefects].slice(0, MAX_VIDEO_FRAME_FINDINGS)
  };
}

export async function collectVideoFrameFindingsForPage(
  page: Page,
  context: string,
  options: { width: number; height: number; screenshotPath?: string }
): Promise<string[]> {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);

  const contract = await readContractInfo(page);

  // Baseline for the seek/replay check: what segment 1 looks like on a fresh
  // page, before any other segment's render has mutated the DOM.
  let seekBaseline: string[] | null = null;
  let seekProbeTime = 0;
  if (contract.hasContract && contract.segmentDurations.length > 1) {
    const firstProbes = probeTimesForSegmentDuration(contract.segmentDurations[0]);
    seekProbeTime = firstProbes[firstProbes.length - 1];
    const baselineError = await driveRenderSection(page, 0, seekProbeTime, seekProbeTime);
    if (!baselineError) {
      await page.waitForTimeout(50);
      seekBaseline = await collectVisibleTextSnapshot(page);
    }
  }

  const { metrics, renderErrors, textDefects } = await measureBestMetricsAtProbes(
    page,
    options.width,
    options.height,
    contract.hasContract ? contract.segmentDurations : []
  );

  // Seek/replay statefulness: after playing every segment, re-render segment 1
  // and compare. Content that disappeared means a later segment mutated shared
  // DOM that segment 1's render does not rebuild (breaks scrubbing in the viewer).
  const seekDefects: string[] = [];
  if (seekBaseline && seekBaseline.length > 0) {
    const replayError = await driveRenderSection(page, 0, seekProbeTime, seekProbeTime);
    if (!replayError) {
      await page.waitForTimeout(50);
      const after = await collectVisibleTextSnapshot(page);
      const remaining = new Map<string, number>();
      for (const text of after) remaining.set(text, (remaining.get(text) ?? 0) + 1);
      const missing: string[] = [];
      for (const text of seekBaseline) {
        const count = remaining.get(text) ?? 0;
        if (count > 0) {
          remaining.set(text, count - 1);
        } else {
          missing.push(text);
        }
      }
      if (missing.length > 0) {
        const examples = missing.slice(0, 3).map(text => `"${text.slice(0, 40)}"`).join(', ');
        seekDefects.push(
          `seek/replay is stateful: re-rendering segment 1 after playing the whole video loses visible content (${examples}) — a later segment mutates shared DOM (innerHTML swaps, emptied spans) that segment 1's render does not rebuild; __RENDER_SECTION__ must reset that DOM on every call`
        );
      }
    }
  }

  if (options.screenshotPath) {
    if (contract.hasContract && contract.segmentDurations.length > 0) {
      const firstProbes = probeTimesForSegmentDuration(contract.segmentDurations[0]);
      await driveRenderSection(page, 0, firstProbes[firstProbes.length - 1], firstProbes[firstProbes.length - 1]);
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: options.screenshotPath, fullPage: false });
  }
  const findings = formatVideoFrameFindings(metrics, context, options.screenshotPath);
  for (const renderError of renderErrors) {
    findings.push(`[${context}] ${renderError}`);
  }
  for (const textDefect of textDefects) {
    findings.push(`[${context}] ${textDefect}`);
  }
  for (const seekDefect of seekDefects) {
    findings.push(`[${context}] ${seekDefect}`);
  }
  if (findings.length < MAX_VIDEO_FRAME_FINDINGS) {
    const overlapFindings = await collectOverlapFindings(page, {
      maxFindings: MAX_VIDEO_FRAME_FINDINGS - findings.length,
      messageSuffix:
        ' — separate competing absolute layers or clear/hide previous segment content; do not shrink fonts to hide collisions'
    });
    for (const overlap of overlapFindings) {
      findings.push(`[${context}] ${overlap}`);
      if (findings.length >= MAX_VIDEO_FRAME_FINDINGS) break;
    }
  }
  return findings.slice(0, MAX_VIDEO_FRAME_FINDINGS);
}

export function defaultRenderViewport() {
  const config = loadAppConfig();
  return {
    width: config.render.baseWidth,
    height: config.render.baseHeight
  };
}

export async function collectVideoFrameFindings(
  htmlPaths: string[],
  options: { width?: number; height?: number; screenshotDir?: string } = {}
): Promise<string[]> {
  const defaults = defaultRenderViewport();
  const viewport = {
    width: options.width ?? defaults.width,
    height: options.height ?? defaults.height
  };
  const screenshotDir = options.screenshotDir ?? mkdtempSync(path.join(tmpdir(), 'video-frame-qa-'));
  mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const findings: string[] = [];
  try {
    const page = await browser.newPage();
    for (const htmlPath of htmlPaths) {
      const fileName = path.basename(htmlPath);
      const screenshotPath = path.join(screenshotDir, `${path.basename(htmlPath, path.extname(htmlPath))}.png`);
      const fileUrl = pathToFileURL(htmlPath).href;
      await page.goto(fileUrl, { waitUntil: 'load' });
      const pageFindings = await collectVideoFrameFindingsForPage(page, fileName, {
        ...viewport,
        screenshotPath
      });
      findings.push(...pageFindings);
      if (findings.length >= MAX_VIDEO_FRAME_FINDINGS) break;
    }
  } finally {
    await browser.close();
  }
  return findings.slice(0, MAX_VIDEO_FRAME_FINDINGS);
}

export function buildVideoFrameRepairMessage(findings: string[]): string {
  const fileNames = extractFindingBasenames(findings);
  const fileList = fileNames.length > 0 ? fileNames.join(', ') : 'the failing index*.html file(s)';
  return [
    'Fix the video lecture HTML based on frame QA findings.',
    '',
    '--- findings to fix ---',
    ...findings.map(finding => `- ${finding}`),
    '',
    `Edit ${fileList} only. The stage must fill the full render viewport (100vw/100vh or fixed at render resolution scaled to fill).`,
    'For letterboxing findings: the stage root must **expand to fill** the viewport — do not shrink content further. If the content bbox is much smaller than the viewport, set the stage to 100vw×100vh and stretch/relayout primary visuals to use the space. Never apply another nested scale that leaves a tiny box in the corner.',
    'Common root cause: `transform: scale(calc(100vw / N), ...)` is INVALID CSS — scale() cannot take length ratios, the transform silently computes to none, and the fixed-size stage stays small in the top-left corner. If the stage uses that pattern, replace it: set the stage root to `width: 100vw; height: 100vh` and convert fixed pixel coordinates to percentages or vw/vh units, or scale via JS by setting element style transform with a computed number.',
    'A hard-coded stage smaller than the viewport (for example 1280x720 centered in 1920x1080) is the same failure — the stage itself must span the full viewport.',
    'For "literal HTML entity" findings: innerText/textContent do not decode entities — write the real character (\u00f7, \u00d7, \u2212) in JS strings instead of &divide;/&times;.',
    'For "overlapping text elements" or "overlapping content" findings: separate competing absolute layers into clear zones, or fully clear/hide previous segment content in __RENDER_SECTION__ — do not shrink fonts to hide collisions.',
    'For "seek/replay is stateful" findings: the player seeks to arbitrary (segment, time) pairs, so any DOM a segment mutates (innerHTML swaps, emptied spans, appended nodes) must be rebuilt to its canonical state at the start of every __RENDER_SECTION__ call — restore helpers must rebuild unconditionally, not only when an element is missing.',
    'Do not change narration text or __VIDEO_PLAN__ timing.'
  ].join('\n');
}
