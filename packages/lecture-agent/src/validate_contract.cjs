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
    const page = await browser.newPage();
    const scriptErrors = [];
    page.on('pageerror', (err) => {
      scriptErrors.push(`${err.name || 'Error'}: ${err.message || err}`);
    });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 5000 });

    const result = await page.evaluate(() => {
      let renderError = null;
      try {
        if (typeof window.__RENDER_SECTION__ === 'function' && Array.isArray(window.__VIDEO_PLAN__)) {
          for (const segment of window.__VIDEO_PLAN__) {
            if (segment && segment.id) {
              window.__RENDER_SECTION__(segment, 0, 0);
            }
          }
        }
      } catch (err) {
        renderError = `${err.name || 'Error'}: ${err.message || err}`;
      }

      return {
        __VIDEO_METADATA__: window.__VIDEO_METADATA__,
        __VIDEO_PLAN__: window.__VIDEO_PLAN__,
        __RENDER_SECTION_TYPE__: typeof window.__RENDER_SECTION__,
        __START_INTERACTIVE_TYPE__: typeof window.__START_INTERACTIVE__,
        __START_GAME_TYPE__: typeof window.__START_GAME__,
        __STOP_GAME_TYPE__: typeof window.__STOP_GAME__,
        renderError
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
    if (result.renderError) {
      errors.push(`__RENDER_SECTION__ execution failed on browser test call: ${result.renderError}`);
    }
    if (errors.some((err) => err.startsWith('Missing window.__')) && scriptErrors.length > 0) {
      return [
        ...scriptErrors.slice(0, 5).map((err) => `Browser script error before contract globals: ${err}`),
        ...errors,
      ];
    }

    if (errors.length === 0) {
      try {
        const layoutResult = await page.evaluate(async () => {
          const errors = [];
          const warnings = [];
          
          const plan = window.__VIDEO_PLAN__;
          const render = window.__RENDER_SECTION__;
          if (!Array.isArray(plan) || typeof render !== 'function') {
            return { errors, warnings };
          }
          
          const W = window.innerWidth;
          const H = window.innerHeight;
          const isMobile = (W / H) < 0.7;
          
          function isVisible(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
            return true;
          }
          
          function isBackground(el) {
            let current = el;
            while (current) {
              const id = (current.id || '').toLowerCase();
              const className = (current.className || '');
              const classStr = typeof className === 'string' ? className.toLowerCase() : '';
              if (
                id.includes('background') || id.includes('bg-') || id.includes('decor') || id.includes('watermark') ||
                classStr.includes('background') || classStr.includes('bg-') || classStr.includes('decor') || classStr.includes('watermark')
              ) {
                return true;
              }
              const style = window.getComputedStyle(current);
              if (parseInt(style.zIndex, 10) < 0) {
                return true;
              }
              current = current.parentElement;
            }
            return false;
          }

          function hasDirectText(el) {
            return Array.from(el.childNodes).some(node => {
              return node.nodeType === Node.TEXT_NODE && node.nodeValue.trim().length > 0;
            });
          }
          
          function checkCurrentLayout(segmentId) {
            const elements = Array.from(document.querySelectorAll('body *'));
            const leafContentElements = [];
            
            for (const el of elements) {
              if (!isVisible(el)) continue;
              
              const tag = el.tagName.toLowerCase();
              const isVisual = ['img', 'canvas', 'video', 'svg', 'code', 'pre', 'button', 'input'].includes(tag);
              const isText = hasDirectText(el);
              
              if (isVisual || isText) {
                leafContentElements.push({
                  el,
                  tag,
                  isText,
                  isVisual,
                  isBg: isBackground(el),
                  rect: el.getBoundingClientRect(),
                  text: el.innerText ? el.innerText.trim().substring(0, 30) : ''
                });
              }
            }
            
            // 1. Check for Viewport Overflow
            for (const item of leafContentElements) {
              if (item.isBg) continue;
              
              if (item.rect.left < -3 || item.rect.right > W + 3) {
                const desc = item.isText ? `text "${item.text}"` : `<${item.tag}>`;
                errors.push(`[Segment: ${segmentId}] Content overflows screen horizontally: ${desc} (left: ${item.rect.left.toFixed(0)}, right: ${item.rect.right.toFixed(0)}, screen width: ${W})`);
              }
            }
            
            // 2. Safe Zone Violations (only for mobile 9:16 aspect ratio)
            if (isMobile) {
              const topSafeLine = H * 0.10;
              const bottomSafeLine = H * 0.80;
              
              for (const item of leafContentElements) {
                if (item.isBg) continue;
                
                if (item.rect.top < topSafeLine) {
                  const desc = item.isText ? `text "${item.text}"` : `<${item.tag}>`;
                  warnings.push(`[Segment: ${segmentId}] Content is in the top safe zone (top 10%): ${desc} (top: ${item.rect.top.toFixed(0)}, safe limit: ${topSafeLine.toFixed(0)})`);
                }
                if (item.rect.bottom > bottomSafeLine) {
                  const desc = item.isText ? `text "${item.text}"` : `<${item.tag}>`;
                  warnings.push(`[Segment: ${segmentId}] Content is in the bottom safe zone (bottom 20%): ${desc} (bottom: ${item.rect.bottom.toFixed(0)}, safe limit: ${bottomSafeLine.toFixed(0)})`);
                }
              }
            }
          }
          
          let globalTime = 0;
          for (const segment of plan) {
            const renderTime = 1.0;
            try {
              render(segment, renderTime, globalTime + renderTime);
              await new Promise(resolve => requestAnimationFrame(resolve));
              checkCurrentLayout(segment.id);
            } catch (e) {
              errors.push(`Failed to render segment ${segment.id}: ${e.message}`);
            }
            globalTime += segment.duration || 5;
          }
          
          return { errors, warnings };
        });

        if (layoutResult.warnings && layoutResult.warnings.length > 0) {
          console.warn("\nLayout warnings:");
          layoutResult.warnings.forEach(warn => console.warn(` - ${warn}`));
        }

        if (layoutResult.errors && layoutResult.errors.length > 0) {
          errors.push(...layoutResult.errors);
        }
      } catch (layoutErr) {
        errors.push(`Failed to execute timeline layout validation: ${layoutErr.message}`);
      }
    }

    return errors;
  } finally {
    await browser.close();
  }
}

async function main() {
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

  // 1. Run VM check first (extremely fast, ~10ms)
  try {
    errors = validateWithVM(absolutePath);
  } catch (vmErr) {
    // If VM execution itself crashes, fallback to trying Playwright
    errors = ["VM compilation/execution failed"];
  }

  // 2. If VM check found errors, fallback to Playwright to see if dynamic execution resolves them
  if (errors.length > 0) {
    try {
      const playwrightErrors = await validateWithPlaywright(absolutePath);
      errors = playwrightErrors;
      mode = 'playwright';
    } catch (pwErr) {
      // If Playwright fails or isn't installed/configured, stick with VM errors
    }
  }

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
