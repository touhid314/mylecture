/**
 * Invoke the lecture render hooks for one timeline instant.
 *
 * When both split hooks exist, canvas runs first then HTML (DOM overlays sit above canvas).
 * Legacy pages that only define __RENDER_SECTION__ keep working unchanged.
 */
export function invokeRenderSection(win, segment, localTime, globalTime) {
    const html = win.__HTML_RENDER_SECTION__;
    const ai = win.__AI_RENDER_SECTION__;
    if (typeof html === 'function' && typeof ai === 'function') {
        ai(segment, localTime, globalTime);
        html(segment, localTime, globalTime);
        return;
    }
    const unified = win.__RENDER_SECTION__;
    if (typeof unified === 'function') {
        unified(segment, localTime, globalTime);
        return;
    }
    if (typeof ai === 'function') {
        ai(segment, localTime, globalTime);
        return;
    }
    if (typeof html === 'function') {
        html(segment, localTime, globalTime);
    }
}
/** Browser snippet inlined by build-plan.ts into resolved HTML. */
export function getInvokeRenderSectionSource() {
    return invokeRenderSection.toString();
}
