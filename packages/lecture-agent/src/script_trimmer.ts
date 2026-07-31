export type ScriptBlock = {
    index: number;
    narrationWords: number;
    content: string;
};

type ScriptBeat = {
    prefix: string[];
    lines: string[];
    narrationWords: number;
    scene: string;
};

const NARRATION_PATTERN = /^\s*N:\s*(.*)$/i;
const VISUAL_PATTERN = /^\s*V:\s*(.*)$/i;
const SCENE_PATTERN = /^\s*#\s*Scene\b.*$/i;
const CARRY_OVER_PATTERN = /^\s*\[carry-over:/i;
const METADATA_LINE_PATTERN = /^\s*(?:#|\[)/;

export type ScriptTrimmerChunkSizes = {
    maximumNarrationWords: number;
    minimumNarrationWords: number;
};

export function getScriptTrimmerChunkSizes(
    configuredValue = process.env.SCRIPT_TRIMMER_CHUNK_SIZE
): ScriptTrimmerChunkSizes {
    const normalized = configuredValue?.replace(/['"]/g, '').trim();
    if (!normalized) {
        throw new Error('SCRIPT_TRIMMER_CHUNK_SIZE is required and must be a positive integer.');
    }
    const maximumNarrationWords = Number(normalized);
    if (!Number.isInteger(maximumNarrationWords) || maximumNarrationWords <= 0) {
        throw new Error('SCRIPT_TRIMMER_CHUNK_SIZE must be a positive integer.');
    }
    return {
        maximumNarrationWords,
        minimumNarrationWords: Math.ceil(maximumNarrationWords / 2)
    };
}

export function countNarrationWords(text: string): number {
    return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function isMetadataLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (SCENE_PATTERN.test(line)) return true;
    if (CARRY_OVER_PATTERN.test(line)) return true;
    if (METADATA_LINE_PATTERN.test(trimmed) && !NARRATION_PATTERN.test(line) && !VISUAL_PATTERN.test(line)) {
        return true;
    }
    return false;
}

function findUnprefixedNarrationLineNumbers(lines: string[]): number[] {
    const lineNumbers: number[] = [];
    for (let index = 0; index < lines.length; index++) {
        if (!VISUAL_PATTERN.test(lines[index])) continue;

        let previous = index - 1;
        while (previous >= 0 && !lines[previous].trim()) previous--;
        if (previous < 0) continue;

        const candidate = lines[previous];
        if (NARRATION_PATTERN.test(candidate) || VISUAL_PATTERN.test(candidate) || isMetadataLine(candidate)) {
            continue;
        }
        lineNumbers.push(previous + 1);
    }
    return [...new Set(lineNumbers)];
}

function formatLineNumberSample(lineNumbers: number[]): string {
    const sample = lineNumbers.slice(0, 3).map(lineNumber => `line ${lineNumber}`).join(', ');
    const remaining = lineNumbers.length - 3;
    return remaining > 0 ? `${sample}, and ${remaining} more` : sample;
}

export function validateAudiovisualScript(script: string): void {
    const normalized = script.replace(/\r\n/g, '\n');
    if (!normalized.trim()) {
        throw new Error('Script validation failed: script is empty.');
    }

    const lines = normalized.split('\n');
    const narrationCount = lines.filter(line => NARRATION_PATTERN.test(line)).length;
    const visualCount = lines.filter(line => VISUAL_PATTERN.test(line)).length;
    const unprefixedNarrationLines = findUnprefixedNarrationLineNumbers(lines);

    if (narrationCount > 0 && unprefixedNarrationLines.length === 0) {
        return;
    }

    if (narrationCount === 0) {
        const details: string[] = [];
        if (visualCount > 0) {
            details.push(`found ${visualCount} V: visual cue(s) but no N: narration cues`);
        } else {
            details.push('found no N: narration cues or V: visual cues');
        }
        if (unprefixedNarrationLines.length > 0) {
            details.push(
                `${unprefixedNarrationLines.length} narration line(s) are missing the required "N: " prefix `
                + `(${formatLineNumberSample(unprefixedNarrationLines)})`
            );
        }
        throw new Error(
            `Script validation failed: ${details.join('; ')}. `
            + 'Each narration beat must use "N: ..." followed by "V: ...". '
            + 'Re-run script generation or edit script.md to add the missing prefixes.'
        );
    }

    throw new Error(
        `Script validation failed: ${unprefixedNarrationLines.length} narration line(s) are missing the required `
        + `"N: " prefix (${formatLineNumberSample(unprefixedNarrationLines)}). `
        + 'Edit script.md or re-run script generation.'
    );
}

function parseBeats(script: string): ScriptBeat[] {
    const beats: ScriptBeat[] = [];
    let pending: string[] = [];
    let current: ScriptBeat | null = null;
    let activeScene = '';

    const finishCurrent = () => {
        if (!current) return;
        while (current.lines.length > 0 && !current.lines[current.lines.length - 1].trim()) current.lines.pop();
        beats.push(current);
        current = null;
    };

    for (const line of script.replace(/\r\n/g, '\n').split('\n')) {
        const sceneMatch = line.match(SCENE_PATTERN);
        if (sceneMatch) {
            finishCurrent();
            while (pending.length > 0 && !pending[pending.length - 1].trim()) pending.pop();
            if (pending.length > 0) pending.push('');
            pending.push(line);
            activeScene = line.trim();
            continue;
        }

        const narrationMatch = line.match(NARRATION_PATTERN);
        if (narrationMatch) {
            finishCurrent();
            current = {
                prefix: pending,
                lines: [line],
                narrationWords: countNarrationWords(narrationMatch[1]),
                scene: activeScene
            };
            pending = [];
            continue;
        }

        if (current) current.lines.push(line);
        else pending.push(line);
    }
    finishCurrent();

    if (beats.length === 0) {
        validateAudiovisualScript(script);
        throw new Error('Script trimmer could not find any N: narration cues.');
    }
    return beats;
}

function renderBlock(beats: ScriptBeat[], continued: boolean): string {
    const lines: string[] = [];
    if (continued && beats[0].scene && !beats[0].prefix.some(line => SCENE_PATTERN.test(line))) {
        lines.push(`[continued scene: ${beats[0].scene}]`, '');
    }
    for (const beat of beats) {
        if (beat.prefix.length > 0) lines.push(...beat.prefix, '');
        lines.push(...beat.lines, '');
    }
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    return lines.join('\n');
}

type Partition = { cost: number; groups: ScriptBeat[][] };

function findPartition(
    beats: ScriptBeat[],
    minimumNarrationWords: number,
    maximumNarrationWords: number,
    allowOversizedGroups: boolean
): ScriptBeat[][] | null {
    const best: Array<Partition | null> = Array.from({ length: beats.length + 1 }, () => null);
    best[0] = { cost: 0, groups: [] };

    for (let start = 0; start < beats.length; start++) {
        const previous = best[start];
        if (!previous) continue;
        let words = 0;
        for (let end = start + 1; end <= beats.length; end++) {
            words += beats[end - 1].narrationWords;
            if (words < minimumNarrationWords) continue;

            const isSingleOversizedBeat = end === start + 1 && words > maximumNarrationWords;
            if (words > maximumNarrationWords && !allowOversizedGroups && !isSingleOversizedBeat) continue;

            // Prefer fewer, fuller in-range blocks. Oversized blocks carry a large
            // penalty and are used only when no all-in-range partition exists.
            const segmentCost = words > maximumNarrationWords
                ? 1000 + Math.pow(words - maximumNarrationWords, 2)
                : 1 + ((maximumNarrationWords - words) / maximumNarrationWords);
            const candidate: Partition = {
                cost: previous.cost + segmentCost,
                groups: [...previous.groups, beats.slice(start, end)]
            };
            if (!best[end] || candidate.cost < best[end]!.cost) best[end] = candidate;
        }
    }
    return best[beats.length]?.groups || null;
}

export function trimScriptByNarration(
    script: string,
    maximumNarrationWords = getScriptTrimmerChunkSizes().maximumNarrationWords,
    minimumNarrationWords = Math.ceil(maximumNarrationWords / 2)
): ScriptBlock[] {
    validateAudiovisualScript(script);
    if (!Number.isInteger(maximumNarrationWords) || maximumNarrationWords <= 0) {
        throw new Error('maximumNarrationWords must be a positive integer.');
    }
    if (!Number.isInteger(minimumNarrationWords) || minimumNarrationWords <= 0 || minimumNarrationWords > maximumNarrationWords) {
        throw new Error('minimumNarrationWords must be a positive integer no greater than maximumNarrationWords.');
    }
    const beats = parseBeats(script);
    const totalWords = beats.reduce((total, beat) => total + beat.narrationWords, 0);
    let groups: ScriptBeat[][];
    if (totalWords < minimumNarrationWords) {
        // An entire short script cannot meet the minimum without inventing narration.
        groups = [beats];
    } else {
        groups = findPartition(beats, minimumNarrationWords, maximumNarrationWords, false)
            || findPartition(beats, minimumNarrationWords, maximumNarrationWords, true)
            || [beats];
    }

    return groups.map((group, index) => ({
        index: index + 1,
        narrationWords: group.reduce((total, beat) => total + beat.narrationWords, 0),
        content: renderBlock(group, index > 0)
    }));
}
