# MyLecture

**Bring every lesson to life.**

Turn complex ideas into narrated, animated videos. MyLecture gives teachers, tutors, students, and educational creators a Windows workspace for explaining anything, from mathematics and science to engineering, economics, and beyond.

**[Download for Windows](https://mylecture-server.touhid3-1416.workers.dev/download/windows)** | [MyLecture.ai](https://www.mylecture.ai) | [Latest release](https://github.com/touhid314/mylecture/releases/latest)

![MyLecture desktop app showing a narrated circuit lesson, recent projects, scene timeline, and AI editing panel](docs/images/mylecture-studio.png)

*Preview the lesson, navigate its scenes, and refine it with AI, all in one workspace.*

## How it works: HTML scenes, played like video

MyLecture is built around a [small HTML contract](electron/lecturegen/resources/contracts/html-input-contract.md). The AI works directly with HTML, CSS, JavaScript, SVG, and Canvas to create each scene. The contract supplies just three entry points:

- **Metadata:** the video's title, aspect ratio, and contract version.
- **A segment plan:** narration text and audio references, or timed visual-only segments.
- **A render function:** `renderSection(segment, localTime, globalTime)` draws the scene at a specific moment.

Visual state comes from the supplied time, so the player can **play, pause, or seek directly to any point** without replaying earlier animation. MyLecture generates narration and uses its actual audio duration to build the timeline. Export drives the same HTML renderer at fixed timestamps, then combines the captured frames and audio into an MP4 with FFmpeg.

### Why this approach over Remotion?

For AI-generated lessons, MyLecture keeps scene authoring lightweight and gives the AI direct control over the browser's visual tools:

| | MyLecture HTML contract | Remotion |
| --- | --- | --- |
| Scene format | An HTML document with CSS and JavaScript | React components and composition metadata |
| Animation clock | Segment and time in seconds | Frame number through `useCurrentFrame()` |
| Scene setup | Three contract entry points; no React/JSX compilation or per-scene npm project | React project and Remotion tooling |
| Playback and export | Shared HTML renderer, MyLecture player, and MP4 export | Remotion Player and rendering APIs |

**Less framework scaffolding for the AI, more room to build the explanation.** Both approaches support playback, seeking, and rendering; MyLecture's advantage here is its minimal scene interface and direct HTML workflow. See Remotion's [core model](https://www.remotion.dev/docs/idea), [Player](https://www.remotion.dev/docs/player/player), and [renderer](https://www.remotion.dev/docs/renderer/render-media).

## Built for teaching and learning

Make a quick concept explainer, a worked example, a revision video, or a complete lesson. Start with a topic, or attach notes, PDFs, and images to give the AI context.

- **Create and refine:** describe your lesson, then ask the AI to simplify an explanation, change a visual, or add a scene.
- **See the whole story:** preview synchronized animation and narration, scrub the scene timeline, and return to saved projects.
- **Make it sound right:** edit narration and change the voice after generation. Choose **Kokoro** for fast, natural speech or **OmniVoice** for high-quality, expressive speech.
- **Share anywhere:** export MP4 in landscape, portrait, or square at 1080p or 720p, with optional captions. Completed videos appear in the Library.
- **Choose your AI:** connect GPT, Claude, or Gemini through the supported CLI integrations, or use a supported API provider.

## Get started

1. [Download the Windows installer](https://mylecture-server.touhid3-1416.workers.dev/download/windows) and select the AI engines and voices you want during setup.
2. Open MyLecture and connect your AI account or API key.
3. Describe a lesson, preview and refine it, then **Render** your video.

Windows 10/11, 64-bit. AI generation requires a supported provider account or API key; provider charges and usage limits apply. Voice models download separately, and narration synthesis and video rendering run locally. OmniVoice is optional and can be downloaded inside the app.

## The MyLecture learning community

[MyLecture.ai](https://www.mylecture.ai) brings together video classes, interactive learning, and practice. The desktop app puts educational video creation in your hands.

Follow lessons, ideas, and updates: [YouTube](https://www.youtube.com/@mylecture.ai.2026) | [Facebook](https://www.facebook.com/mylectureai) | [Instagram](https://www.instagram.com/mylecture.ai) | [TikTok](https://www.tiktok.com/@mylectureai)

For mathematics: [MyLectureMath on Facebook](https://www.facebook.com/mylecturemath) | [MyLecture Math on Instagram](https://www.instagram.com/mylectureai.math/)

## Use your AI subscription

Connect the provider in the welcome screen or Settings, then sign in through its browser/terminal flow:

| Provider | Uses your account through |
| --- | --- |
| **GPT** | Codex CLI and your eligible ChatGPT plan |
| **Gemini** | Antigravity CLI and your Google account; Google AI Pro/Ultra offer higher limits |
| **Claude** | Claude Code and an eligible Claude subscription, such as Pro or Max |

Subscription sign-in does not require an API key. Your provider's allowances and account policies still apply. **Use with API key** is a separate option with API/provider billing.

## Run without the installer

Install Git and Node.js 22.15+ (22.x or 24.x), then run:

```sh
git clone https://github.com/touhid314/mylecture.git
cd mylecture
npm ci
npm start
```

In the app, install your chosen AI engine and voice from Settings, then connect your account. No MyLecture installer or repository `.env` file is required.

See [source setup and account sign-in](docs/GETTING_STARTED.md) for details. Developers can run `npm test` to validate changes; the [release guide](docs/RELEASING.md) covers Windows builds and publishing.

**License:** [CC BY-NC 4.0](LICENSE): free to use, share, and adapt with attribution for non-commercial purposes. For commercial use, contact [support@mylecture.ai](mailto:support@mylecture.ai).
