/* Version 1: fit visible static text once, after the DOM and fonts settle. */
(() => {
  window.__ML_TEXT_READY__ = false;

  function fitText(element) {
    const lines = Number(element.getAttribute('data-ml-lines'));
    if (!Number.isFinite(lines) || lines <= 0 || !element.getClientRects().length) return;
    const initial = getComputedStyle(element);
    const size = parseFloat(initial.fontSize);
    if (!Number.isFinite(size) || size <= 0 || element.clientWidth <= 0) return;
    const minimum = Number(element.getAttribute('data-ml-min-font-size'));
    const floor = element.hasAttribute('data-ml-min-font-size') && Number.isFinite(minimum) && minimum > 0
      ? Math.min(size, Math.max(18, minimum)) : size;

    function fits() {
      const style = getComputedStyle(element);
      let lineHeight = parseFloat(style.lineHeight);
      // Measure the inherited font's normal line height without altering the copy.
      if (style.lineHeight === 'normal' || !Number.isFinite(lineHeight)) {
        const probe = document.createElement('span');
        probe.textContent = 'M';
        Object.assign(probe.style, {
          position: 'absolute', visibility: 'hidden', whiteSpace: 'nowrap',
          font: style.font, lineHeight: 'normal', padding: '0', border: '0'
        });
        element.appendChild(probe);
        lineHeight = probe.getBoundingClientRect().height;
        probe.remove();
      }
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      return element.scrollWidth <= element.clientWidth + 1
        && element.scrollHeight <= lineHeight * lines + padding + 1
        && element.scrollHeight <= element.clientHeight + 1;
    }

    element.removeAttribute('data-ml-overflow');
    if (fits()) return;
    if (floor < size) {
      let low = floor, high = size;
      element.style.fontSize = `${floor}px`;
      if (fits()) {
        for (let i = 0; i < 12; i++) {
          const middle = (low + high) / 2;
          element.style.fontSize = `${middle}px`;
          if (fits()) low = middle;
          else high = middle;
        }
        element.style.fontSize = `${low}px`;
      }
    }
    if (!fits()) element.setAttribute('data-ml-overflow', '');
  }

  async function initialize() {
    try {
      await document.fonts.ready;
      document.querySelectorAll('[data-ml-text][data-ml-lines]').forEach(fitText);
    } finally {
      window.__ML_TEXT_READY__ = true;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    void initialize();
  }
})();
