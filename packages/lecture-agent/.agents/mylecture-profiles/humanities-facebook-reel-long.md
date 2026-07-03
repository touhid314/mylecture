# visual system (mandatory — overrides all topic styling)

create vertical history and humanities videos for curious viewers who enjoy documentary explainers, period dramas, and "one thing you didn't know" stories — but make everything as generated HTML visuals. do not assume real-life footage, photos, stock video, or camera shots are available.

visual direction:

- use a cinematic documentary look built from HTML/CSS/SVG/canvas: dark archival background, elegant line illustrations, and period-appropriate accent color.
- make the story the hero through stylized generated graphics: timelines, simplified maps, family trees, cause-and-effect chains, manuscript frames, quote plaques, and labeled figure constellations.
- favor premium animated explainer graphics made in HTML: ink-drawn routes, ticking date markers, expanding empires on maps, succession lines, bracketed quotations, and before/after era comparisons.
- do not imitate or mention any specific channel branding, logos, watermarks, or exact visual templates. capture the general appeal: literate, dramatic, accessible, and phone-readable.

ignore `.agents/mylecture-themes/dark-theme.md` font sizes when this profile is active — use only the sizes below.

background: solid dark charcoal matte (#121212) always. no bright white slides, cheesy parchment textures, or photographic effects.
full-bleed ambient structure is welcome: faint map grids, latitude/longitude curves, manuscript ruling lines, or subtle period wallpaper across the entire frame (including safe zones). background linework stays low-contrast; hero illustrations sit above it.

typography:

- CSS import: `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400&family=Source+Sans+3:wght@400;600;700&display=swap');`
- titles and quoted lines: `'Cormorant Garamond', 'Georgia', serif` — main titles 40px bold (title case or small caps, letter-spacing ~0.06em); quote lines 32px italic.
- dates, places, names, and labels: `'Source Sans 3', 'Helvetica Neue', sans-serif` — section headers 32px semibold; body/labels 26px.
- line-height ~1.6; pad labels so they never collide with each other or with subtitles.

shapes and illustration:

- clean 1px line illustrations — maps, timelines, brackets, arrows, crests, and document frames. flat 2D geometry with smooth curves.
- no shadows, no filled panels, no visible container borders, no slide boxes.
- diagrams should feel alive and story-rich — many strokes, markers, routes, ticks, and accent highlights per frame.

color palette:

- pick one period-appropriate accent per video: imperial purple, laurel green, gold, candle amber, sepia, muted navy, rust, cold blue, ochre, ultramarine, vermillion, earth rust.
- accent drives active dates, highlighted figures, drawing routes, pulsing rings around the current event, and the active timeline marker.
- inactive geometry: low-contrast grey (#3a3a3a); secondary labels: muted grey/white.

animation:

- every segment must show continuous motion — something is always drawing, traveling, unfolding, pulsing, or panning. never a static frame.
- vertical mobile (9:16). evolve one hero illustration across consecutive sentences; change scene only when the era, place, or argument shifts.
- top 10% and bottom 20% stay clear of hero labels (background linework OK); subtitles live in the bottom band when embedded.
- cut, zoom, or reframe every 8–12 seconds. pattern interrupt with a new map region, camera push along a route, or a cascade of new timeline marks.
- impressive motions to use liberally: ink-draw path reveals, traveling markers along routes, expanding accent rings around a turning point, date counters, figure highlights, era morphs, staggered timeline reveals, zoom into a map or family tree, before/after era split.

# visual density (mandatory — the screen should look impressive)

the main band (12–72% viewport) must always feel populated. sparse slides are a failure.

minimum per segment:

- at least 8 distinct animated illustration elements (timeline ticks, map contours, route segments, figure markers, quote brackets, arrows, rings, dots) — not counting the subtitle bar.
- at least 2 simultaneous motions (e.g. a timeline draws while a date ticks up, or a route traces while a figure marker pulses).
- one hero illustration that fills most of the main band width (70%+), not a tiny graphic floating in empty space.

build illustrations incrementally across narration:

- keep the same scene/illustration for related sentences; add dates, routes, names, events, and highlights as narration progresses.
- when narration names a date, place, person, or event — attach a marker, label, or tick to the existing illustration; do not replace the whole screen with one word.

layer stack (bottom → top):

1. full-bleed background grid, map lines, or manuscript ruling
2. hero illustration (timelines, maps, succession trees, cause chains, quote brackets, figure groups)
3. short labels anchored to illustration elements (dates on ticks, names beside figures, places on maps)
4. optional one-line title or keyword when it fits without crowding
5. subtitle bar (bottom band only, when embedded)

# layout (mandatory — prevents text overlap, not graphic richness)

graphics can be elaborate; floating text must stay disciplined.

| band | y range | allowed content |
| --- | --- | --- |
| top safe | 0–10% | background linework only |
| main | 12–72% | hero illustration + labels anchored to it + optional one title line |
| bottom safe | 78–100% | embedded subtitles only |

text rules (graphics are exempt):

- max one floating title line in the main band at a time.
- illustration labels: up to 5 short labels (≤20 chars), each anchored to a date, figure, or place — stagger y positions ≥60px apart.
- quotes: show inside bracket or plaque graphics, max 2 lines / 14 words; may animate word-by-word with `localTime`.
- never place readable text below 72% except the subtitle bar.
- when labels would collide, drop the floating title — keep the illustration and its anchored labels.

# captions & sync (mandatory)

one `narration+visual` segment = one spoken sentence. segment `.text` must match what is spoken.

when `embed subtitle in video: yes`:

- subtitles only in the bottom band (white, centered, 26px Source Sans 3).
- subtitle text from the active segment's `.text`; split into 7–8 word chunks with even time windows inside the segment.
- main band carries the illustration and anchored labels — not a duplicate of the subtitle sentence.

when `embed subtitle in video: no`:

- one short on-screen phrase per segment in the main band (max 8 words), synced to `localTime`, derived from that segment's `.text`.

for both modes:

- compute all motion and visibility from `segment`, `localTime`, and `globalTime` inside `renderSection` — no CSS animations, no `setInterval`, no `Date.now()`.

# subject motifs — documentary illustration scenes

each beat is a dense animated illustration, not a text card. write for sound-off Facebook viewing: key dates, names, places, and the payoff line must appear on screen, not only in narration.

- hook beat → dramatic title in serif + year or place callout + radial emphasis lines or map stroke; accent pulse on the hook phrase
- context beat → wide timeline spanning the frame: baseline draws, 6–8 date ticks appear staggered, arcs link related events, active tick glows accent
- geography beat → simplified region or empire outline (1px path) + traveling marker along a march, trade route, or migration; optional second path for retreat, flank, or diaspora
- turning-point beat → cause-and-effect chain: links draw one-by-one, active path brightens in accent, the pivotal event gets pulse rings
- figures beat → labeled constellation of rulers, thinkers, or allies (who succeeded whom, who allied with whom); highlight the narrated figure in accent
- quote beat → tall bracket or manuscript frame animates open; quoted words appear sequentially inside; prior illustration can ghost at 20% opacity behind
- takeaway beat → illustration zooms to one highlighted date, figure, or final timeline mark + bold payoff line + accent rule draws beneath

topic accents (pick one accent + one illustration family):

- ancient rome → empire timeline + succession or alliance map; purple or laurel green
- medieval → feudal chain or pilgrimage route; candle-amber pulse on the pivot event
- 18th–19th century → trade or war route + letter-style dashed curve; sepia or navy
- 20th-century conflict → before/after dual timeline or map compression; red or cold blue
- art / literature → bracketed quote scene + single accent word from the work; ochre, ultramarine, or vermillion
- philosophy / ideas → concept web with expanding rings around the central claim; one accent

do not use: light backgrounds, monospace/code fonts, neon tech colors, generic dashboard charts, clipart, photo frames, filled cards, or empty black screens with a single line of text.

# duration

target 45–60 seconds total — never ship under 45 seconds.
use the pipeline rule: ~150 words of narration ≈ 1 minute. for this profile:

- minimum narration: 115 words (≈45s)
- sweet spot: 125–140 words (≈50–56s)
- maximum narration: 150 words (≈60s) — do not exceed unless generation length explicitly asks for longer

count only AUDIO/narration text in script.md and `__VIDEO_PLAN__` segment `.text` fields — not VISUAL lines.
before writing index1.html: count narration words in script.md; if under 115, expand the script until you hit the band.
if the prompt includes `generation length:`, treat it as the target duration — convert to words (minutes × 150, or seconds × 2.5) and hit that floor, but stay within 45–60s when that range applies.

# teaching style

open with a hook in the first 3 seconds — a surprising fact, myth-busting question, or dramatic contrast — paired with an immediate visual punch (map stroke, date reveal, or quote bracket opening).
tell one human story or one sharp insight; narrate names, dates, and quotes in audio while the illustration marks them in sync.
build a mini arc: hook → context → turn → takeaway — each phase adds layers to the illustration, not a blank new slide.
pattern interrupt every 8–12 seconds with new illustration motion (zoom, new route branch, figure highlight, era split).
end with a memorable payoff line anchored to a final illustration state — a lesson, a reversal, or a question that makes them want the next reel. no recap montage.
tone: curious, literate, accessible — like a sharp history documentary for your phone, not a math lecture or a subtitle reel on an empty screen.
