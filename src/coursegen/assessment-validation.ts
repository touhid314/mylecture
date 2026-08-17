import { SLUG_RE } from './types.ts';

export type AssessmentChoice = {
  id: string;
  text: string;
};

export type AssessmentItem = {
  id: string;
  prompt: string;
  choices: AssessmentChoice[];
  correctChoiceId: string;
  objectiveId: string;
};

export type AssessmentPhaseBundle = {
  title: string;
  items: AssessmentItem[];
};

export type CourseObjective = {
  id: string;
  statement: string;
  lectureSlug: string;
};

export type CourseAssessments = {
  objectives: CourseObjective[];
  pre: AssessmentPhaseBundle;
  post: AssessmentPhaseBundle;
};

function validateChoice(raw: unknown, path: string): AssessmentChoice {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: choice must be an object`);
  }
  const choice = raw as Record<string, unknown>;
  const id = String(choice.id || '').trim();
  const text = String(choice.text || '').trim();
  if (!id) throw new Error(`${path}: choice id required`);
  if (!text) throw new Error(`${path}: choice text required`);
  return { id, text };
}

function validateItem(raw: unknown, path: string): AssessmentItem {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: item must be an object`);
  }
  const item = raw as Record<string, unknown>;
  const id = String(item.id || '').trim();
  const prompt = String(item.prompt || '').trim();
  const objectiveId = String(item.objectiveId || '').trim();
  const correctChoiceId = String(item.correctChoiceId || '').trim();
  const choicesRaw = item.choices;

  if (!id) throw new Error(`${path}: id required`);
  if (!prompt) throw new Error(`${path}: prompt required`);
  if (!objectiveId) throw new Error(`${path}: objectiveId required`);
  if (!Array.isArray(choicesRaw)) {
    throw new Error(`${path}: choices must be an array`);
  }
  if (choicesRaw.length < 2 || choicesRaw.length > 6) {
    throw new Error(`${path}: choices must have 2-6 entries`);
  }
  if (!correctChoiceId) throw new Error(`${path}: correctChoiceId required`);

  const choices = choicesRaw.map((choice, index) =>
    validateChoice(choice, `${path}.choices[${index}]`)
  );
  const choiceIds = new Set(choices.map(choice => choice.id));
  if (!choiceIds.has(correctChoiceId)) {
    throw new Error(`${path}: correctChoiceId must match a choice id`);
  }
  if (choiceIds.size !== choices.length) {
    throw new Error(`${path}: duplicate choice ids`);
  }

  return { id, prompt, choices, correctChoiceId, objectiveId };
}

function validatePhase(raw: unknown, path: string): AssessmentPhaseBundle {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: phase must be an object`);
  }
  const phase = raw as Record<string, unknown>;
  const title = String(phase.title || '').trim();
  const itemsRaw = phase.items;
  if (!title) throw new Error(`${path}: title required`);
  if (!Array.isArray(itemsRaw)) {
    throw new Error(`${path}: items must be an array`);
  }
  const items = itemsRaw.map((item, index) => validateItem(item, `${path}.items[${index}]`));
  const seenIds = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw new Error(`${path}: duplicate item id ${item.id}`);
    }
    seenIds.add(item.id);
  }
  return { title, items };
}

function validateObjective(raw: unknown, path: string): CourseObjective {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${path}: objective must be an object`);
  }
  const objective = raw as Record<string, unknown>;
  const id = String(objective.id || '').trim();
  const statement = String(objective.statement || '').trim();
  const lectureSlug = String(objective.lectureSlug || '').trim();
  if (!id) throw new Error(`${path}: id required`);
  if (!statement) throw new Error(`${path}: statement required`);
  if (!lectureSlug || !SLUG_RE.test(lectureSlug)) {
    throw new Error(`${path}: invalid lectureSlug`);
  }
  return { id, statement, lectureSlug };
}

export function validateCourseAssessments(raw: unknown): CourseAssessments {
  if (!raw || typeof raw !== 'object') {
    throw new Error('assessments must be an object');
  }
  const doc = raw as Record<string, unknown>;
  const objectivesRaw = doc.objectives;
  if (!Array.isArray(objectivesRaw) || objectivesRaw.length === 0) {
    throw new Error('objectives must be a non-empty array');
  }

  const objectives = objectivesRaw.map((objective, index) =>
    validateObjective(objective, `objectives[${index}]`)
  );
  const objectiveIds = new Set(objectives.map(objective => objective.id));
  if (objectiveIds.size !== objectives.length) {
    throw new Error('duplicate objective ids');
  }

  const pre = validatePhase(doc.pre, 'pre');
  const post = validatePhase(doc.post, 'post');

  for (const item of [...pre.items, ...post.items]) {
    if (!objectiveIds.has(item.objectiveId)) {
      throw new Error(`item ${item.id} references unknown objectiveId ${item.objectiveId}`);
    }
  }

  for (const objectiveId of objectiveIds) {
    const preMatches = pre.items.filter(item => item.objectiveId === objectiveId);
    const postMatches = post.items.filter(item => item.objectiveId === objectiveId);
    if (preMatches.length !== 1) {
      throw new Error(`objective ${objectiveId} must have exactly one pre item (found ${preMatches.length})`);
    }
    if (postMatches.length !== 1) {
      throw new Error(`objective ${objectiveId} must have exactly one post item (found ${postMatches.length})`);
    }
  }

  if (pre.items.length !== objectives.length || post.items.length !== objectives.length) {
    throw new Error('pre and post item counts must match objectives length');
  }

  return { objectives, pre, post };
}

export type AssessmentItemScore = {
  itemId: string;
  selectedChoiceId: string;
  correct: boolean;
  correctChoiceId: string;
  objectiveId: string;
};

export type AssessmentPhaseScore = {
  correct: number;
  total: number;
  results: AssessmentItemScore[];
};

export function scoreAssessmentPhase(
  phase: AssessmentPhaseBundle,
  answers: Record<string, string>
): AssessmentPhaseScore {
  const results = phase.items.map(item => {
    const selectedChoiceId = String(answers[item.id] || '').trim();
    return {
      itemId: item.id,
      selectedChoiceId,
      correct: Boolean(selectedChoiceId) && selectedChoiceId === item.correctChoiceId,
      correctChoiceId: item.correctChoiceId,
      objectiveId: item.objectiveId
    };
  });
  return {
    correct: results.filter(result => result.correct).length,
    total: results.length,
    results
  };
}

export function collectObjectivesFromPlan(plan: {
  modules: Array<{ lectures: Array<{ slug: string; objective: string }> }>;
}) {
  const objectives: CourseObjective[] = [];
  let index = 1;
  for (const module of plan.modules) {
    for (const lecture of module.lectures) {
      objectives.push({
        id: `obj-${String(index).padStart(2, '0')}`,
        statement: lecture.objective,
        lectureSlug: lecture.slug
      });
      index += 1;
    }
  }
  return objectives;
}
