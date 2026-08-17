import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppConfig, resolveConfigPath } from '../config.ts';

/** mylecture package root — not process.cwd() (UI/jobs can start from the workspace). */
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** IDE one-offs (`config.agent.generationDir`, often gens/outputs). */
export function getGenerationRoot() {
  const config = loadAppConfig(rootDir);
  return resolveConfigPath(rootDir, config.agent.generationDir);
}

/** Coursegen catalog artifacts stay under gens/, not the IDE output dir. */
function getCoursegenRoot() {
  return path.join(rootDir, 'gens');
}

export function getCoursesRoot() {
  return path.join(getCoursegenRoot(), 'courses');
}

export function getSourcesRoot() {
  return path.join(getCoursegenRoot(), 'sources');
}

export function getClassesRoot() {
  return path.join(getCoursegenRoot(), 'classes');
}

export function getSourceDir(sourceSlug: string) {
  return path.join(getSourcesRoot(), sourceSlug);
}

export function sourceManifestPath(sourceSlug: string) {
  return path.join(getSourceDir(sourceSlug), 'source-manifest.json');
}

export function sourceSectionsDir(sourceSlug: string) {
  return path.join(getSourceDir(sourceSlug), 'sections');
}

export function getCourseDir(courseSlug: string) {
  return path.join(getCoursesRoot(), courseSlug);
}

export function coursePlanPath(courseSlug: string) {
  return path.join(getCourseDir(courseSlug), 'course-plan.json');
}

export function courseStatePath(courseSlug: string) {
  return path.join(getCourseDir(courseSlug), 'course-state.json');
}

export function assessmentsPath(courseSlug: string) {
  return path.join(getCourseDir(courseSlug), 'assessments.json');
}

export function getClassDir(classSlug: string) {
  return path.join(getClassesRoot(), classSlug);
}

export function classPlanPath(classSlug: string) {
  return path.join(getClassDir(classSlug), 'class-plan.json');
}

export function ensureClassDir(classSlug: string) {
  const dir = getClassDir(classSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function lectureFolderPath(courseSlug: string, folderName: string) {
  return path.join(getCourseDir(courseSlug), folderName);
}

export function ensureCourseDir(courseSlug: string) {
  const dir = getCourseDir(courseSlug);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function websiteRoot() {
  return path.resolve(rootDir, '../mylecture-website');
}

export function lectureFolderName(order: number, slug: string) {
  const padded = String(order).padStart(2, '0');
  return `${padded}-${slug}`;
}

export function isIndexHtmlName(name: string) {
  return /^index.*\.html$/i.test(name);
}

export function isResolvedHtmlName(name: string) {
  return /^resolved.*\.html$/i.test(name);
}

export function resolvedSiblingPathForIndex(filePath: string) {
  const basename = path.basename(filePath);
  const suffix = basename.slice('index'.length, -'.html'.length);
  return path.join(path.dirname(filePath), `resolved${suffix}.html`);
}

export function ffmpegConcatPath(filePath: string) {
  return path.resolve(filePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
}
