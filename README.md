# MyLecture

> **Open-source AI video lesson studio for Windows and macOS**  
> Ask a question, read the streamed answer, then explore it with narrated, animated visuals.

---

## Overview

**MyLecture** is a local-first desktop application (Windows and macOS) built with Electron. It is the evolution of the MyLecture local IDE (last state: tag `local-ide-final`, branch `archive/local-ide`). Study streams a text answer first, then turns that answer into **synchronized voice and interactive visuals**.

> On `main`, only **Create** ships. **Study** is under development on the `feature/study` branch (`app/js/features.js` turns it on).

The app is designed with two core modes:
1. **Study Mode (Tutor)**: Ask any question on algorithms, physics, calculus, machine learning, biology, or economics. The AI starts with a streaming text answer whose length fits the question and conversation, then creates narrated visuals from that answer.
2. **Create Mode (Video IDE)**: A video creation utility where you can build, edit, and fine-tune videos. Edit HTML structure, write JavaScript animations, adjust spoken narration beats, re-synthesize voices, instruct the AI to rewrite scenes, and export to MP4, interactive HTML, or publish directly to social media.

---

## Key Features

### Rendered video library
The Library shows completed MP4 exports only, with Play and Show file controls. Generated HTML lessons and editable projects stay in Study/Create. New renders appear after export completes.

### Account usage limits
- A compact line under the agent/model description shows weekly and five-hour allowance remaining.
- Click the usage line for all model groups, progress bars, and reset times in your local timezone.
- Limits refresh every minute, after lessons, and with **Refresh**. These are account-wide allowances, including usage outside MyLecture; checking them consumes no model tokens.
- Requires an Antigravity CLI version supporting `agy -p /usage --output-format json`. Other engines currently show limits as unavailable.

### 1. Study Mode (AI Tutor)
- **Answer First**: The text answer streams as it is generated, before visuals are prepared.
- **Natural Answer Length**: Study has no length control or fixed duration. A simple question can receive a short answer; a complex topic can receive a fuller explanation.
- **Visuals Afterwards**: The completed answer becomes the basis for narrated, animated visuals; the answer determines the amount of content and runtime.
- **Session History**: Study conversations and answers are saved locally and can be resumed. The answer remains saved if visual generation fails or is stopped.
- **One-Click "Edit as Video"**: Open a Study lesson with generated scenes in Create (IDE) Mode.

### 2. Create Mode (Video IDE)
- The prompt box includes aspect, theme, teaching style, voice, and target length. The slider offers 15, 30, and 45 seconds, then each whole minute from 1 to 10.
- The provider/model control uses native CLI catalogs and their advertised reasoning levels, with manual refresh and a 60-second refresh while Create is visible. Direct API catalogs use each provider's models endpoint; unadvertised reasoning levels are not guessed.
- The timeline uses the local IDE's red draggable playhead. Preview subtitles default off. **Render → Embed captions** also defaults off.
- **Scene Manager**: Add, duplicate, delete, and reorder scenes. Import existing HTML slides via file dialog.
- **Multi-Tab Code Editor**:
  - **HTML & CSS**: Scene markup with built-in templates (Title + Subtitle, Two Columns, Card Grid, Highlighted Code, KaTeX math formulas, SVG diagrams, Callouts).
  - **Animation JS**: Dynamic animation scripts using `ML.show()`, `ML.draw()`, `ML.type()`, `ML.count()`, and `ML.plot()`.
  - **Narration Beats**: Edit spoken sentences line-by-line with duration metrics and instant audio preview.
  - **AI Assistant**: Request targeted modifications per scene (e.g., *"Make it simpler"*, *"Add a step-by-step diagram"*, *"Use modern dark cards"*) with real-time token streaming.
- **Live Preview & Player**: Synchronized stage preview with "Play All", "Play Scene", "Restart", and live error reporting.
- **Multi-Aspect Ratio**: Switch between **16:9 Landscape** (YouTube / Desktop), **9:16 Vertical** (Shorts / Reels / TikTok), and **1:1 Square** (Instagram / Feed).

### 3. Engine Support
- **Google Antigravity CLI (`agy`)**: Seamless integration using Antigravity's stream-json protocol with Gemini and Claude models.
- **OpenAI Codex CLI**: Streaming integration via the Codex app-server JSON-RPC protocol.
- **Claude Code CLI**: Integration via Claude Code streaming print mode.
- **Direct API Keys**: Built-in support for Gemini, Anthropic Claude, OpenAI, DeepSeek, Groq, and OpenRouter with DPAPI-encrypted credential storage.

### 4. Local Neural TTS & Fallback
- **Kokoro-82M Neural Voice**: High-quality local voice synthesis running in an isolated Electron utility process.
- **OmniVoice**: Local reference-voice synthesis using a persistent Python worker, with CUDA when available and CPU otherwise. Select it under Settings → Voice; the bundled voices include Maruf, Mike, three American male voices, and Johnny Harris. OmniVoice errors are reported directly instead of silently changing the voice engine.
- Voice choices are **Kokoro** and **OmniVoice**. Synthesis waits for the selected neural engine; Windows voice is not offered or used as an automatic fallback.
- **Deterministic Audio Mixing**: Audio tracks are synthesized and aligned to millisecond accuracy with the visual timeline.

OmniVoice requires a Python environment with `omnivoice`, PyTorch, and `soundfile` installed, plus the `k2-fsa/OmniVoice` model (downloaded on first use). The development app detects the existing sibling OmniVoice environment. For another installation, set **Settings → Voice → OmniVoice Python** to that environment's Python executable, or set `MYLECTURE_PYTHON`. The Python environment and model weights are external to the Electron installer; reference audio and the worker script are bundled. The worker stays warm across clips and is stopped when the app exits.

### 5. Multi-Format Export Center
- **MP4 Video Export**: Headless frame capture piped to `ffmpeg` with synchronized audio and optional captions.
- **Standalone Interactive HTML**: A single, portable HTML bundle with embedded MP3 audio that plays offline in any web browser.
- **Captions**: Standard `.srt` and `.vtt` subtitle files.
- **Publish to Socials**: One-click helper modal for YouTube (Shorts/Studio), TikTok, Instagram (Reels), Facebook, LinkedIn, and X with auto-generated hashtags and direct folder opening.

---

## Project Structure

```
mylecture-app/
├── app/
│   ├── assets/              # App icons, lockups, branding
│   ├── css/                 # Global styles and IDE layout
│   ├── js/
│   │   ├── main.js          # App bootstrap & view router
│   │   ├── study.js         # Study view (streaming chat player)
│   │   ├── create.js        # Create view (Video IDE & scene editor)
│   │   ├── library.js       # Saved lessons & videos library
│   │   ├── settings.js      # Engine, model, and TTS configuration
│   │   ├── player.js        # Timeline-locked stage player
│   │   ├── exports.js       # Background export jobs & publishing
│   │   └── ui.js            # Shared UI components & modals
│   ├── shared/
│   │   └── timeline.js      # Timeline math & beat positioning
│   └── stage/
│       ├── stage.html       # Isolated sandboxed render stage
│       ├── stage.css        # Stage styling & theme variables
│       └── runtime.js       # ML helper library (show, draw, plot, KaTeX, hljs)
├── electron/
│   ├── engines/             # CLI & API engine adapters (Antigravity, Codex, etc.)
│   ├── tts/                 # Kokoro neural worker & Windows SAPI service
│   ├── exporter.js          # MP4, HTML, and subtitle render pipelines
│   ├── generator.js         # Streaming generator orchestrator
│   ├── main.js              # Electron main process & IPC handlers
│   ├── preload.cjs          # Context bridge & secure API boundary
│   ├── prompt.js            # MyLecture Stream Format system prompts
│   ├── store.js             # Encrypted secrets & local persistence
│   └── stream-parser.js     # Incremental streaming format parser
└── tests/                   # Unit test suite & smoke test
```

---

## Getting Started

### Prerequisites
- Windows 10/11 (64-bit) or macOS 12+ (Apple silicon or Intel)
- Node.js v20+ or v24+
- (Recommended) Google Antigravity CLI (`agy`) or Codex CLI installed and logged in.

### Installation

```powershell
# Navigate to the app directory
cd d:\mylecture\mylecture-app

# Install dependencies
npm install
```

### Running the App

```powershell
# Start the application
npm start

# Run in development mode (opens DevTools)
npm run dev
```

### Running Tests

```powershell
npm test
```

### Building installers

```powershell
npm run dist:win   # Windows: NSIS installer + portable .exe in dist/
npm run dist:mac   # macOS (run on a Mac): .dmg + .zip in dist/
npm run smoke      # launch the packaged app and check it boots into Create
```

### Releasing

Push a version tag; GitHub Actions builds Windows x64, macOS Apple silicon and macOS Intel,
launches each packaged app (speech, ffmpeg and the scene checker included), and opens a
draft GitHub Release with the installers:

```powershell
git tag v0.2.0
git push origin v0.2.0
```

See [docs/RELEASING.md](docs/RELEASING.md) for signing and how to test the macOS builds.

---

## License

MIT License. Open-source and free for everyone.
