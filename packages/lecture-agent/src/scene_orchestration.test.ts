import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildSceneBriefs,
    checkDeterministicContinuity,
    createFallbackVisualDirection,
    getSceneOrchestrationConfig,
    runIndependentSceneTasks,
    writeImmutableJsonArtifact,
    type SceneTaskState
} from './scene_orchestration.js';

test('scene orchestration keeps retained sequential animation as the default', () => {
    const config = getSceneOrchestrationConfig({} as NodeJS.ProcessEnv);
    assert.equal(config.parallelScenesEnabled, false);
    assert.equal(config.globalLlmConcurrency, 2);
    assert.equal(config.globalBrowserValidationConcurrency, 1);
    assert.equal(config.perJobSceneConcurrency, 2);
});

test('scene briefs carry neighboring intent without prescribing a composition', () => {
    const direction = createFallbackVisualDirection({
        request: 'Explain the water cycle',
        theme: 'Use #102a43 and #38bdf8',
        teachingStyle: 'Clear and visual'
    });
    const briefs = buildSceneBriefs([
        { index: 1, narrationWords: 4, content: '# Scene 1\nN: Water rises as vapor.\nV: Evaporation from an ocean.' },
        { index: 2, narrationWords: 4, content: '# Scene 2\nN: Vapor forms clouds.\nV: Condensation in cool air.' }
    ], direction);
    assert.equal(briefs[0]?.outputPath, 'index1.html');
    assert.match(briefs[0]?.nextConcept || '', /Vapor forms clouds/);
    assert.match(briefs[1]?.previousConcept || '', /Water rises as vapor/);
    assert.doesNotMatch(briefs[0]?.continuityNotes.join('\n') || '', /two-column|cards|grid/i);
    assert.deepEqual(direction.palette, ['#102a43', '#38bdf8']);
});

test('immutable artifacts permit identical replay but reject changed content', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lecturegen-scene-artifact-'));
    try {
        const target = writeImmutableJsonArtifact(workspace, 'visual-direction.json', { concept: 'one' });
        assert.equal(writeImmutableJsonArtifact(workspace, 'visual-direction.json', { concept: 'one' }), target);
        assert.throws(
            () => writeImmutableJsonArtifact(workspace, 'visual-direction.json', { concept: 'two' }),
            /Refusing to overwrite immutable scene artifact/
        );
        assert.throws(() => writeImmutableJsonArtifact(workspace, '../outside.json', {}), /outside the generation workspace/);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('independent scene tasks respect per-job generation and browser validation caps', async () => {
    const direction = createFallbackVisualDirection({ request: 'Test', theme: '', teachingStyle: '' });
    const briefs = buildSceneBriefs([
        { index: 1, narrationWords: 1, content: 'N: One.\nV: One.' },
        { index: 2, narrationWords: 1, content: 'N: Two.\nV: Two.' },
        { index: 3, narrationWords: 1, content: 'N: Three.\nV: Three.' }
    ], direction);
    let activeGeneration = 0;
    let maximumGeneration = 0;
    let activeValidation = 0;
    let maximumValidation = 0;
    const states: SceneTaskState[] = [];
    const delay = () => new Promise<void>(resolve => setTimeout(resolve, 10));
    const results = await runIndependentSceneTasks({
        tasks: briefs,
        config: {
            creativeDirectionEnabled: true,
            parallelScenesEnabled: true,
            optionalSceneHelpersEnabled: false,
            globalLlmConcurrency: 2,
            globalBrowserValidationConcurrency: 1,
            perJobSceneConcurrency: 2
        },
        onTaskState: state => states.push(state),
        generate: async (brief, schedulers) => schedulers.runLlm(async () => {
            activeGeneration += 1;
            maximumGeneration = Math.max(maximumGeneration, activeGeneration);
            await delay();
            activeGeneration -= 1;
            return `<html><body>${brief.index}</body></html>`;
        }),
        validate: async (_brief, html, update, schedulers) => schedulers.runBrowserValidation(async () => {
            activeValidation += 1;
            maximumValidation = Math.max(maximumValidation, activeValidation);
            update('validating');
            await delay();
            activeValidation -= 1;
            return html;
        })
    });
    assert.equal(maximumGeneration, 2);
    assert.equal(maximumValidation, 1);
    assert.deepEqual(results.map(result => result.state.index), [1, 2, 3]);
    assert.equal(states.filter(state => state.status === 'complete').length, 3);
});

test('independent scene failure waits for already-started siblings to settle', async () => {
    const direction = createFallbackVisualDirection({ request: 'Test', theme: '', teachingStyle: '' });
    const briefs = buildSceneBriefs([
        { index: 1, narrationWords: 1, content: 'N: One.\nV: One.' },
        { index: 2, narrationWords: 1, content: 'N: Two.\nV: Two.' }
    ], direction);
    let siblingSettled = false;
    await assert.rejects(runIndependentSceneTasks({
        tasks: briefs,
        config: {
            creativeDirectionEnabled: true,
            parallelScenesEnabled: true,
            optionalSceneHelpersEnabled: false,
            globalLlmConcurrency: 2,
            globalBrowserValidationConcurrency: 1,
            perJobSceneConcurrency: 2
        },
        generate: async (brief, schedulers) => schedulers.runLlm(async () => {
            if (brief.index === 1) throw new Error('scene one failed');
            await new Promise<void>(resolve => setTimeout(resolve, 15));
            siblingSettled = true;
            return '<html></html>';
        }),
        validate: async (_brief, html) => html
    }), /scene one failed/);
    assert.equal(siblingSettled, true);
});

test('deterministic continuity reports aspect-ratio and cross-file id errors', () => {
    const document = (ratio: string, id: string) => `<!doctype html><html><style>:root{--ink:#111}body{font-family:Inter}</style><script>
window.__VIDEO_METADATA__ = { aspectRatio: '${ratio}' };
window.__VIDEO_PLAN__ = [{ id: '${id}', type: 'visual-only', duration: 1 }];
</script></html>`;
    const report = checkDeterministicContinuity([
        { path: 'index1.html', content: document('16:9', 'shared') },
        { path: 'index2.html', content: document('9:16', 'shared') }
    ], '16:9');
    assert.equal(report.passed, false);
    assert.ok(report.findings.some(finding => finding.category === 'aspect-ratio'));
    assert.ok(report.findings.some(finding => finding.category === 'duplicate-id'));
});
