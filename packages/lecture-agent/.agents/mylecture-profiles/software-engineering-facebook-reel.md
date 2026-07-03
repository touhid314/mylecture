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

target 20–30 seconds total at 1.3x TTS — stay within this band. (set voice speed to 1.3x in resolve/render; word counts below assume that.)
at 1.3x: ~195 narration words ≈ 1 minute, or seconds × 3.25 ≈ narration words.
for this profile:
- minimum narration: 65 words (≈20s at 1.3x)
- sweet spot: 70–90 narration words (≈22–28s at 1.3x)
- maximum narration: 98 words (≈30s at 1.3x) — do not exceed unless generation length explicitly asks for longer
count only AUDIO/narration text in script.md and `__VIDEO_PLAN__` segment `.text` fields — not VISUAL lines.
before writing index1.html: count narration words in script.md; if over 98, trim filler; if under 65, add one concrete beat or a sharper payoff until you hit the band.
if the prompt includes `generation length:`, convert to words (seconds × 3.25 at 1.3x TTS) and stay within 20–30s when that range applies.
one mechanism, one insight — cut context you cannot land in 30 seconds.

# teaching style

audience: curious non-experts scrolling Facebook — no CS degree, no bootcamp, no assumed jargon. explain in layman's terms: plain English, everyday analogies, and "what this means for you" framing.

language rules:
- define or replace jargon on first use. say "the app's memory" not "the heap"; "a waiting line" before "a queue"; "a lookup table" before "a hash map."
- if a technical term must stay (API, cache, bug), pair it with a one-beat plain-English gloss in the same sentence.
- narration should sound like a smart friend explaining at a barbecue, not a lecture hall or interview prep.
- on-screen labels use short plain words viewers can read without sound — not raw code identifiers or Big-O notation unless you also spell out the idea in simple text.

optimize for retention first:
- hook in the first 2 seconds: a relatable frustration ("why does your phone slow down?"), a surprising everyday fact, or a simple question anyone can wonder about.
- open loops: state the puzzle in plain words before the answer; deliver the "aha" mid-video.
- pattern interrupt every 5–8 seconds — new visual, a before/after, or one zoomed diagram step.
- one simple mental picture per video: animate one cause-and-effect chain so the viewer sees what happens, not a list of buzzwords.
- concrete over abstract: use real-life examples (password login, slow website, lost message) before any technical label.
- mini arc: hook → common wrong guess → simple true explanation → one takeaway anyone can repeat.
- end with a single sharp plain-English line — a rule of thumb, a myth busted, or a "now you know why." no recap montage.

pace for 20–30 seconds; cut filler, not the simple "why" — if you must drop something, drop extra jargon, not the explanation.
tone: clear, warm, and confident — teach the idea, not the vocabulary.
