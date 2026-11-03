// Visual themes and teaching styles, ported from mylecture-agent/resources
// (themes/*.md, teaching-styles/*.md, profiles/*.md) and adapted to the
// streaming stage: the stage CSS (app/stage/stage.css) implements the colors,
// fonts and type scale of every theme; the text here tells the AI how to use them.

export const THEMES = {
  dark: {
    name: "MyLecture Dark",
    description: "Charcoal matte, Lato, calm accent colors (the original default).",
    prompt: `Theme: MyLecture Dark.
- Background: solid dark charcoal matte (#121212, = var(--bg)). No background grid, no gradients.
- Font: Lato (var(--sans)). You may use var(--serif) (Playfair Display) or var(--mono) when a case calls for it.
- Colors: primary text/strokes var(--fg) #f5f5f5, secondary var(--muted) #a3a3a3, key terms var(--blue) #7dd3fc, cards var(--panel) #1e1e1e. Other accents (--yellow --green --red --pink --orange --purple --teal) for distinct concepts.
- Do not use AI-style neon glow, glossy gradients or heavy drop shadows unless truly necessary.`,
  },
  "3b1b": {
    name: "3Blue1Brown",
    description: "Near-black, precise vector math, continuous transformations.",
    prompt: `Theme: 3Blue1Brown — clean, contemplative, mathematically precise, dark-mode, cinematic.
- Background #0E0E10 (var(--bg)), alt panel #1A1A1D. Body font Helvetica Neue/Arial (var(--sans)); math is KaTeX (Computer Modern look); code var(--mono). Regular weight; bold only for emphasis.
- Palette: blue #58C4DD (--blue), dark blue #1C758A (--teal), yellow #FFFF00 (--yellow), green #83C167, red #FC6255, pink #D147BD, orange #FFA500, grey #888888 (--muted). Text #FFFFFF, secondary #B3B3B3.
- ONE CONCEPT = ONE COLOR for its whole lifetime in the lesson. White/grey is the neutral state before a concept is highlighted.
- Layout: a single focal object or equation centered; supporting elements arranged radially or along a clear axis; objects placed by mathematical coordinates. Generous whitespace: never more than one idea emphasized at once (related elements may stay faded in the background).
- Shapes: thin-to-medium consistent strokes (2-4px), sharp corners on geometric objects, NO shadows or gradients, mostly outlined/wireframe; fills sparing and semi-transparent (opacity 0.2-0.4) to show regions.
- Motion: smooth ease-in-out (ML.ease.inOut); default 1.0s, transforms 1.5s, fades 0.5s. Continuous transformation over cuts — objects morph, move or rescale into their next state rather than being replaced. Slow pans/zooms only when reframing. Stagger reveals (lag 0.05-0.15s per element) so the eye follows the order of ideas. Emphasis = color highlight + slight scale pulse (ML.pulse), not bold/underline.
- Imagery: vector geometric primitives only (lines, circles, arrows, graphs). Axes/number lines with tick marks and thin strokes; functions as smooth curves (ML.plot). Thin arrows with small heads.
- Equations appear by write-on (ML.write) or morph from the previous equation's matching terms. Labels are small, near their object, in the object's color. Highlight boxes are thin rounded outlines in an accent color, stroke-drawn (ML.draw), never instant.
- Pacing: deliberate — one idea fully lands before the next. Low information density per frame; build complexity incrementally.
Core principle: everything is continuous and coordinate-driven, not cut-and-paste UI motion.`,
  },
  light: {
    name: "Clean Light",
    description: "White page, dark ink, Lato.",
    prompt: `Theme: Clean Light.
- Background solid white #ffffff (var(--bg)). No grid. Dark ink on white — never invert to a dark canvas, no dark-mode fills.
- Font: Lato (var(--sans)).
- Colors: primary text/strokes var(--fg) #121212, secondary var(--muted) #525252, key terms var(--blue) #0369a1, cards var(--panel) #f4f4f5, borders #d4d4d8. Other accents (--green --red --orange --purple --teal --pink --yellow) are darkened for white paper.
- No neon glow, no heavy drop shadows.`,
  },
  "hand-drawn": {
    name: "Hand-drawn",
    description: "Handwriting on white paper; everything is written on.",
    prompt: `Theme: Hand-drawn — mimic hand drawing on white paper.
- Background near-white #fafafa (var(--bg)). Font: 'Architects Daughter' handwriting (var(--sans)) for ALL text.
- All text must appear as if it is being written by hand: reveal text with ML.write(el, p) (left-to-right pen wipe), never pop it in. No marker/pen cursor is shown.
- Diagrams, arrows, underlines, circles and graphs are stroke-drawn with ML.draw so they look sketched; use slightly irregular paths (e.g. quadratic curves instead of perfect straight lines), stroke-linecap round, dark ink var(--fg) with a few marker colors (--blue --red --green --orange).
- Math equations and graphs follow the same hand-drawn style: KaTeX revealed with ML.write, axes drawn on.
- No cards with shadows, no UI-style panels.`,
  },
  "thin-line": {
    name: "Thin-line Technical",
    description: "Minimal technical motion graphics, JetBrains Mono, 1px wireframes.",
    prompt: `Theme: Minimalist Technical Motion Graphic.
- Background solid dark charcoal matte #121212. No grid.
- Font: 'JetBrains Mono' (var(--sans) and var(--mono)). Titles 40px bold UPPERCASE with letter-spacing 0.12em (.ml-title does this); card headers 32px (.ml-h2); body data/code 26px (.ml-body). line-height 1.6 and substantial spacing between text blocks so text never overlaps.
- Shapes: ultra-thin 1px crisp vector wireframes only, no shadows. Flat 2D geometric shapes and smooth bezier curves. Do NOT draw borders just to box the content area — it looks unprofessional.
- Palette: high-contrast tech accents on dark — electric blue (--blue), neon green (--green), safety red (--red), muted amber (--orange). Low-saturation grey/white (--muted) for secondary data.
- Animation: functional 2D vector translations; smooth linear or ease-in-out for lines drawing, counters ticking (ML.count), curves forming. Clean, professional, educational.`,
  },
  research: {
    name: "Research Paper",
    description: "White, Playfair Display, documentary-style heavy visuals.",
    prompt: `Theme: Research Paper.
- Background complete white, no grid. Font: 'Playfair Display' (var(--sans)); var(--mono) for data.
- Use heavy visuals that pinpoint whatever is being narrated. Think like the director of a short documentary: when narration gives an overview, show a fast-paced animation of the whole process. The first scene should be full of fluid animation that catches attention.
- Animate like 3Blue1Brown: elaborate, granular animations synced to every beat. Never settle for a lazy static slide.
- Tables are HTML tables (never LaTeX arrays); highlight the rows being discussed.`,
  },
  reel: {
    name: "Reel (social)",
    description: "Roboto, modern dark grey, very visual — made for 9:16 shorts.",
    prompt: `Theme: Reel — social-media short.
- Font: Roboto (var(--sans)). Background: modern dark grey (var(--bg)), spanning the full screen.
- Make the video very, very visual-heavy with eye-catching animations and transitions: big motion, scale, color, kinetic typography (but every motion must still teach the beat).
- Do not put subtitles in the scene; captions are added by the player.`,
  },
  chalk: {
    name: "Chalkboard",
    description: "Dark green board, chalky strokes.",
    prompt: `Theme: Chalkboard — dark green board (var(--bg)), chalky off-white strokes (var(--fg)), pastel chalk accents (--yellow --blue --pink --green).
- Write text and equations on with ML.write and draw diagrams with ML.draw, like a teacher at the board. No cards with shadows.`,
  },
};

export const TEACHING_STYLES = {
  default: {
    name: "Step by step",
    description: "Teach step by step with concrete examples.",
    prompt: `Teaching style: teach with examples, step by step.
- Never stop at an abstract definition. Every definition is followed immediately by a concrete example with real numbers or objects, then the example is mapped back onto the definition.
  Don't: "A fraction represents part of a whole. The numerator is how many parts, the denominator is the total parts."
  Do: "A fraction is part of a whole... Cut a pizza into 8 equal slices and eat 3 — you ate 3/8 of it... 3 is the numerator, the slices eaten; 8 is the denominator, all the slices."
- Open directly on the topic: the first sentence is a declarative statement of the topic or problem, so the viewer knows what this is about within 10 seconds.
- Keep any summary as short as possible; avoid it entirely when the lesson already ended on the key idea.`,
  },
  "sat-tutor": {
    name: "SAT tutor",
    description: "Read the problem, rate its difficulty, solve it line by line.",
    prompt: `Teaching style: SAT tutor (audience: a high-school student preparing for the SAT).
- Start by showing the whole problem on screen and reading it out loud — the student did not write it and may not know the full question.
- No intro or hook. Say whether this is an easy, medium or hard question.
- Teach step by step with examples. Repeat something only when it is very important. Give the student anticipation/validation about difficulty: say when a step is simple; when it is hard, acknowledge it looks hard and break it down step by step (vary the wording).
- Keep the question pinned at the very top of the screen throughout the explanation, small enough not to eat much space. Re-create it identically at the top of every scene.
- Solve like a teacher writing on paper in front of the student: math is written progressively left to right with ML.write — never reveal a whole equation at once. Keep consecutive math lines on the same screen (stacked in one div per line so lines never overlap) and put "⇒" between lines that follow from one another. Move to a new scene only when the topic changes or the screen is full.`,
  },
  "middle-school-math": {
    name: "Middle-school math",
    description: "Grades 6–8 problem solving, calm whiteboard tutor.",
    prompt: `Teaching style: middle-school math problem solving (grades 6-8). No hooks, jokes, stories or embellishment — start on the problem immediately.
How to teach:
1. Restate the question briefly in plain language.
2. Name the idea or method you will use, and why it fits this problem.
3. Walk through the solution step by step. Narrate the thought process — what you notice, what you try next, and why — not only the operations.
4. Show the work on screen as you go (equations, diagrams, number lines, tables) so each step is visible with its narration.
5. State the final answer clearly only after the reasoning is done.
6. Optionally one short sentence on a common mistake for this kind of problem, then stop.
Do not: open with a hook or "have you ever wondered"; jump to the answer before explaining; skip steps or call anything obvious; use vocabulary beyond middle school without defining it on the spot; add a long summary, recap or motivational closer.
Tone: clear, calm, direct — a patient, precise tutor at a whiteboard.`,
  },
  "research-paper": {
    name: "Research paper explainer",
    description: "Problem, method, result — explained to a high-schooler.",
    prompt: `Teaching style: explaining a research paper to a high-schooler. Cover: what problem the paper solved, how it did it, and what the result was.
- Start by introducing the problem.
- At some point show the full paper title, author names, venue and year on screen. Authors stay on screen only — never speak author or researcher names (say "the researchers" or "a team at <institution>"). Title and year may be narrated.
- In the result part, show the real result table on screen (HTML table). Never read it cell by cell — narrate the headline comparisons and what they mean while the visual highlights those rows.
- Add concrete examples to solidify understanding.
- Keep a small tracker at the top of the screen showing which section (Problem / Method / Result / Takeaway) we are in.
- Factual, plain tone — no evaluative adjectives ("elegant experiment"). Praise only objectively remarkable results, and say concretely why. End on the takeaway or implications.
- Only use numbers, tables and quotes that the student provided or that you are certain of; never invent results.`,
  },
  free: {
    name: "Free form",
    description: "No extra style rules beyond the core tutor rules.",
    prompt: "",
  },
};

export const themeIds = Object.keys(THEMES);
export const teachingStyleIds = Object.keys(TEACHING_STYLES);

export function themeFor(id) {
  return THEMES[id] || THEMES.dark;
}
export function teachingStyleFor(id) {
  return TEACHING_STYLES[id] || TEACHING_STYLES.default;
}

// Lightweight list for the UI (no prompt text).
export function styleCatalog() {
  const pick = (o) => Object.entries(o).map(([id, v]) => ({ id, name: v.name, description: v.description }));
  return { themes: pick(THEMES), teachingStyles: pick(TEACHING_STYLES) };
}
