# Course Generator Principles

This file is for agents working on `src/coursegen/`, coursegen prompts, generated course artifacts, and the website surfaces that display generated courses. The goal is to keep coursegen moving toward a general course-building system, not a pile of one-course patches.

## Product Goal

Coursegen should take a topic, audience level, intent, scope, and lecture count, then produce a coherent course that teaches the subject well enough to feel close to publishable after review.

That means every improvement should help many possible courses, audiences, and subjects. Fractions, SQL indexes, history, physics, writing, and professional training should all benefit from the same underlying rules.

## Generalization First

Avoid fixes that only make the current example look better unless the issue is truly isolated to that generated artifact.

Prefer:

- Prompt rules that describe reusable teaching or layout principles.
- Validators and reviewers that catch whole classes of failures.
- Viewer or website behavior that safely supports existing and future generated assets.
- Metadata rules that improve course cards and course pages across subjects.
- Small, stable schemas that make generation intent explicit.

Avoid:

- Prompt lines tied to one topic, such as pizza, fractions, denominators, code, or any specific game mechanic.
- CSS or logic that assumes one generated activity's private class names unless it is a compatibility shim for already-published content.
- Adding more course profiles when an existing audience/intent axis can express the difference.
- Making every course use a game, hook, metaphor, or activity just because one example needed it.
- Hidden rules that future agents cannot discover from docs, prompts, tests, or schema.

If a fix starts with "for this fractions course...", pause and ask whether it belongs in the generated artifact, the prompt, the reviewer, the website viewer, or not at all.

## Prompt Design

Prompts should be subject-agnostic and outcome-driven.

- State what a good course should accomplish, not the exact imagery it should use.
- Use examples only when they clarify the shape of an instruction; examples must not become implicit requirements.
- Keep wording plain. Avoid marketing language such as "engaging", "exciting", "fun", "comprehensive", or "journey" unless the user specifically asks for that tone.
- Ask for concrete learner outcomes: identify, compare, classify, calculate, explain, diagnose, build, revise, or decide.
- Make constraints testable where possible: max activities, visible success criterion, no answer leakage, no nested scroll panes, mobile/desktop behavior.
- Prefer stable contracts over ad hoc prose. If the generated file must expose `#activity-controls`, say that explicitly.

Prompts should not encode subject-specific trivia unless the user provided that subject in the current course plan.

## Course Planning

A course is not a playlist of standalone videos. It should have a learning path.

- Lectures should build on previous lectures and prepare for later ones.
- Each lecture should have one primary job.
- The plan should decide when video is enough, when practice is useful, and when repetition or retrieval justifies a game.
- Short courses should still have a beginning, middle, and end.
- Long courses should be grouped into modules that reflect conceptual dependencies, not arbitrary chunks.

Use the audience and intent profiles as axes:

- `audience` describes learner maturity, reading level, pacing, and assumed background.
- `intent` describes why the learner is taking the course and what type of transfer matters.

Before adding a new profile, ask whether it is really a new axis or just a combination of existing audience plus intent plus scope.

## Interactives and Games

Interactives and games are teaching tools, not decorations.

Use an interactive when the learner benefits from manipulating, comparing, classifying, testing, or practicing something immediately after instruction.

Use a game when repeated attempts improve mastery: retrieval practice, procedural fluency, cumulative review, or applying rules under light pressure.

Do not add a game just to make a lecture feel lively. Do not add an interactive when a reflection prompt, worked example, or video explanation would teach the idea better.

Every interactive/game should make these visible:

- What the learner is trying to do.
- What action to take next.
- What counts as success.
- How feedback will help them improve.
- Where progress is tracked.

Practice and challenge modes must not leak answers before the learner attempts the task.

## Layout and Device Constraints

Generated activities run inside the website lesson player. They are not full standalone web apps.

- Fit the active screen into the embedded player at common laptop sizes.
- Avoid document-level scrollbars and nested scroll panes.
- Use responsive `clamp()` sizing, flexible grids, and compact copy.
- Keep primary controls visible without requiring the learner to hunt below the fold.
- On phones, the website may disable non-video activities. Generated activities should still degrade gracefully, but mobile phone support is not the primary interaction target for complex practice.

If an activity cannot fit, reduce chrome and copy before shrinking the actual learning task.

## Website Display

The website should present generated courses as courses, not as isolated video uploads.

- Course pages should prioritize the learning path and current/next lesson flow.
- Lesson pages should make video reliable everywhere.
- Practice controls should be available where they are usable; it is acceptable to hide or disable complex activities on phones.
- "Up next" should not be buried below the fold when it is the primary navigation action.
- Course cards and summaries should be plain, specific, and outcome-based.

Website compatibility shims are acceptable for already-generated artifacts, but new generation rules should prevent the same problems from recurring.

## Metadata and Copy

Course and lecture metadata is part of the teaching experience.

- `summary`: one plain sentence saying what the course teaches and for whom.
- `description`: concrete outcomes first, then a readable module/lecture outline.
- `objective`: what the learner can do after the lecture.
- `promptNotes`: guidance for the generator, including misconceptions, prerequisites, and what not to over-cover.

Avoid puffery. A useful course description sounds like a syllabus, not a landing-page ad.

## Review and QA

Review should catch reusable failure modes.

Good review criteria include:

- Missing success criterion or progress.
- Answer leakage in practice/challenge screens.
- Unclear next action.
- Activity count mismatch.
- Objective drift.
- Clipped controls, overlap, visible scrollbars, or layout that depends on a very large monitor.
- Metadata that is vague, promotional, or disconnected from the actual course.

When a reviewer misses a problem, improve the reviewer prompt or validator if possible. Do not rely only on manual memory.

## When Editing Generated Artifacts

Sometimes the right fix is to edit one generated course artifact, especially for a published course that needs immediate repair.

When doing so:

1. Decide whether the issue is artifact-specific or systemic.
2. If systemic, also update the generator prompt, reviewer, schema, or website viewer.
3. Keep manual edits minimal and easy to replace on regeneration.
4. Do not let one edited example become the hidden standard for all future courses.

## Agent Checklist

Before finishing coursegen work, ask:

- Does this help future topics, not only the current demo course?
- Did I put the rule in the right layer: plan prompt, lecture prompt, activity prompt, reviewer, schema, website, or artifact?
- Did I avoid subject-specific wording unless the current course subject required it?
- Would another agent understand this decision from docs or code?
- Did I validate the behavior with the narrowest useful command?
- Did I avoid overwriting unrelated generated or website state?
