import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { buildSkillGraphFromPlan } from './skill-graph.ts';
import {
  detectCycles,
  validateAdaptiveCoursePlan,
  validateCoursePlan,
  validateSkillGraph,
  type CoursePlan,
  type SkillGraph
} from './types.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const algebraPlanPath = path.join(repoRoot, 'gens/courses/algebra-foundations/course-plan.json');
const algebraGraphPath = path.join(repoRoot, 'gens/courses/algebra-foundations/skillGraph.json');

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function assertAdaptiveLectureFormats(plan: CoursePlan) {
  for (const lecture of plan.modules.flatMap(module => module.lectures)) {
    assert.ok(lecture.formats.includes('video'), `${lecture.slug} missing video`);
    if (lecture.review === true) {
      assert.ok(lecture.formats.includes('game'), `${lecture.slug} review missing game`);
      assert.ok(lecture.prerequisites && lecture.prerequisites.length > 0, `${lecture.slug} review missing prerequisites`);
    } else {
      assert.ok(lecture.formats.includes('interactive'), `${lecture.slug} missing interactive`);
    }
    assert.ok(lecture.durationMinutes === 2 || lecture.durationMinutes === 3, `${lecture.slug} duration out of range`);
  }
}

function assertPrerequisitesExist(graph: SkillGraph) {
  const slugs = new Set(graph.skills.map(skill => skill.slug));
  for (const skill of graph.skills) {
    for (const prereq of skill.prerequisites) {
      assert.ok(slugs.has(prereq), `${skill.slug} prerequisite missing: ${prereq}`);
    }
  }
}

test('algebra seed plan validates as adaptive course', () => {
  const raw = loadJson<unknown>(algebraPlanPath);
  const plan = validateAdaptiveCoursePlan(raw);
  assert.equal(plan.slug, 'algebra-foundations');
  assert.equal(plan.adaptivePath, true);
  assert.equal(plan.modules.reduce((count, module) => count + module.lectures.length, 0), 24);
  assertAdaptiveLectureFormats(plan);
  const legacyGameNodes = plan.modules
    .flatMap(module => module.lectures)
    .filter(lecture => lecture.review !== true && lecture.formats.includes('game'));
  assert.ok(legacyGameNodes.length >= 1, 'algebra fixture should still allow game on non-review nodes');
});

test('legacy adaptive plan with game on non-review node still validates', () => {
  const raw = loadJson<CoursePlan>(algebraPlanPath);
  const plan = validateAdaptiveCoursePlan(raw);
  const withGame = plan.modules
    .flatMap(module => module.lectures)
    .find(lecture => lecture.formats.includes('game') && lecture.review !== true);
  assert.ok(withGame, 'expected algebra fixture to include a non-review node with game');
});

test('algebra seed skillGraph has no cycles and valid prerequisites', () => {
  const graph = loadJson<SkillGraph>(algebraGraphPath);
  validateSkillGraph(graph, validateCoursePlan(loadJson(algebraPlanPath)));
  assert.equal(detectCycles(graph.skills), null);
  assertPrerequisitesExist(graph);
});

test('buildSkillGraphFromPlan matches algebra seed graph slugs and deps', () => {
  const plan = validateAdaptiveCoursePlan(loadJson(algebraPlanPath));
  const built = buildSkillGraphFromPlan(plan);
  const seed = loadJson<SkillGraph>(algebraGraphPath);

  assert.equal(built.skills.length, seed.skills.length);
  assert.deepEqual(
    built.skills.map(skill => skill.slug).sort(),
    seed.skills.map(skill => skill.slug).sort()
  );
  assert.deepEqual(built.dependencies, seed.dependencies);
});

test('non-adaptive course plan still validates without adaptive constraints', () => {
  const gitPlanPath = path.join(repoRoot, 'gens/courses/professional-git-and-collaborative-workflows/course-plan.json');
  const plan = validateCoursePlan(loadJson(gitPlanPath));
  assert.equal(plan.adaptivePath, undefined);
  const longLecture = plan.modules[0].lectures[0];
  assert.ok(longLecture.durationMinutes > 3);
});

test('adaptive plans require explicit prerequisites arrays', () => {
  const raw = loadJson<CoursePlan>(algebraPlanPath);
  const broken = structuredClone(raw);
  delete broken.modules[0].lectures[1].prerequisites;

  assert.throws(
    () => validateAdaptiveCoursePlan(broken),
    /explicit prerequisites array/
  );
});

test('adaptive review nodes require video, game, and non-empty prerequisites', () => {
  const reviewNode = {
    slug: 'section-review',
    title: 'Section review',
    objective: 'Consolidate module skills',
    durationMinutes: 2,
    review: true,
    formats: ['video', 'game'] as const,
    prerequisites: ['entry-skill'],
    promptNotes: 'Review node',
    gameSpec: {
      mission: 'Review all module skills',
      visibleSetup: 'Show mission',
      learnerAction: 'Answer mixed questions from every module skill',
      controls: ['check'],
      feedback: 'Score updates',
      successCriterion: 'Score at least 70 out of 100'
    }
  };
  const plan = validateAdaptiveCoursePlan({
    title: 'Test',
    slug: 'test-adaptive-review',
    audience: 'middle',
    intent: 'practice',
    categoryId: 'mathematics',
    adaptivePath: true,
    summary: 'Test',
    description: 'Test',
    modules: [{ title: 'M1', lectures: [reviewNode] }]
  });
  assert.equal(plan.modules[0].lectures[0].review, true);
  const graph = buildSkillGraphFromPlan(plan);
  assert.equal(graph.skills[0].review, true);
});

test('adaptive review node without game fails validation', () => {
  assert.throws(
    () => validateAdaptiveCoursePlan({
      title: 'Test',
      slug: 'test-adaptive-review-fail',
      audience: 'middle',
      intent: 'practice',
      categoryId: 'mathematics',
      adaptivePath: true,
      summary: 'Test',
      description: 'Test',
      modules: [{
        title: 'M1',
        lectures: [{
          slug: 'bad-review',
          title: 'Bad review',
          objective: 'Consolidate',
          durationMinutes: 2,
          review: true,
          formats: ['video', 'interactive'],
          prerequisites: ['entry'],
          promptNotes: ''
        }]
      }]
    }),
    /review nodes must include video and game/
  );
});

test('adaptive review node with interactive format fails validation', () => {
  assert.throws(
    () => validateAdaptiveCoursePlan({
      title: 'Test',
      slug: 'test-adaptive-review-interactive',
      audience: 'middle',
      intent: 'practice',
      categoryId: 'mathematics',
      adaptivePath: true,
      summary: 'Test',
      description: 'Test',
      modules: [{
        title: 'M1',
        lectures: [{
          slug: 'bad-review',
          title: 'Bad review',
          objective: 'Consolidate',
          durationMinutes: 2,
          review: true,
          formats: ['video', 'interactive', 'game'],
          prerequisites: ['entry'],
          promptNotes: '',
          gameSpec: {
            mission: 'Review',
            visibleSetup: 'Setup',
            learnerAction: 'Practice all skills',
            controls: ['check'],
            feedback: 'Feedback',
            successCriterion: 'Score at least 70 out of 100'
          }
        }]
      }]
    }),
    /must not include interactive/
  );
});

test('adaptive review node without gameSpec fails validation', () => {
  assert.throws(
    () => validateAdaptiveCoursePlan({
      title: 'Test',
      slug: 'test-adaptive-review-no-spec',
      audience: 'middle',
      intent: 'practice',
      categoryId: 'mathematics',
      adaptivePath: true,
      summary: 'Test',
      description: 'Test',
      modules: [{
        title: 'M1',
        lectures: [{
          slug: 'bad-review',
          title: 'Bad review',
          objective: 'Consolidate',
          durationMinutes: 2,
          review: true,
          formats: ['video', 'game'],
          prerequisites: ['entry'],
          promptNotes: ''
        }]
      }]
    }),
    /must include gameSpec/
  );
});

test('adaptive skill graph does not infer previous lecture as prerequisite', () => {
  const raw = loadJson<CoursePlan>(algebraPlanPath);
  const small = structuredClone(raw);
  small.modules = [
    {
      title: 'Portable nodes',
      lectures: [
        {
          ...small.modules[0].lectures[0],
          slug: 'entry',
          title: 'Entry',
          prerequisites: []
        },
        {
          ...small.modules[0].lectures[1],
          slug: 'independent',
          title: 'Independent',
          prerequisites: []
        }
      ]
    }
  ];

  const graph = buildSkillGraphFromPlan(validateAdaptiveCoursePlan(small));
  assert.deepEqual(graph.skills.map(skill => [skill.slug, skill.prerequisites]), [
    ['entry', []],
    ['independent', []]
  ]);
  assert.deepEqual(graph.dependencies, []);
});

test('detectCycles finds a simple cycle', () => {
  const cycle = detectCycles([
    { slug: 'a', title: 'A', objective: 'A', order: 1, module: 'M', difficulty: 1, prerequisites: ['c'] },
    { slug: 'b', title: 'B', objective: 'B', order: 2, module: 'M', difficulty: 2, prerequisites: ['a'] },
    { slug: 'c', title: 'C', objective: 'C', order: 3, module: 'M', difficulty: 3, prerequisites: ['b'] }
  ]);
  assert.ok(cycle);
  assert.ok(cycle!.includes('a'));
});
