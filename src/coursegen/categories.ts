/**
 * Catalog subject taxonomy. Keep IDs in sync with
 * mylecture-website/src/lib/course-categories.ts
 */
export const COURSE_CATEGORIES = [
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'computer-science', label: 'Computer Science' },
  { id: 'system-design', label: 'System Design' },
  { id: 'science', label: 'Science & Physics' },
  { id: 'artificial-intelligence', label: 'Artificial Intelligence' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'humanities', label: 'Humanities' },
  { id: 'professional-skills', label: 'Professional Skills' }
] as const;

export type CourseCategoryId = (typeof COURSE_CATEGORIES)[number]['id'];

export const COURSE_CATEGORY_IDS: CourseCategoryId[] = COURSE_CATEGORIES.map(entry => entry.id);

export function isCourseCategoryId(value: unknown): value is CourseCategoryId {
  return typeof value === 'string' && (COURSE_CATEGORY_IDS as string[]).includes(value);
}

export function getCourseCategoryLabel(id: string): string | undefined {
  return COURSE_CATEGORIES.find(entry => entry.id === id)?.label;
}

export function formatCategoriesForPlanner(): string {
  return COURSE_CATEGORIES.map(entry => `- ${entry.id}: ${entry.label}`).join('\n');
}
