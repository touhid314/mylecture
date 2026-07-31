export type RenderSectionWindow = {
    __RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
    __HTML_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
    __AI_RENDER_SECTION__?: (item: unknown, localTime: number, globalTime: number) => void;
};
/**
 * Invoke the lecture render hooks for one timeline instant.
 *
 * When both split hooks exist, canvas runs first then HTML (DOM overlays sit above canvas).
 * Legacy pages that only define __RENDER_SECTION__ keep working unchanged.
 */
export declare function invokeRenderSection(win: RenderSectionWindow, segment: unknown, localTime: number, globalTime: number): void;
/** Browser snippet inlined by build-plan.ts into resolved HTML. */
export declare function getInvokeRenderSectionSource(): string;
