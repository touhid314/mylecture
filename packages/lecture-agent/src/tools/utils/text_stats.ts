/**
 * text_stats.ts
 *
 * Utility functions to compute basic document and file textual metrics, such as
 * counting characters, words, and total lines of a given string.
 */
export function text_stats(content: string) {
    return {
        characters: content.length,
        words: content.trim().split(/\s+/).filter(Boolean).length,
        lines: content.split('\n').length
    };
}

export function line_count(content: string): number {
    return content.split('\n').length;
}
