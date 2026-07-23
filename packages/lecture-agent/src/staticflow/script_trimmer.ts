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
const SCENE_PATTERN = /^\s*#\s*Scene\b.*$/i;

export function countNarrationWords(text: string): number {
    return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length || 0;
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
    maximumNarrationWords = 75,
    minimumNarrationWords = 30
): ScriptBlock[] {
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
