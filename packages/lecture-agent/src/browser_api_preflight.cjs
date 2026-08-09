/**
 * Narrow static browser-API checks for generated lecture scripts.
 *
 * The supported API surface is supplied by the real Playwright browser at
 * validation time. This module deliberately performs only high-confidence
 * inference; ambiguous JavaScript remains the runtime validator's job.
 */

const IDENTIFIER = '[A-Za-z_$][\\w$]*';

function extractClassicInlineScripts(html) {
  const scripts = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(html)) !== null) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/\btype\s*=\s*(["']?)module\1/i.test(attrs)) continue;
    if (match[2] && match[2].trim()) scripts.push(match[2]);
  }
  return scripts;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[right.length];
}

function nearestName(name, available) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of available) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  // Suggestions are advisory only (never auto-applied), so tolerate a wider
  // lexical distance for long method names that share a meaningful suffix.
  const threshold = Math.max(2, Math.floor(name.length * 0.45));
  return bestDistance <= threshold ? best : null;
}

function assignmentEvents(script) {
  const events = [];
  const assignment = new RegExp(`(?:\\b(?:const|let|var)\\s+|\\b)(${IDENTIFIER})\\s*=`, 'g');
  let match;
  while ((match = assignment.exec(script)) !== null) {
    const expression = script.slice(assignment.lastIndex, assignment.lastIndex + 240);
    let kind = 'unknown';
    if (/^\s*(?:[^;\n]+?\.)?getContext\s*\(\s*(["'])2d\1\s*\)/.test(expression)) {
      kind = 'canvas-context-2d';
    } else if (/^\s*(?:\[\s*\]|Array\s*\.\s*from\s*\()/.test(expression)) {
      kind = 'array';
    } else if (/^\s*(?:document\s*\.\s*)?querySelectorAll\s*\(/.test(expression)) {
      kind = 'node-list';
    }
    events.push({ index: match.index, name: match[1], kind });
  }
  return events;
}

function receiverKindAt(events, name, callIndex) {
  let kind = null;
  for (const event of events) {
    if (event.index >= callIndex) break;
    if (event.name === name) kind = event.kind;
  }
  return kind;
}

function assignedReceiverMethods(script) {
  const methods = new Set();
  const assignment = new RegExp(`\\b(${IDENTIFIER})\\s*\\.\\s*(${IDENTIFIER})\\s*=`, 'g');
  let match;
  while ((match = assignment.exec(script)) !== null) {
    methods.add(`${match[1]}.${match[2]}`);
  }
  return methods;
}

function assignedCanvasPrototypeMethods(script) {
  const methods = new Set();
  const assignment = new RegExp(`\\bCanvasRenderingContext2D\\s*\\.\\s*prototype\\s*\\.\\s*(${IDENTIFIER})\\s*=`, 'g');
  let match;
  while ((match = assignment.exec(script)) !== null) methods.add(match[1]);
  return methods;
}

function checkBrowserApiUsage(html, inventory) {
  const findings = [];
  const seen = new Set();
  const canvasMethods = new Set(inventory && Array.isArray(inventory.canvasContext2d)
    ? inventory.canvasContext2d
    : []);

  function add(fingerprint, message) {
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    findings.push(message);
  }

  for (const script of extractClassicInlineScripts(html)) {
    const events = assignmentEvents(script);
    const customMethods = assignedReceiverMethods(script);
    const customPrototypeMethods = assignedCanvasPrototypeMethods(script);
    const calls = new RegExp(`\\b(${IDENTIFIER})\\s*\\.\\s*(${IDENTIFIER})\\s*\\(`, 'g');
    let call;
    while ((call = calls.exec(script)) !== null) {
      const receiver = call[1];
      const method = call[2];
      const receiverKind = receiverKindAt(events, receiver, call.index);

      if (receiverKind === 'canvas-context-2d') {
        if (canvasMethods.has(method)
            || customMethods.has(`${receiver}.${method}`)
            || customPrototypeMethods.has(method)) continue;
        const suggestion = nearestName(method, canvasMethods);
        add(
          `unknown-canvas|${receiver}|${method}`,
          `Browser API preflight failed: unknown CanvasRenderingContext2D method '${method}' called on '${receiver}'.${suggestion ? ` Nearest supported method: '${suggestion}'.` : ''}`,
        );
        continue;
      }

      if ((receiverKind === 'array' || receiverKind === 'node-list')
          && /^(appendChild|replaceChild|insertBefore)$/.test(method)) {
        const label = receiverKind === 'array' ? 'Array' : 'NodeList';
        add(
          `invalid-receiver|${receiverKind}|${receiver}|${method}`,
          `Browser API preflight failed: ${label} '${receiver}' cannot receive Node.${method}(). Call the method on a DOM Node instead.`,
        );
      }
    }
  }

  return findings;
}

module.exports = {
  assignmentEvents,
  checkBrowserApiUsage,
  extractClassicInlineScripts,
  nearestName,
};
