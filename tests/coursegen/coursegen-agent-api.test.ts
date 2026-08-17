import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildVideoGenerationSettings, buildVideoTaskMessage } from '../../src/coursegen/lecture-prompt.ts';
import type { CoursePlan, PlannedLecture } from '../../src/coursegen/types.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function fixture(): { plan: CoursePlan; lecture: PlannedLecture } {
  const lecture: PlannedLecture = {
    slug: 'binary-search',
    title: 'Binary Search',
    objective: 'Use binary search on a sorted list.',
    durationMinutes: 2,
    formats: ['video'],
    promptNotes: ''
  };
  return {
    lecture,
    plan: {
      slug: 'algorithms',
      title: 'Algorithms',
      audience: 'undergraduate',
      intent: 'academic',
      summary: 'A compact algorithms course.',
      description: 'Learn foundational search techniques.',
      modules: [{ title: 'Search', lectures: [lecture] }]
    }
  };
}

describe('Coursegen mylecture-agent API boundary', () => {
  it('keeps generation settings structured and the request at curriculum level', () => {
    const { plan, lecture } = fixture();
    const settings = buildVideoGenerationSettings(plan, lecture);
    assert.equal(settings.generationLength, '2:00');
    assert.equal(settings.aspectRatio, '16:9');
    assert.deepEqual(settings.outputs, { video: true, interactive: false, game: false });
    assert.deepEqual(
      buildVideoGenerationSettings(plan, { ...lecture, formats: ['video', 'interactive', 'game'] }).outputs,
      { video: true, interactive: true, game: true }
    );
    const request = buildVideoTaskMessage(plan, lecture, 'Search');
    assert.match(request, /Learning objective: Use binary search/);
    assert.doesNotMatch(request, /script\.md|narration beat|TTS-friendly|teaching style:/i);
    assert.doesNotMatch(request, /controls|scoring|successCriterion|interactiveSpec|gameSpec/i);
  });

  it('uses the shared HTTP client for agent-owned pipeline stages', () => {
    const source = readFileSync(path.join(ROOT, 'src/coursegen/spawn.ts'), 'utf8');
    assert.match(source, /generateLectureViaAgentApi/);
    assert.match(source, /resolveViaAgentApi/);
    assert.match(source, /renderViaAgentApi/);
    assert.match(source, /outputs: settings\.outputs/);
    assert.doesNotMatch(source, /spawnPracticeGen/);
    assert.doesNotMatch(source, /packages\/lecture-agent/);
    assert.doesNotMatch(source, /mylecture-agent\/src\/lecturegen/);
  });

  it('keeps UI implementation and Coursegen tests in their dedicated folders', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts['coursegen:ui'], /src\/coursegen\/ui\/server\.ts/);
  });

  it('leaves interactive and game implementation to the lecture agent', () => {
    const planner = readFileSync(path.join(ROOT, 'src/coursegen/prompts/planner.md'), 'utf8');
    const extendPlanner = readFileSync(path.join(ROOT, 'src/coursegen/prompts/planner-extend.md'), 'utf8');
    const runner = readFileSync(path.join(ROOT, 'src/coursegen/run-course.ts'), 'utf8');
    assert.doesNotMatch(`${planner}\n${extendPlanner}`, /interactiveSpec|gameSpec|visibleSetup|learnerAction|successCriterion/);
    assert.doesNotMatch(runner, /reviewPractice|runPracticePhase|PracticeRepair|practice-rubric|interactive-practice/);
    assert.equal(existsSync(path.join(ROOT, 'src/coursegen/prompts/interactive-practice.md')), false);
    assert.equal(existsSync(path.join(ROOT, 'src/coursegen/prompts/practice-rubric.md')), false);
  });

  it('keeps the CLI and UI as independent adapters over the Coursegen API', () => {
    const serverSource = readFileSync(path.join(ROOT, 'src/coursegen/ui/server.ts'), 'utf8');
    const cliSource = readFileSync(path.join(ROOT, 'src/coursegen/cli.ts'), 'utf8');
    const apiSource = readFileSync(path.join(ROOT, 'src/coursegen/api.ts'), 'utf8');
    assert.match(serverSource, /executeCoursegenCommand/);
    assert.doesNotMatch(serverSource, /coursegen\/cli|process\.execPath|npm\.cmd/);
    assert.match(cliSource, /coursegenApi/);
    assert.match(apiSource, /export const coursegenApi/);
    assert.match(apiSource, /export async function executeCoursegenCommand/);
    assert.match(apiSource, /deleteCourse\(courseSlug: string\)/);
    assert.match(serverSource, /coursegenApi\.deleteCourse/);
  });
});
