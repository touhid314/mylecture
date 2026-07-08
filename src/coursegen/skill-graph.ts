import type { CoursePlan, SkillDependency, SkillGraph, SkillNode } from './types.ts';
import { flattenPlanLectures } from './types.ts';

function inferDifficulty(order: number, total: number, moduleIndex: number, moduleCount: number): number {
  const orderWeight = total <= 1 ? 0 : (order - 1) / (total - 1);
  const moduleWeight = moduleCount <= 1 ? 0 : moduleIndex / (moduleCount - 1);
  return Math.min(5, Math.max(1, Math.round(1 + orderWeight * 3 + moduleWeight)));
}

export function buildSkillGraphFromPlan(plan: CoursePlan): SkillGraph {
  const lectures = flattenPlanLectures(plan);
  const slugToOrder = new Map(lectures.map(lecture => [lecture.slug, lecture.order]));
  const moduleIndexByTitle = new Map<string, number>();
  plan.modules.forEach((module, index) => moduleIndexByTitle.set(module.title, index));

  const skills: SkillNode[] = lectures.map(lecture => {
    const moduleIndex = moduleIndexByTitle.get(lecture.module) ?? 0;
    let prerequisites = lecture.prerequisites ? [...lecture.prerequisites] : [];
    if (!plan.adaptivePath && prerequisites.length === 0 && lecture.order > 1) {
      const previous = lectures.find(row => row.order === lecture.order - 1);
      if (previous) prerequisites = [previous.slug];
    }
    return {
      slug: lecture.slug,
      title: lecture.title,
      objective: lecture.objective,
      order: lecture.order,
      module: lecture.module,
      difficulty: inferDifficulty(lecture.order, lectures.length, moduleIndex, plan.modules.length),
      ...(lecture.review === true ? { review: true } : {}),
      prerequisites,
      assumes: lecture.assumes,
      teaches: lecture.teaches,
      commonMistakes: lecture.commonMistakes,
      remediationTargets: lecture.remediationTargets,
      enrichmentTargets: lecture.enrichmentTargets
    };
  });

  const dependencies: SkillDependency[] = [];
  for (const skill of skills) {
    for (const prereq of skill.prerequisites) {
      dependencies.push({ from: prereq, to: skill.slug });
    }
  }

  dependencies.sort((a, b) => {
    const orderA = slugToOrder.get(a.to) ?? 0;
    const orderB = slugToOrder.get(b.to) ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.from.localeCompare(b.from);
  });

  return {
    courseSlug: plan.slug,
    skills,
    dependencies
  };
}
