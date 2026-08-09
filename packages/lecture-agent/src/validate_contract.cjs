/**
 * validate_contract.cjs
 *
 * Validates a resolved or source HTML lecture file against the contract specification.
 * It checks globals, video metadata, segment properties, timing parameters, and ensures
 * all variables match standard schemas required by the preview player and renderer.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { checkSceneLayoutKeys } = require('./scene_layout_keys.cjs');
const { checkBrowserApiUsage, extractClassicInlineScripts } = require('./browser_api_preflight.cjs');

const VALIDATION_METRICS_PREFIX = '__VALIDATION_METRICS__ ';

function checkInlineScriptSyntax(htmlContent) {
  const errors = [];
  extractClassicInlineScripts(htmlContent).forEach((script, index) => {
    try {
      new vm.Script(script);
    } catch (err) {
      errors.push(`Static syntax check failed: inline script ${index + 1}: ${err.name || 'Error'}: ${err.message || err}`);
    }
  });
  return errors;
}

function uniqueErrors(errors) {
  const seen = new Set();
  return errors.filter((error) => {
    const key = String(error).replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reliableVmContractErrors(errors) {
  const hasVmScriptFailure = errors.some((error) =>
    error.startsWith('Script execution error before contract globals:')
  );
  if (hasVmScriptFailure) return [];
  return errors.filter((error) =>
    !error.startsWith('__RENDER_SECTION__ execution failed on test call:')
  );
}

function runChecks(windowObj) {
  const errors = [];

  // 1. Globals Check
  if (!windowObj.__VIDEO_METADATA__) {
    errors.push("Missing window.__VIDEO_METADATA__");
  }
  if (!windowObj.__VIDEO_PLAN__) {
    errors.push("Missing window.__VIDEO_PLAN__");
  }
  if (!windowObj.__RENDER_SECTION__) {
    errors.push("Missing window.__RENDER_SECTION__");
  } else if (typeof windowObj.__RENDER_SECTION__ !== 'function') {
    errors.push("window.__RENDER_SECTION__ must be a function");
  }

  if (errors.length > 0) return errors;

  // 2. Metadata Check
  const meta = windowObj.__VIDEO_METADATA__;
  if (typeof meta !== 'object' || meta === null) {
    errors.push("window.__VIDEO_METADATA__ must be an object");
  } else {
    if (typeof meta.contractVersion !== 'string') {
      errors.push("window.__VIDEO_METADATA__.contractVersion must be a string");
    } else if (!/^0\.[0-9]+$/.test(meta.contractVersion) && !/^1\.[0-9]+$/.test(meta.contractVersion)) {
      errors.push(`window.__VIDEO_METADATA__.contractVersion must be a valid version like '0.2' (got '${meta.contractVersion}')`);
    }
    if (typeof meta.title !== 'string' || !meta.title.trim()) {
      errors.push("window.__VIDEO_METADATA__.title must be a non-empty string");
    }
    if (typeof meta.aspectRatio !== 'string') {
      errors.push("window.__VIDEO_METADATA__.aspectRatio must be a string");
    } else if (!/^\d+:\d+$/.test(meta.aspectRatio)) {
      errors.push(`window.__VIDEO_METADATA__.aspectRatio must be in 'width:height' format (got '${meta.aspectRatio}')`);
    }
  }

  // 3. Plan Check
  const plan = windowObj.__VIDEO_PLAN__;
  if (!Array.isArray(plan)) {
    errors.push("window.__VIDEO_PLAN__ must be an array");
  } else if (plan.length === 0) {
    errors.push("window.__VIDEO_PLAN__ must not be empty");
  } else {
    const ids = new Set();
    let hasInteractive = false;
    let hasGame = false;

    plan.forEach((segment, idx) => {
      if (typeof segment !== 'object' || segment === null) {
        errors.push(`Plan item [${idx}] must be an object`);
        return;
      }
      if (typeof segment.id !== 'string' || !segment.id.trim()) {
        errors.push(`Plan item [${idx}] is missing a non-empty string 'id'`);
      } else {
        if (ids.has(segment.id)) {
          errors.push(`Duplicate segment id: '${segment.id}'`);
        }
        ids.add(segment.id);
      }

      const allowedKinds = ["visual-only", "narration+visual", "interactive", "game"];
      if (!allowedKinds.includes(segment.kind)) {
        errors.push(`Plan item [${idx}] ('${segment.id || ''}') has invalid kind: '${segment.kind}'`);
        return;
      }

      if (segment.kind === 'visual-only') {
        if (typeof segment.duration !== 'number' || segment.duration <= 0) {
          errors.push(`visual-only segment '${segment.id}' must have a positive number 'duration'`);
        }
        if (segment.audio !== undefined) {
          errors.push(`visual-only segment '${segment.id}' must not have 'audio'`);
        }
        if (segment.text !== undefined) {
          errors.push(`visual-only segment '${segment.id}' must not have 'text'`);
        }
      }

      if (segment.kind === 'narration+visual') {
        if (typeof segment.text !== 'string' || !segment.text.trim()) {
          errors.push(`narration+visual segment '${segment.id}' must have a non-empty string 'text'`);
        }
        if (typeof segment.audio !== 'string' || !segment.audio.trim()) {
          errors.push(`narration+visual segment '${segment.id}' must have a non-empty string 'audio'`);
        } else if (!segment.audio.endsWith('.wav')) {
          errors.push(`narration+visual segment '${segment.id}' audio path must end with '.wav'`);
        }
        if (segment.duration !== undefined) {
          errors.push(`narration+visual segment '${segment.id}' must not declare 'duration' (derived from audio)`);
        }
      }

      if (segment.kind === 'interactive') {
        hasInteractive = true;
        if (typeof segment.title !== 'string' || !segment.title.trim()) {
          errors.push(`interactive segment '${segment.id}' must have a non-empty string 'title'`);
        }
        if (segment.audio !== undefined) {
          errors.push(`interactive segment '${segment.id}' must not include 'audio'`);
        }
        if (segment.duration !== undefined) {
          errors.push(`interactive segment '${segment.id}' must not include 'duration'`);
        }
        if (segment.text !== undefined) {
          errors.push(`interactive segment '${segment.id}' must not include 'text'`);
        }
      }

      if (segment.kind === 'game') {
        hasGame = true;
        if (typeof segment.title !== 'string' || !segment.title.trim()) {
          errors.push(`game segment '${segment.id}' must have a non-empty string 'title'`);
        }
        if (segment.audio !== undefined) {
          errors.push(`game segment '${segment.id}' must not include 'audio'`);
        }
        if (segment.duration !== undefined) {
          errors.push(`game segment '${segment.id}' must not include 'duration'`);
        }
        if (segment.text !== undefined) {
          errors.push(`game segment '${segment.id}' must not include 'text'`);
        }
      }
    });

    // 4. Interactive functions check
    if (hasInteractive) {
      if (!windowObj.__START_INTERACTIVE__) {
        errors.push("Missing window.__START_INTERACTIVE__ for interactive segments");
      } else if (typeof windowObj.__START_INTERACTIVE__ !== 'function') {
        errors.push("window.__START_INTERACTIVE__ must be a function");
      }
    }

    // 5. Game functions check
    if (hasGame) {
      if (!windowObj.__START_GAME__) {
        errors.push("Missing window.__START_GAME__ for game segments");
      } else if (typeof windowObj.__START_GAME__ !== 'function') {
        errors.push("window.__START_GAME__ must be a function");
      }

      if (!windowObj.__STOP_GAME__) {
        errors.push("Missing window.__STOP_GAME__ for game segments");
      } else if (typeof windowObj.__STOP_GAME__ !== 'function') {
        errors.push("window.__STOP_GAME__ must be a function");
      }
    }
  }

  // 6. Test invocation of __RENDER_SECTION__ to catch runtime/Reference errors
  if (typeof windowObj.__RENDER_SECTION__ === 'function' && Array.isArray(plan) && plan.length > 0) {
    try {
      for (const segment of plan) {
        if (segment && segment.id) {
          windowObj.__RENDER_SECTION__(segment, 0, 0);
        }
      }
    } catch (err) {
      errors.push(`__RENDER_SECTION__ execution failed on test call: ${err.name || 'Error'}: ${err.message || err}`);
    }
  }

  return errors;
}

function validateWithVM(htmlPath) {
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Extract scripts
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  const scriptsToRun = [];

  while ((match = scriptRegex.exec(htmlContent)) !== null) {
    const attrs = match[1];
    const code = match[2];

    const srcMatch = /src\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (srcMatch) {
      const srcPath = srcMatch[1];
      if (!/^https?:\/\//i.test(srcPath) && !/^\/\//.test(srcPath)) {
        try {
          const resolvedSrcPath = path.resolve(path.dirname(htmlPath), srcPath);
          if (fs.existsSync(resolvedSrcPath)) {
            scriptsToRun.push({
              code: fs.readFileSync(resolvedSrcPath, 'utf8'),
              origin: srcPath
            });
          }
        } catch (e) {
          // ignore read errors
        }
      }
    } else if (code.trim()) {
      scriptsToRun.push({
        code,
        origin: 'inline'
      });
    }
  }

  // Set up mock window sandbox
  const sandbox = {
    window: {},
    document: {
      readyState: 'loading',
      createElement: () => ({
        getContext: () => ({}),
        style: {},
      }),
      getElementById: (id) => ({
        innerHTML: '',
        style: {},
        classList: { add: () => {}, remove: () => {} },
        addEventListener: () => {},
      }),
      querySelector: () => ({
        style: {},
        classList: { add: () => {}, remove: () => {} },
        addEventListener: () => {},
      }),
      querySelectorAll: () => [],
      addEventListener: () => {},
      documentElement: { style: {} },
      body: { style: {}, appendChild: () => {}, addEventListener: () => {} },
    },
    console: {
      log: () => {},
      error: () => {},
      warn: () => {},
      info: () => {},
    },
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
    requestAnimationFrame: (cb) => cb(0),
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    performance: {
      now: () => Date.now(),
    },
    location: {
      href: '',
      search: '',
      hash: '',
      pathname: '',
      origin: '',
    },
    navigator: {
      userAgent: 'NodeVM',
    },
    Audio: class {
      play() { return Promise.resolve(); }
      pause() {}
    },
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    Error,
    URL,
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  for (const script of scriptsToRun) {
    try {
      vm.runInNewContext(script.code, sandbox, {
        filename: script.origin,
        timeout: 500
      });
    } catch (err) {
      if (!sandbox.__SCRIPT_ERRORS__) {
        sandbox.__SCRIPT_ERRORS__ = [];
      }
      sandbox.__SCRIPT_ERRORS__.push(`${script.origin}: ${err.name || 'Error'}: ${err.message || err}`);
    }
  }

  const errors = runChecks(sandbox);
  if (
    errors.some((err) => err.startsWith('Missing window.__')) &&
    Array.isArray(sandbox.__SCRIPT_ERRORS__) &&
    sandbox.__SCRIPT_ERRORS__.length > 0
  ) {
    return [
      ...sandbox.__SCRIPT_ERRORS__.slice(0, 5).map((err) => `Script execution error before contract globals: ${err}`),
      ...errors,
    ];
  }

  return errors;
}

async function validateWithPlaywright(htmlPath) {
  const { chromium } = require('playwright');
  const { pathToFileURL } = require('url');

  const browser = await chromium.launch({
    args: ['--allow-file-access-from-files']
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 }
    });
    const preflightStartedAt = Date.now();
    const browserApiInventory = await page.evaluate(() => {
      function prototypeNames(value) {
        const names = new Set();
        let current = value;
        while (current && current !== Object.prototype) {
          for (const key of Reflect.ownKeys(current)) {
            if (typeof key === 'string') names.add(key);
          }
          current = Object.getPrototypeOf(current);
        }
        return [...names];
      }
      return {
        canvasContext2d: prototypeNames(CanvasRenderingContext2D.prototype),
        node: prototypeNames(Node.prototype),
        element: prototypeNames(Element.prototype),
      };
    });
    const apiPreflightErrors = checkBrowserApiUsage(
      fs.readFileSync(htmlPath, 'utf8'),
      browserApiInventory,
    );
    const preflightMs = Date.now() - preflightStartedAt;
    if (apiPreflightErrors.length > 0) {
      return { errors: apiPreflightErrors, preflightMs, temporalMs: 0, preflightOnly: true };
    }

    const temporalStartedAt = Date.now();
    const scriptErrors = [];
    page.on('pageerror', (err) => {
      scriptErrors.push(`${err.name || 'Error'}: ${err.message || err}`);
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 5000 });

    const result = await page.evaluate(() => {
      const renderErrors = [];
      const layoutErrors = [];
      const seenLayoutErrors = new Set();

      // Merged canvas+DOM layout check: instrument 2D ink, collect DOM boxes, flag partial overlaps.
      const canvasInk = [];
      let metricsEpoch = 0;
      let sampleHasPartialAlpha = false;
      let overlapFindingCount = 0;
      let paddingFindingCount = 0;
      let safeZoneFindingCount = 0;

      // Ink / shape recording
      const MIN_INK_ALPHA = 0.22; // overlap + text ink
      const MIN_PANEL_ALPHA = 0.10; // low-alpha header bands (often α≈0.15×reveal)
      const OPAQUE_WIPE_ALPHA = 0.85;
      const MIN_SHAPE_AREA = 2500;
      const MIN_SHAPE_SIDE = 24;
      const MAX_SHAPE_CANVAS_FRAC = 0.8;

      // Collision thresholds
      const CONTAINMENT_RATIO = 0.85;
      const NEST_AREA_RATIO = 1.4; // larger must be meaningfully bigger than smaller
      const OVERLAP_RATIO = 0.28;
      const MIN_OVERLAP_W = 24;
      const MIN_OVERLAP_H = 12;
      const MAX_OVERLAP_FINDINGS = 5;
      const MAX_PADDING_FINDINGS = 5;
      const MAX_SAFE_ZONE_FINDINGS = 5;
      const MAX_LAYOUT_FINDINGS = 10;
      const MAXIMUM_LAYOUT_SAMPLES = 50;
      const MAX_SAMPLES_PER_SEGMENT = 8;
      // Settled-tail sampling: intermediates only in the last quarter of the segment.
      const SETTLE_TAIL_FRAC = 0.75;
      // Mid-transition samples skip overlap (not padding/safe-zone) when non-text canvas ink fades.
      const SETTLE_INK_ALPHA = 0.95;
      const GEOM_QUANT_PX = 20;
      const NUMERIC_TEXT_RE = /^[\d.,%+-]+$/;
      const KATEX_HOST_SKIP_IDS = new Set(['stage', 'htmlLayer', 'canvas']);

      // Padding / safe-zone (theme default.md) — no centering heuristics
      // 5% viewport margin remains theme/author guidance; validator hard-fails clip-only.
      const MIN_PADDING_VIOLATION_PX = 12;
      // Slack is a fraction of the relevant geometric threshold (not a fixed px fudge).
      const EDGE_TOLERANCE_FRAC = 0.1;
      const EDGE_TOLERANCE_MIN_PX = 0.75;
      const PANEL_PAD_FRAC = 0.05;
      const PANEL_PAD_MIN_PX = 24;
      // Table cells use fixed theme insets, not the card max(5%, 24) formula.
      const TABLE_CELL_PAD_H_PX = 16;
      const TABLE_CELL_PAD_V_PX = 12;
      // Exclude true stage-sized fills; allow large content cards (~500² and similar).
      const MAX_PANEL_VIEWPORT_FRAC = 0.55;
      // Table structural chrome is not a padding panel (cells are).
      const TABLE_CHROME_TAGS = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP']);

      function resetCanvasInk() {
        canvasInk.length = 0;
      }

      function beginLayoutSample() {
        metricsEpoch += 1;
        resetCanvasInk();
        sampleHasPartialAlpha = false;
      }

      function parseFontSize(font) {
        const match = String(font || '').match(/(\d+(?:\.\d+)?)px/);
        return match ? Number(match[1]) : 16;
      }

      function instrumentContext2d(ctx, canvas) {
        if (!ctx || ctx.__mlLayoutInk) return;
        ctx.__mlLayoutInk = true;

        let pathBounds = null;
        let cachedMetrics = null;
        let cachedMetricsEpoch = -1;

        function resetPathBounds() {
          pathBounds = null;
        }

        function includePoint(x, y) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          if (!pathBounds) {
            pathBounds = { minX: x, minY: y, maxX: x, maxY: y };
            return;
          }
          pathBounds.minX = Math.min(pathBounds.minX, x);
          pathBounds.minY = Math.min(pathBounds.minY, y);
          pathBounds.maxX = Math.max(pathBounds.maxX, x);
          pathBounds.maxY = Math.max(pathBounds.maxY, y);
        }

        function includeRect(x, y, w, h) {
          includePoint(x, y);
          includePoint(x + w, y);
          includePoint(x, y + h);
          includePoint(x + w, y + h);
        }

        function canvasMetrics() {
          if (cachedMetrics && cachedMetricsEpoch === metricsEpoch) return cachedMetrics;
          const rect = canvas.getBoundingClientRect();
          const iw = canvas.width || rect.width || 1;
          const ih = canvas.height || rect.height || 1;
          cachedMetrics = {
            rect,
            scaleX: rect.width / iw,
            scaleY: rect.height / ih,
            canvasArea: iw * ih
          };
          cachedMetricsEpoch = metricsEpoch;
          return cachedMetrics;
        }

        function mapUserBox(x, y, w, h) {
          const { rect, scaleX, scaleY } = canvasMetrics();
          const transform = ctx.getTransform();
          const corners = [
            new DOMPoint(x, y),
            new DOMPoint(x + w, y),
            new DOMPoint(x, y + h),
            new DOMPoint(x + w, y + h)
          ].map((point) => point.matrixTransform(transform));
          return {
            left: Math.min(...corners.map((c) => c.x)) * scaleX + rect.left,
            right: Math.max(...corners.map((c) => c.x)) * scaleX + rect.left,
            top: Math.min(...corners.map((c) => c.y)) * scaleY + rect.top,
            bottom: Math.max(...corners.map((c) => c.y)) * scaleY + rect.top
          };
        }

        function pushInk(box, label, text, flags) {
          const width = box.right - box.left;
          const height = box.bottom - box.top;
          if (width < 4 || height < 4) return;
          const forOverlap = Boolean(flags && flags.forOverlap);
          const forPanel = Boolean(flags && flags.forPanel);
          if (!forOverlap && !forPanel) return;
          const halfLineWidthPx = Number(flags && flags.halfLineWidthPx);
          canvasInk.push({
            source: 'canvas',
            element: null,
            transparentBackground: true,
            label,
            text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 48),
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            forOverlap,
            forPanel,
            // Screen-space half stroke width for strokeRect ↔ fill matching.
            halfLineWidthPx: Number.isFinite(halfLineWidthPx) && halfLineWidthPx > 0 ? halfLineWidthPx : 0
          });
        }

        /** Project ctx.lineWidth into CSS pixels (transform × canvas→CSS scale). */
        function screenHalfLineWidth() {
          const transform = ctx.getTransform();
          const userScaleX = Math.hypot(transform.a, transform.b) || 1;
          const userScaleY = Math.hypot(transform.c, transform.d) || 1;
          const userScale = (userScaleX + userScaleY) / 2;
          const { scaleX, scaleY } = canvasMetrics();
          const cssScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2 || 1;
          const raw = Number(ctx.lineWidth);
          const lineWidth = Number.isFinite(raw) && raw > 0 ? raw : 1;
          return (lineWidth * userScale * cssScale) / 2;
        }

        function isNearFullCanvas(w, h) {
          const { canvasArea } = canvasMetrics();
          return canvasArea > 0 && Math.abs(w * h) >= canvasArea * MAX_SHAPE_CANVAS_FRAC;
        }

        function shouldRecordShape(w, h) {
          const absW = Math.abs(w);
          const absH = Math.abs(h);
          const area = absW * absH;
          if (area < MIN_SHAPE_AREA) return false;
          if (Math.min(absW, absH) < MIN_SHAPE_SIDE) return false;
          if (isNearFullCanvas(w, h)) return false;
          return true;
        }

        function recordShapeBox(x, y, w, h, label, extras) {
          const alpha = ctx.globalAlpha;
          if (alpha < MIN_PANEL_ALPHA) return;
          if (!shouldRecordShape(w, h)) return;
          const forOverlap = alpha >= MIN_INK_ALPHA;
          if (forOverlap && alpha < SETTLE_INK_ALPHA) sampleHasPartialAlpha = true;
          pushInk(mapUserBox(x, y, w, h), label, '', {
            forOverlap,
            forPanel: true,
            halfLineWidthPx: extras && extras.halfLineWidthPx
          });
        }

        function recordTextBox(text, x, y, kind) {
          const alpha = ctx.globalAlpha;
          if (alpha < MIN_INK_ALPHA) return;
          const raw = String(text || '');
          if (!raw.trim()) return;
          const metrics = ctx.measureText(raw);
          const fontSize = parseFontSize(ctx.font);
          const width = Math.max(metrics.width || 0, fontSize * 0.5);
          const ascent = Number(metrics.actualBoundingBoxAscent);
          const descent = Number(metrics.actualBoundingBoxDescent);
          const hasInkBounds = Number.isFinite(ascent) && Number.isFinite(descent)
            && (ascent > 0 || descent > 0);
          // Prefer real glyph bounds; fall back to em-box estimates only when missing.
          const inkAscent = hasInkBounds ? Math.max(0, ascent) : fontSize * 0.8;
          const inkDescent = hasInkBounds ? Math.max(0, descent) : fontSize * 0.2;
          const height = Math.max(inkAscent + inkDescent, fontSize * 0.5);
          let left = x;
          let top = y;
          const align = ctx.textAlign || 'start';
          const baseline = ctx.textBaseline || 'alphabetic';
          if (align === 'center') left -= width / 2;
          else if (align === 'right' || align === 'end') left -= width;
          if (baseline === 'middle') top -= height / 2;
          else if (baseline === 'top' || baseline === 'hanging') {
            // y is already top
          } else if (baseline === 'bottom' || baseline === 'ideographic') top -= height;
          else top -= inkAscent; // alphabetic / default — use ascent, not a 0.8×height fudge
          pushInk(mapUserBox(left, top, width, height), kind, raw, {
            forOverlap: true,
            forPanel: false
          });
        }

        function wrap(methodName, beforeCall) {
          const original = ctx[methodName];
          if (typeof original !== 'function') return;
          ctx[methodName] = function wrappedCanvasMethod(...args) {
            try {
              beforeCall.apply(this, args);
            } catch (_) {
              // Layout instrumentation must never break lecture drawing.
            }
            return original.apply(this, args);
          };
        }

        wrap('beginPath', () => {
          resetPathBounds();
        });
        wrap('moveTo', (x, y) => {
          includePoint(x, y);
        });
        wrap('lineTo', (x, y) => {
          includePoint(x, y);
        });
        wrap('quadraticCurveTo', (cpx, cpy, x, y) => {
          includePoint(cpx, cpy);
          includePoint(x, y);
        });
        wrap('bezierCurveTo', (cp1x, cp1y, cp2x, cp2y, x, y) => {
          includePoint(cp1x, cp1y);
          includePoint(cp2x, cp2y);
          includePoint(x, y);
        });
        wrap('arc', (x, y, radius) => {
          includeRect(x - radius, y - radius, radius * 2, radius * 2);
        });
        wrap('rect', (x, y, w, h) => {
          includeRect(x, y, w, h);
        });

        wrap('clearRect', (x, y, w, h) => {
          if (isNearFullCanvas(w, h)) resetCanvasInk();
        });

        // Near-full opaque wipe fillRect must clear prior ink (even though we skip recording it as a shape).
        wrap('fillRect', (x, y, w, h) => {
          if (isNearFullCanvas(w, h) && ctx.globalAlpha >= OPAQUE_WIPE_ALPHA) {
            resetCanvasInk();
            return;
          }
          recordShapeBox(x, y, w, h, 'fillRect');
        });
        wrap('strokeRect', (x, y, w, h) => {
          recordShapeBox(x, y, w, h, 'strokeRect', {
            halfLineWidthPx: screenHalfLineWidth()
          });
        });
        if (typeof ctx.roundRect === 'function') {
          wrap('roundRect', (x, y, w, h) => {
            includeRect(x, y, w, h);
          });
        }

        wrap('fill', () => {
          if (!pathBounds) return;
          const w = pathBounds.maxX - pathBounds.minX;
          const h = pathBounds.maxY - pathBounds.minY;
          if (isNearFullCanvas(w, h) && ctx.globalAlpha >= OPAQUE_WIPE_ALPHA) {
            resetCanvasInk();
            resetPathBounds();
            return;
          }
          recordShapeBox(pathBounds.minX, pathBounds.minY, w, h, 'fill');
          resetPathBounds();
        });

        wrap('fillText', (text, x, y) => {
          recordTextBox(text, x, y, 'fillText');
        });
        wrap('strokeText', (text, x, y) => {
          recordTextBox(text, x, y, 'strokeText');
        });
      }

      function instrumentAllCanvases() {
        document.querySelectorAll('canvas').forEach((canvas) => {
          if (canvas.__mlLayoutCanvas) return;
          canvas.__mlLayoutCanvas = true;
          const existing = canvas.getContext('2d');
          if (existing) instrumentContext2d(existing, canvas);
          const originalGetContext = canvas.getContext.bind(canvas);
          canvas.getContext = function patchedGetContext(type, ...rest) {
            const context = originalGetContext(type, ...rest);
            if (type === '2d' && context) instrumentContext2d(context, canvas);
            return context;
          };
        });
      }

      function elementOpacity(element) {
        let opacity = 1;
        let current = element;
        while (current && current !== document.documentElement) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden') return 0;
          opacity *= Number(style.opacity) || 0;
          current = current.parentElement;
        }
        return opacity;
      }

      function clipToAncestors(element, bounds) {
        let left = Math.max(0, bounds.left);
        let top = Math.max(0, bounds.top);
        let right = Math.min(window.innerWidth, bounds.right);
        let bottom = Math.min(window.innerHeight, bounds.bottom);
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
            const clip = parent.getBoundingClientRect();
            left = Math.max(left, clip.left);
            top = Math.max(top, clip.top);
            right = Math.min(right, clip.right);
            bottom = Math.min(bottom, clip.bottom);
          }
        }
        return { left, top, right, bottom };
      }

      function domLabel(element) {
        if (element.id) return `#${element.id}`;
        const tag = element.tagName.toLowerCase();
        const cls = element.classList.length ? `.${element.classList[0]}` : '';
        return `${tag}${cls}`;
      }

      function isTransparentBackground(element) {
        const ownStyle = getComputedStyle(element);
        return ownStyle.backgroundImage === 'none'
          && (ownStyle.backgroundColor === 'transparent' || ownStyle.backgroundColor === 'rgba(0, 0, 0, 0)');
      }

      function resolveKatexHost(katexEl) {
        // Prefer a dedicated labeled host (e.g. #wsEquation); never promote to #stage / body.
        const labeled = katexEl.closest('[id]');
        if (
          labeled
          && labeled !== document.body
          && labeled !== document.documentElement
          && !KATEX_HOST_SKIP_IDS.has(labeled.id)
        ) {
          const hostArea = labeled.getBoundingClientRect();
          const stageArea = window.innerWidth * window.innerHeight;
          if (hostArea.width * hostArea.height < stageArea * 0.45) {
            return labeled;
          }
        }
        return katexEl;
      }

      function collectDomBoxes() {
        const texts = [];
        const panels = [];
        const viewportArea = window.innerWidth * window.innerHeight;

        Array.from(document.querySelectorAll('body *')).forEach((element) => {
          if (element.closest('[data-layout-check="ignore"]')) return;
          if (element.closest('.katex') && !element.classList.contains('katex')) return;

          const textNodes = Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
          const text = textNodes
            .map(node => node.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) return;
          if (elementOpacity(element) < 0.6) return;

          const textRects = textNodes.flatMap((node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return Array.from(range.getClientRects());
          });
          if (textRects.length === 0) return;

          const bounds = {
            left: Math.min(...textRects.map(rect => rect.left)),
            top: Math.min(...textRects.map(rect => rect.top)),
            right: Math.max(...textRects.map(rect => rect.right)),
            bottom: Math.max(...textRects.map(rect => rect.bottom))
          };
          const clipped = clipToAncestors(element, bounds);
          if (clipped.right - clipped.left < 12 || clipped.bottom - clipped.top < 8) return;

          texts.push({
            source: 'dom',
            element,
            transparentBackground: isTransparentBackground(element),
            label: domLabel(element),
            text: text.slice(0, 48),
            left: clipped.left,
            top: clipped.top,
            right: clipped.right,
            bottom: clipped.bottom,
            forOverlap: true,
            forPanel: false
          });
        });

        const seenKatexHosts = new Set();
        document.querySelectorAll('.katex').forEach((element) => {
          if (element.closest('[data-layout-check="ignore"]')) return;
          const host = resolveKatexHost(element);
          if (seenKatexHosts.has(host)) return;
          seenKatexHosts.add(host);
          if (elementOpacity(host) < 0.6) return;
          const rect = host.getBoundingClientRect();
          const clipped = clipToAncestors(host, {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          });
          if (clipped.right - clipped.left < 12 || clipped.bottom - clipped.top < 8) return;
          const text = (
            element.getAttribute('aria-label')
            || host.getAttribute('aria-label')
            || element.textContent
            || ''
          ).replace(/\s+/g, ' ').trim().slice(0, 48);
          texts.push({
            source: 'dom',
            element: host,
            transparentBackground: isTransparentBackground(host),
            label: domLabel(host),
            text: text || 'katex',
            left: clipped.left,
            top: clipped.top,
            right: clipped.right,
            bottom: clipped.bottom,
            forOverlap: true,
            forPanel: false
          });
        });

        // Opaque DOM boxes: overlap material and padding panels.
        Array.from(document.querySelectorAll('body *')).forEach((element) => {
          if (element.closest('[data-layout-check="ignore"]')) return;
          if (element === document.body || element === document.documentElement) return;
          if (KATEX_HOST_SKIP_IDS.has(element.id)) return;
          if (element.tagName === 'CANVAS') return;
          if (TABLE_CHROME_TAGS.has(element.tagName)) return;
          if (isTransparentBackground(element)) return;
          if (elementOpacity(element) < 0.6) return;

          const rect = element.getBoundingClientRect();
          const clipped = clipToAncestors(element, {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom
          });
          const width = clipped.right - clipped.left;
          const height = clipped.bottom - clipped.top;
          const area = width * height;
          if (area < MIN_SHAPE_AREA) return;
          if (Math.min(width, height) < MIN_SHAPE_SIDE) return;
          if (viewportArea > 0 && area >= viewportArea * MAX_SHAPE_CANVAS_FRAC) return;

          panels.push({
            source: 'dom',
            element,
            transparentBackground: false,
            label: domLabel(element),
            text: '',
            left: clipped.left,
            top: clipped.top,
            right: clipped.right,
            bottom: clipped.bottom,
            forOverlap: true,
            forPanel: true
          });
        });

        return { texts, panels };
      }

      function boxArea(box) {
        return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
      }

      function quantizeGeom(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.round(n / GEOM_QUANT_PX) * GEOM_QUANT_PX;
      }

      function quantizeBoxPosition(box) {
        return `${quantizeGeom(box.left)}|${quantizeGeom(box.top)}`;
      }

      function quantizeOverlapSignature(a, b) {
        const left = Math.max(a.left, b.left);
        const top = Math.max(a.top, b.top);
        const right = Math.min(a.right, b.right);
        const bottom = Math.min(a.bottom, b.bottom);
        return `${quantizeGeom(left)}|${quantizeGeom(top)}|${quantizeGeom(right - left)}|${quantizeGeom(bottom - top)}`;
      }

      function isIntentionalNest(a, b, overlapArea) {
        const areaA = boxArea(a);
        const areaB = boxArea(b);
        const smaller = Math.min(areaA, areaB);
        const larger = Math.max(areaA, areaB);
        if (smaller <= 0 || larger <= 0) return false;
        // Nest only when the smaller box is mostly inside a meaningfully larger parent.
        // Same-size competing layers (double-draw) must still fail.
        return (overlapArea / smaller) >= CONTAINMENT_RATIO && larger >= smaller * NEST_AREA_RATIO;
      }

      function formatBox(box) {
        const text = box.text ? ` ("${box.text}")` : '';
        return `${box.source} ${box.label}${text}`;
      }

      function isTextInk(box) {
        return Boolean(box.text && box.text.trim());
      }

      // Float/subpixel slack only — geometric match tolerance comes from stroke half-width.
      const STROKE_FILL_FLOAT_EPSILON_PX = 0.75;
      const CANVAS_FILL_SHAPE_LABELS = new Set(['fillRect', 'fill']);
      const CANVAS_PANEL_SHAPE_LABELS = new Set(['fillRect', 'fill', 'strokeRect']);

      function isCanvasShape(box) {
        return box.source === 'canvas' && !isTextInk(box);
      }

      function edgeTolerancePx(basisPx) {
        const basis = Math.max(0, Number(basisPx) || 0);
        return Math.max(EDGE_TOLERANCE_MIN_PX, basis * EDGE_TOLERANCE_FRAC);
      }

      function boxesNearlyEqual(a, b, tolerancePx) {
        const tol = Math.max(0, Number(tolerancePx) || 0);
        return (
          Math.abs(a.left - b.left) <= tol
          && Math.abs(a.right - b.right) <= tol
          && Math.abs(a.top - b.top) <= tol
          && Math.abs(a.bottom - b.bottom) <= tol
        );
      }

      function isStrokeOnMatchingFill(a, b) {
        if (a.source !== 'canvas' || b.source !== 'canvas') return false;
        if (isTextInk(a) || isTextInk(b)) return false;

        let stroke = null;
        let fill = null;
        if (a.label === 'strokeRect' && CANVAS_FILL_SHAPE_LABELS.has(b.label)) {
          stroke = a;
          fill = b;
        } else if (b.label === 'strokeRect' && CANVAS_FILL_SHAPE_LABELS.has(a.label)) {
          stroke = b;
          fill = a;
        } else {
          return false;
        }

        // Path rects must match within half the stroke width (centered stroke ink).
        const halfStroke = Number(stroke.halfLineWidthPx);
        const tolerancePx = (Number.isFinite(halfStroke) && halfStroke > 0 ? halfStroke : 0.5)
          + STROKE_FILL_FLOAT_EPSILON_PX;
        return boxesNearlyEqual(stroke, fill, tolerancePx);
      }

      /** Same-path double fill/fillRect (wash + solid) is not competing material. */
      function isMatchingFillPair(a, b) {
        if (a.source !== 'canvas' || b.source !== 'canvas') return false;
        if (isTextInk(a) || isTextInk(b)) return false;
        if (!CANVAS_FILL_SHAPE_LABELS.has(a.label) || !CANVAS_FILL_SHAPE_LABELS.has(b.label)) return false;
        return boxesNearlyEqual(a, b, STROKE_FILL_FLOAT_EPSILON_PX);
      }

      function isCanvasPanelShape(box) {
        return isCanvasShape(box) && box.forPanel && CANVAS_PANEL_SHAPE_LABELS.has(box.label);
      }

      function isCanvasPanelUnderText(a, b, overlapArea) {
        let shape;
        let text;
        if (isCanvasPanelShape(a) && isTextInk(b)) {
          shape = a;
          text = b;
        } else if (isCanvasPanelShape(b) && isTextInk(a)) {
          shape = b;
          text = a;
        } else {
          return false;
        }
        // Canvas text or DOM text: ≥85% of text AABB inside panel (padding still applies).
        // Skips the 1.4× nest-area gate that false-flags chips/labels in slightly larger panels.
        const textArea = boxArea(text);
        if (textArea <= 0) return false;
        return (overlapArea / textArea) >= CONTAINMENT_RATIO;
      }

      function pushOverlapFinding(key, message) {
        if (overlapFindingCount >= MAX_OVERLAP_FINDINGS) return false;
        if (layoutErrors.length >= MAX_LAYOUT_FINDINGS) return false;
        if (seenLayoutErrors.has(key)) return false;
        seenLayoutErrors.add(key);
        layoutErrors.push(message);
        overlapFindingCount += 1;
        return true;
      }

      function pushPaddingFinding(key, message) {
        if (paddingFindingCount >= MAX_PADDING_FINDINGS) return false;
        if (layoutErrors.length >= MAX_LAYOUT_FINDINGS) return false;
        if (seenLayoutErrors.has(key)) return false;
        seenLayoutErrors.add(key);
        layoutErrors.push(message);
        paddingFindingCount += 1;
        return true;
      }

      function pushSafeZoneFinding(key, message) {
        if (safeZoneFindingCount >= MAX_SAFE_ZONE_FINDINGS) return false;
        if (layoutErrors.length >= MAX_LAYOUT_FINDINGS) return false;
        if (seenLayoutErrors.has(key)) return false;
        seenLayoutErrors.add(key);
        layoutErrors.push(message);
        safeZoneFindingCount += 1;
        return true;
      }

      function recordMergedLayoutOverlaps(segment, localTime, domBoxes) {
        if (overlapFindingCount >= MAX_OVERLAP_FINDINGS) return;
        if (layoutErrors.length >= MAX_LAYOUT_FINDINGS) return;
        const overlapInk = canvasInk.filter((box) => box.forOverlap);
        const items = [
          ...overlapInk,
          ...(domBoxes.texts || []),
          ...(domBoxes.panels || []).filter((box) => box.forOverlap)
        ];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i];
            const b = items[j];
            if (a.element && b.element) {
              if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
            }
            // Dom↔dom transparent gate: text↔text only (panels always participate).
            if (a.source === 'dom' && b.source === 'dom') {
              const aIsPanel = a.forPanel;
              const bIsPanel = b.forPanel;
              const aIsText = isTextInk(a) && !aIsPanel;
              const bIsText = isTextInk(b) && !bIsPanel;
              if (aIsText && bIsText) {
                if (!a.transparentBackground || !b.transparentBackground) continue;
              }
            }
            // Numeric tick pairs — both-DOM only.
            if (
              a.source === 'dom'
              && b.source === 'dom'
              && a.text
              && b.text
              && NUMERIC_TEXT_RE.test(a.text)
              && NUMERIC_TEXT_RE.test(b.text)
            ) continue;

            const overlapWidth = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapWidth < MIN_OVERLAP_W || overlapHeight < MIN_OVERLAP_H) continue;

            const overlapArea = overlapWidth * overlapHeight;
            const smallerArea = Math.min(boxArea(a), boxArea(b));
            if (smallerArea <= 0) continue;
            if (isStrokeOnMatchingFill(a, b)) continue;
            if (isMatchingFillPair(a, b)) continue;
            if (isCanvasPanelUnderText(a, b, overlapArea)) continue;
            const ratio = overlapArea / smallerArea;
            if (isIntentionalNest(a, b, overlapArea)) continue;
            if (ratio < OVERLAP_RATIO) continue;

            const key = `overlap|${a.source}|${a.label}|${a.text}|${b.source}|${b.label}|${b.text}|${quantizeOverlapSignature(a, b)}`;
            pushOverlapFinding(
              key,
              `segment '${segment.id}' at localTime=${localTime.toFixed(3)}s: ${formatBox(a)} overlaps ${formatBox(b)} by ${Math.round(overlapWidth)}x${Math.round(overlapHeight)}px near (${Math.round(Math.max(a.left, b.left))},${Math.round(Math.max(a.top, b.top))})`
            );
            if (overlapFindingCount >= MAX_OVERLAP_FINDINGS || layoutErrors.length >= MAX_LAYOUT_FINDINGS) return;
          }
        }
      }

      function isTableCellElement(el) {
        return Boolean(el && (el.tagName === 'TD' || el.tagName === 'TH'));
      }

      function nearestTableCell(el) {
        if (!el) return null;
        if (isTableCellElement(el)) return el;
        if (typeof el.closest === 'function') return el.closest('td, th');
        return null;
      }

      function panelBoxFromElement(element) {
        const rect = element.getBoundingClientRect();
        const clipped = clipToAncestors(element, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        });
        return {
          source: 'dom',
          element,
          transparentBackground: isTransparentBackground(element),
          label: domLabel(element),
          text: '',
          left: clipped.left,
          top: clipped.top,
          right: clipped.right,
          bottom: clipped.bottom,
          forOverlap: false,
          forPanel: true
        };
      }

      function tableCellPadForSide(side) {
        return side === 'left' || side === 'right' ? TABLE_CELL_PAD_H_PX : TABLE_CELL_PAD_V_PX;
      }

      function isPaddingContainer(text, shape) {
        // Table cells may pad their own direct text leaves (th/td with text nodes).
        if (text.element && shape.element && text.element === shape.element) {
          if (!isTableCellElement(text.element)) return false;
        }
        const textArea = boxArea(text);
        const shapeArea = boxArea(shape);
        if (textArea <= 0 || shapeArea <= 0) return false;
        if (shapeArea < textArea * NEST_AREA_RATIO) return false;

        const viewportArea = window.innerWidth * window.innerHeight;
        if (viewportArea > 0 && shapeArea >= viewportArea * MAX_PANEL_VIEWPORT_FRAC) return false;

        const overlapWidth = Math.min(text.right, shape.right) - Math.max(text.left, shape.left);
        const overlapHeight = Math.min(text.bottom, shape.bottom) - Math.max(text.top, shape.top);
        if (overlapWidth <= 0 || overlapHeight <= 0) return false;
        const overlapArea = overlapWidth * overlapHeight;

        // Strict nest: text mostly inside the shape.
        if ((overlapArea / textArea) >= CONTAINMENT_RATIO) return true;

        // Header-spill: horizontally contained and starts inside the band, even if it protrudes out.
        const textW = text.right - text.left;
        const bandTol = edgeTolerancePx(Math.min(shape.bottom - shape.top, shape.right - shape.left) * PANEL_PAD_FRAC);
        if (
          textW > 0
          && (overlapWidth / textW) >= CONTAINMENT_RATIO
          && text.top >= shape.top - bandTol
          && text.top < shape.bottom - bandTol
        ) {
          return true;
        }
        return false;
      }

      function findSmallestContainingShape(text, shapes) {
        const candidates = [];
        for (const shape of shapes) {
          if (!isPaddingContainer(text, shape)) continue;
          candidates.push(shape);
        }
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => boxArea(a) - boxArea(b));
        const minArea = boxArea(candidates[0]);
        // Among near-tied smallest panels (morph washes vs real chrome), prefer better horizontal fit.
        const nearSmallest = candidates.filter((shape) => boxArea(shape) <= minArea * 1.25);
        function horizontalFit(shape) {
          return Math.min(text.left - shape.left, shape.right - text.right);
        }
        nearSmallest.sort((a, b) => horizontalFit(b) - horizontalFit(a));
        return nearSmallest[0];
      }

      function recordPaddingAndSafeZone(segment, localTime, domBoxes) {
        if (layoutErrors.length >= MAX_LAYOUT_FINDINGS) return;

        const texts = [
          ...canvasInk.filter((box) => box.forOverlap && isTextInk(box)),
          ...(domBoxes.texts || [])
        ];
        const shapes = [
          ...canvasInk.filter((box) => box.forPanel && !isTextInk(box)),
          ...(domBoxes.panels || [])
        ];

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const clipTol = EDGE_TOLERANCE_MIN_PX;

        function worstSide(entries) {
          let best = null;
          for (const entry of entries) {
            if (!best || entry.px > best.px) best = entry;
          }
          return best;
        }

        // 1) Viewport safe-zone: text only (skip numeric tick-like labels).
        // Hard-fail only when text extends outside the viewport (clip-only).
        for (const box of texts) {
          if (safeZoneFindingCount >= MAX_SAFE_ZONE_FINDINGS || layoutErrors.length >= MAX_LAYOUT_FINDINGS) return;
          if (box.text && NUMERIC_TEXT_RE.test(box.text)) continue;

          const intrusions = [];
          if (box.left < -clipTol) {
            intrusions.push({ side: 'left', px: Math.ceil(-box.left) });
          }
          if (box.top < -clipTol) {
            intrusions.push({ side: 'top', px: Math.ceil(-box.top) });
          }
          if (box.right > vw + clipTol) {
            intrusions.push({ side: 'right', px: Math.ceil(box.right - vw) });
          }
          if (box.bottom > vh + clipTol) {
            intrusions.push({ side: 'bottom', px: Math.ceil(box.bottom - vh) });
          }
          const worst = worstSide(intrusions);
          if (!worst) continue;
          const key = `safe-zone|${box.source}|${box.label}|${box.text}|${worst.side}|${quantizeBoxPosition(box)}`;
          pushSafeZoneFinding(
            key,
            `segment '${segment.id}' at localTime=${localTime.toFixed(3)}s: safe-zone: ${formatBox(box)} is clipped outside the viewport by ${worst.px}px (${worst.side})`
          );
        }

        if (paddingFindingCount >= MAX_PADDING_FINDINGS) return;

        // 2) Panel inset / protrusion relative to smallest containing shape.
        //    Table cell text uses the nearest td/th with theme cell pads (16h / 12v).
        for (const text of texts) {
          if (paddingFindingCount >= MAX_PADDING_FINDINGS || layoutErrors.length >= MAX_LAYOUT_FINDINGS) return;

          const cell = nearestTableCell(text.element);
          let panel = null;
          let useTableCellPad = false;

          if (cell) {
            panel = shapes.find((shape) => shape.element === cell) || panelBoxFromElement(cell);
            useTableCellPad = true;
          } else {
            panel = findSmallestContainingShape(text, shapes);
            if (!panel) continue; // no containing panel → safe-zone only
            if (isTableCellElement(panel.element)) useTableCellPad = true;
          }

          const panelW = panel.right - panel.left;
          const panelH = panel.bottom - panel.top;
          const cardPad = Math.max(PANEL_PAD_FRAC * Math.min(panelW, panelH), PANEL_PAD_MIN_PX);
          const padForSide = (side) => (useTableCellPad ? tableCellPadForSide(side) : cardPad);
          const protrudeTolForSide = (side) => edgeTolerancePx(padForSide(side));

          const protrusions = [];
          const leftGross = panel.left - text.left;
          const leftTol = protrudeTolForSide('left');
          if (leftGross > leftTol) {
            protrusions.push({ side: 'left', px: Math.ceil(leftGross - leftTol) });
          }
          const topGross = panel.top - text.top;
          const topTol = protrudeTolForSide('top');
          if (topGross > topTol) {
            protrusions.push({ side: 'top', px: Math.ceil(topGross - topTol) });
          }
          const rightGross = text.right - panel.right;
          const rightTol = protrudeTolForSide('right');
          if (rightGross > rightTol) {
            protrusions.push({ side: 'right', px: Math.ceil(rightGross - rightTol) });
          }
          const bottomGross = text.bottom - panel.bottom;
          const bottomTol = protrudeTolForSide('bottom');
          if (bottomGross > bottomTol) {
            protrusions.push({ side: 'bottom', px: Math.ceil(bottomGross - bottomTol) });
          }
          const worstProtrusion = worstSide(protrusions);
          if (worstProtrusion && worstProtrusion.px > MIN_PADDING_VIOLATION_PX) {
            const key = `panel-protrude|${text.source}|${text.label}|${text.text}|${panel.source}|${panel.label}|${worstProtrusion.side}|${quantizeBoxPosition(text)}`;
            pushPaddingFinding(
              key,
              `segment '${segment.id}' at localTime=${localTime.toFixed(3)}s: panel padding: ${formatBox(text)} protrudes from panel ${formatBox(panel)} by ${worstProtrusion.px}px (${worstProtrusion.side})`
            );
            continue;
          }

          const padShortfalls = [];
          const insets = [
            { side: 'left', inset: text.left - panel.left },
            { side: 'top', inset: text.top - panel.top },
            { side: 'right', inset: panel.right - text.right },
            { side: 'bottom', inset: panel.bottom - text.bottom }
          ];
          for (const { side, inset } of insets) {
            const pad = padForSide(side);
            const edgeTol = edgeTolerancePx(pad);
            const grossShortfall = pad - inset;
            if (grossShortfall > edgeTol) {
              padShortfalls.push({ side, px: Math.ceil(grossShortfall - edgeTol) });
            }
          }
          const worstPad = worstSide(padShortfalls);
          if (!worstPad || worstPad.px <= MIN_PADDING_VIOLATION_PX) continue;
          const key = `panel-pad|${text.source}|${text.label}|${text.text}|${panel.source}|${panel.label}|${worstPad.side}|${quantizeBoxPosition(text)}`;
          pushPaddingFinding(
            key,
            `segment '${segment.id}' at localTime=${localTime.toFixed(3)}s: panel padding: ${formatBox(text)} short of required pad by ${worstPad.px}px (${worstPad.side}) vs ${formatBox(panel)}`
          );
        }
      }

      function buildSampleLocalTimes(duration, budget) {
        const endTime = Math.max(0, duration - (1 / 30));
        const endRounded = Number(endTime.toFixed(6));
        const sampleBudget = Math.max(2, Math.min(MAX_SAMPLES_PER_SEGMENT, budget || 2));
        const times = new Set();

        function add(t) {
          if (!Number.isFinite(t) || t < 0) return;
          // Near-end always maps to the stable end tick so toFixed rounding cannot drop it.
          if (endTime <= 0 || t >= endTime - 1e-9) {
            times.add(endTime > 0 ? endRounded : 0);
            return;
          }
          times.add(Math.min(Number(t.toFixed(6)), endRounded));
        }

        // Settled anchors: segment start and end (no default mid-morph probes).
        add(0);
        if (endTime > 0) add(endTime);

        // Test fixtures may request one mid probe (before settled tail) to exercise partial-alpha skip.
        const meta = window.__VIDEO_METADATA__;
        if (meta && meta.layoutMidProbe && endTime > 0) {
          const mid = endTime * 0.5;
          const tailStart = endTime * SETTLE_TAIL_FRAC;
          if (mid < tailStart - 1e-9) add(mid);
        }

        // Extra samples only in the settled tail (last quarter) when budget allows.
        if (sampleBudget > 2 && endTime > 0) {
          const tailStart = endTime * SETTLE_TAIL_FRAC;
          const extraSlots = sampleBudget - 2;
          for (let i = 1; i <= extraSlots; i++) {
            const frac = SETTLE_TAIL_FRAC + ((1 - SETTLE_TAIL_FRAC) * i) / (extraSlots + 1);
            const t = endTime * frac;
            if (t >= tailStart && t < endTime - 1e-9) add(t);
          }
        }

        const sorted = [...times].sort((a, b) => a - b);
        if (sorted.length <= sampleBudget) return sorted;

        // Trim: always keep 0 + end; when layoutMidProbe, also keep mid; fill remainder from late tail samples.
        const required = new Set([0]);
        if (endRounded > 0) required.add(endRounded);
        if (meta && meta.layoutMidProbe && endTime > 0) {
          const mid = endTime * 0.5;
          const tailStart = endTime * SETTLE_TAIL_FRAC;
          if (mid < tailStart - 1e-9) {
            required.add(Math.min(Number(mid.toFixed(6)), endRounded));
          }
        }
        const remaining = sorted.filter((t) => !required.has(t));
        remaining.sort((a, b) => b - a);
        const picked = [...required];
        for (const t of remaining) {
          if (picked.length >= sampleBudget) break;
          picked.push(t);
        }
        return picked.sort((a, b) => a - b);
      }

      instrumentAllCanvases();

      if (typeof window.__RENDER_SECTION__ === 'function' && Array.isArray(window.__VIDEO_PLAN__)) {
        const plan = window.__VIDEO_PLAN__.filter(segment => segment && segment.id);
        const planLength = Math.max(plan.length, 1);
        // Global sample budget (~50): distribute per segment; always ≥2 (0+end), ≤8.
        const samplesPerSegment = Math.max(
          2,
          Math.min(MAX_SAMPLES_PER_SEGMENT, Math.floor(MAXIMUM_LAYOUT_SAMPLES / planLength))
        );
        const resolvedEntries = Array.isArray(window.__RESOLVED_TIMELINE__?.videoTimeline)
          ? window.__RESOLVED_TIMELINE__.videoTimeline
          : [];
        const resolvedById = new Map(resolvedEntries.map(entry => [entry.sectionId, entry]));
        let estimatedGlobalStart = 0;

        for (const segment of plan) {
          const resolvedEntry = resolvedById.get(segment.id);
          const narrationWords = typeof segment.text === 'string'
            ? segment.text.trim().split(/\s+/).filter(Boolean).length
            : 0;
          const duration = Number(resolvedEntry?.duration)
            || Number(segment.resolvedDuration)
            || Number(segment.duration)
            || (narrationWords > 0 ? Math.max(2.5, narrationWords / 2.65) : 2.5);
          const globalStart = Number.isFinite(Number(resolvedEntry?.start))
            ? Number(resolvedEntry.start)
            : estimatedGlobalStart;

          const segmentEndTime = Math.max(0, duration - (1 / 30));
          for (const localTime of buildSampleLocalTimes(duration, samplesPerSegment)) {
            try {
              beginLayoutSample();
              window.__RENDER_SECTION__(segment, localTime, globalStart + localTime);
              const domBoxes = collectDomBoxes();
              const isSettledAnchor = localTime <= 0 || localTime >= segmentEndTime - 1e-9;
              const settledTailStart = segmentEndTime * SETTLE_TAIL_FRAC;
              const isSettledTail = localTime >= settledTailStart;
              if (isSettledAnchor || isSettledTail || !sampleHasPartialAlpha) {
                recordMergedLayoutOverlaps(segment, localTime, domBoxes);
              }
              recordPaddingAndSafeZone(segment, localTime, domBoxes);
            } catch (err) {
              renderErrors.push(
                `segment '${segment.id}' at localTime=${localTime.toFixed(3)}s: ${err.name || 'Error'}: ${err.message || err}`
              );
              break;
            }
          }
          estimatedGlobalStart = globalStart + duration;
        }
      }

      return {
        __VIDEO_METADATA__: window.__VIDEO_METADATA__,
        __VIDEO_PLAN__: window.__VIDEO_PLAN__,
        __RENDER_SECTION_TYPE__: typeof window.__RENDER_SECTION__,
        __START_INTERACTIVE_TYPE__: typeof window.__START_INTERACTIVE__,
        __START_GAME_TYPE__: typeof window.__START_GAME__,
        __STOP_GAME_TYPE__: typeof window.__STOP_GAME__,
        renderErrors,
        layoutErrors
      };
    });

    const windowObj = {
      __VIDEO_METADATA__: result.__VIDEO_METADATA__,
      __VIDEO_PLAN__: result.__VIDEO_PLAN__,
      __RENDER_SECTION__: result.__RENDER_SECTION_TYPE__ === 'function' ? (() => {}) : undefined,
      __START_INTERACTIVE__: result.__START_INTERACTIVE_TYPE__ === 'function' ? (() => {}) : undefined,
      __START_GAME__: result.__START_GAME_TYPE__ === 'function' ? (() => {}) : undefined,
      __STOP_GAME__: result.__STOP_GAME_TYPE__ === 'function' ? (() => {}) : undefined,
    };

    const errors = runChecks(windowObj);
    for (const renderError of result.renderErrors || []) {
      errors.push(`__RENDER_SECTION__ execution failed during temporal sample: ${renderError}`);
    }
    for (const layoutError of result.layoutErrors || []) {
      errors.push(`Temporal layout check failed: ${layoutError}`);
    }
    if (errors.some((err) => err.startsWith('Missing window.__')) && scriptErrors.length > 0) {
      return {
        errors: [
        ...scriptErrors.slice(0, 5).map((err) => `Browser script error before contract globals: ${err}`),
        ...errors,
        ],
        preflightMs,
        temporalMs: Date.now() - temporalStartedAt,
        preflightOnly: false,
      };
    }

    return {
      errors,
      preflightMs,
      temporalMs: Date.now() - temporalStartedAt,
      preflightOnly: false,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const validationStartedAt = Date.now();
  const htmlPath = process.argv[2];
  if (!htmlPath) {
    console.error("Usage: node validate_contract.cjs <path_to_html>");
    process.exit(1);
  }

  const absolutePath = path.resolve(htmlPath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  let errors = [];
  let mode = 'vm';
  const timings = {
    staticMs: 0,
    vmMs: 0,
    browserPreflightMs: 0,
    playwrightMs: 0,
    totalMs: 0,
  };

  // 0. Static SCENE_LAYOUT key check (Node-only, before / alongside runtime checks).
  // Prefer listing these first so repair agents see "X is referenced but not defined"
  // instead of only a TypeError on `.x`.
  const staticStartedAt = Date.now();
  const htmlContent = fs.readFileSync(absolutePath, 'utf8');
  const sceneLayoutErrors = checkSceneLayoutKeys(htmlContent);
  const syntaxErrors = checkInlineScriptSyntax(htmlContent);
  timings.staticMs = Date.now() - staticStartedAt;

  // Syntax is a deterministic prerequisite. Do not spend a browser launch or
  // produce misleading layout findings for source that cannot execute.
  if (syntaxErrors.length > 0) {
    errors = [...sceneLayoutErrors, ...syntaxErrors];
    timings.totalMs = Date.now() - validationStartedAt;
    console.log(`${VALIDATION_METRICS_PREFIX}${JSON.stringify(timings)}`);
    console.error('HTML contract validation failed (mode: static):');
    uniqueErrors(errors).forEach(err => console.error(` - ${err}`));
    process.exit(1);
  }

  // 1. Run VM check first (extremely fast, ~10ms)
  let vmErrors = [];
  const vmStartedAt = Date.now();
  try {
    vmErrors = validateWithVM(absolutePath);
  } catch (vmErr) {
    // If VM execution itself crashes, fallback to trying Playwright
    vmErrors = ["VM compilation/execution failed"];
  }
  timings.vmMs = Date.now() - vmStartedAt;

  // 2. Always run the browser check. Runtime animation errors often occur only
  // after localTime advances and cannot be detected by the lightweight VM mocks.
  const playwrightStartedAt = Date.now();
  try {
    const playwrightResult = await validateWithPlaywright(absolutePath);
    timings.browserPreflightMs = playwrightResult.preflightMs;
    timings.playwrightMs = playwrightResult.temporalMs;
    errors = uniqueErrors([
      ...reliableVmContractErrors(vmErrors),
      ...playwrightResult.errors,
    ]);
    mode = playwrightResult.preflightOnly ? 'browser-api-preflight' : 'playwright';
  } catch (pwErr) {
    const details = (pwErr.message || String(pwErr)).split('\n')[0].trim();
    errors = [
      ...reliableVmContractErrors(vmErrors),
      `Playwright validation failed: ${details}. (Run 'npx playwright install' to ensure browser binaries are downloaded)`,
    ];
    timings.playwrightMs = Date.now() - playwrightStartedAt;
  }

  // Prepend static SCENE_LAYOUT findings so they always appear in failure output.
  if (sceneLayoutErrors.length > 0) {
    errors = [...sceneLayoutErrors, ...errors];
  }

  errors = uniqueErrors(errors);
  timings.totalMs = Date.now() - validationStartedAt;
  console.log(`${VALIDATION_METRICS_PREFIX}${JSON.stringify(timings)}`);

  if (errors.length > 0) {
    console.error(`HTML contract validation failed (mode: ${mode}):`);
    errors.forEach(err => console.error(` - ${err}`));
    process.exit(1);
  }

  console.log(`HTML contract validation passed (mode: ${mode})`);
  process.exit(0);
}

main().catch(err => {
  console.error("Unexpected error in contract validator:", err.message);
  process.exit(1);
});
