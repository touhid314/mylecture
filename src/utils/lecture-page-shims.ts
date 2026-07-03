// Browser-side helpers injected during resolve/render when lecture HTML omits them.
export const lecturePageShimScript = String.raw`(() => {
  if (typeof window.renderMath === 'function') return;

  window.renderMath = function renderMath(target, mathExpression) {
    const katex = window.katex;
    if (!katex) return;

    let el = null;
    let latex = '';

    if (typeof target === 'string' && typeof mathExpression === 'string') {
      el = document.getElementById(target);
      latex = mathExpression;
    } else if (typeof target === 'string' && mathExpression && mathExpression.nodeType === 1) {
      latex = target;
      el = mathExpression;
    } else if (target && target.nodeType === 1 && typeof mathExpression === 'string') {
      el = target;
      latex = mathExpression;
    } else {
      return;
    }

    if (!el) return;
    katex.render(latex, el, { throwOnError: false, displayMode: false });
  };
})();`;

export const lecturePageShimHtml = `<script id="lecture-page-shims">\n${lecturePageShimScript}\n</script>`;
