# visual system (mandatory — overrides all topic styling)

follow the thin-line profile exactly. this is a minimalist technical motion graphic.

background: solid dark charcoal matte (#121212) always. no blueprint grids, slate gradients, or alternate base colors.

typography:
- CSS import: `@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');`
- font family: `'JetBrains Mono', 'Fira Code', monospace` for all text — titles, code, labels, counters.
- sizes: main titles 40px bold uppercase (letter-spacing ~0.12em); section headers 32px; body/code text 26px.
- line-height ~1.6; substantial padding/margins so labels, code, and diagrams never overlap.

shapes and geometry:
- ultra-thin 1px crisp vector wireframes only. flat 2D geometric shapes and smooth bezier curves.
- no shadows, no filled panels, no visible container borders, no code-editor chrome, no slide boxes.
- do not use borders to set out content area boxes.
- use spacing, alignment, and linework — not boxes or cards — to organize diagrams.

color palette:
- high-contrast neon/tech accents sparingly: electric blue, neon green, safety red, muted amber, cyan, coral, violet, or teal — pick one primary accent per video.
- low-saturation grey/white for secondary labels and inactive elements.

animation:
- functional 2D motion: lines draw, counters tick, pointers move, packets travel, stack frames push/pop, memory cells fill, nodes pulse, curves form.
- vertical mobile (9:16). one idea per beat.
- top 10% and bottom 20% stay empty for Facebook/Instagram safe zones (background may still be full-bleed).
- cut or zoom every 8–12 seconds; never hold one static frame longer than ~4 seconds.
- animate execution step-by-step; reveal causality through motion, not decoration.
- code and diagrams must be legible on a phone — truncate with `…` rather than shrinking below readable size.

subtitle: each chunk max 7–8 words.

# subject motifs (thin-line native — what to animate, not how to style it)

express CS topics using wireframe primitives only:
- algorithms / data structures → wireframe graph nodes (circles), array cells (thin rects), tree edges (1px lines); highlight active node/edge in accent color
- systems / OS / networking → thin labeled arrows between process/memory/network nodes; no blueprint backgrounds or filled schematic boxes
- databases / distributed systems → entity nodes as open wireframe circles/rects connected by 1px lines; consistency events as timeline ticks
- web / APIs → request/response as labeled arrow paths between endpoint nodes; show JSON keys as mono text lines, not editor panels
- security → attack-path as connected wireframe nodes; warning red accent on the vulnerable step only
- software design → component nodes as thin open rectangles with dependency arrows; pattern name as large uppercase title
- ML / AI → loss curve as 1px bezier path; matrix as wireframe grid with accent cells — one mathematical object at a time, no clipart

do not use: code editor panels, syntax-highlighted IDE chrome, filled ER diagram boxes, endpoint cards, heatmap gradients, layered component boxes with backgrounds, or stock "robot brain" imagery.

# duration

target 45–60 seconds total — never ship under 45 seconds.
use the pipeline rule: ~150 words of narration ≈ 1 minute. for this profile:
- minimum narration: 115 words (≈45s)
- sweet spot: 125–140 words (≈50–56s)
- maximum narration: 150 words (≈60s) — do not exceed unless generation length explicitly asks for longer
count only AUDIO/narration text in script.md and `__VIDEO_PLAN__` segment `.text` fields — not VISUAL lines.
before writing index1.html: count narration words in script.md; if under 115, expand the script (one more concrete step, a sharper payoff, or a stronger close) until you hit the band.
if the prompt includes `generation length:`, treat it as the target duration — convert to words (minutes × 150, or seconds × 2.5) and hit that floor, but stay within 45–60s when that range applies.
prefer slightly too much narration (trim in edits) over a short video that finishes under 40 seconds.

# teaching style

audience: university-level or above — assume intro programming, basic math, and curiosity about how systems really work. use correct terminology (amortized, invariant, deadlock, idempotent, Big-O, stack frame, etc.). do not explain what a loop or variable is; explain the non-obvious mechanism, tradeoff, or failure mode.

optimize for retention first:
- hook in the first 2 seconds: a bug that shouldn't happen, a counterintuitive complexity claim, a "your production app does X" scenario, or a precise question the viewer cannot yet answer.
- open loops: state the puzzle before the answer; tease the payoff ("the reason is not what you think") and deliver it mid-video.
- pattern interrupt every 8–12 seconds — new visual, new question, zoom on one line of code, or a before/after comparison.
- one runnable mental model per video: animate state changing (memory layout, call stack, hash buckets, TCP handshake) so the viewer sees causality, not bullet lists.
- concrete over abstract: name a real constraint (1M QPS, O(n log n), lost packet, stale cache) and show what breaks or what wins.
- mini arc: hook → broken assumption or mystery → mechanism revealed → one durable insight (invariant, rule of thumb, or interview-grade takeaway).
- end with a single sharp line — a rule, a trap to avoid, or a question that makes them want the next reel. no recap montage.
write for sound-off Facebook viewing: key terms, code identifiers, complexity notation, and the payoff line must appear on screen, not only in narration.
pace for 45–60 seconds; cut filler, not substance — do not shorten by dropping the mechanism or the "why."
tone: precise, confident, and dense — respect that the viewer is learning engineering, not watching entertainment disguised as education.
