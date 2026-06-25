# MyLecture IDE

MyLecture IDE is an integrated platform for creating, previewing, and rendering animated, synchronized educational lecture videos and interactive game segments using web technologies.

Instead of writing raw video files, lectures are authored as contract-compliant HTML pages. The system integrates multiple components to automate, preview, and build the final output:

1. **AI Coding Agent** ([lecture-agent](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/)): A TypeScript-based agent that parses prompts, writes visual/narration scripts, and automatically constructs or modifies contract-compliant HTML files with rich canvas, SVG, or Three.js animations.
2. **Timeline Resolver** ([build-plan.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/src/build-plan.ts)): Reads the authored video plan, generates synchronized narration audio via local ONNX or cloud TTS APIs, measures audio lengths, and compiles a fully resolved animation timeline injected into the HTML.
3. **Deterministic Video Renderer** ([render-video.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/src/render-video.ts)): Leverages Playwright to capture frame-by-frame screenshots of browser-rendered animations, generates and mixes narration audio tracks, and encodes high-quality MP4 videos.
4. **Interactive Preview IDE & Server** ([ide-server.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/src/ide-server.ts) & [lecture-viewer](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-viewer/)): A local development server and front-end player that allows real-time interactive timeline scrubbing, subtitle preview, and a chat interface to prompt the AI Coding Agent directly from the browser sidebar.

---

## Project Layout

This project is configured as an npm workspaces monorepo:

```text
packages/
  ├── lecture-agent/    TypeScript-based coding agent for generating lectures
  └── lecture-viewer/   Playback engine and local preview player
models/                 Kokoro ONNX models and voices (outside src, resolved from root)
outputs/                Renderer-ready generated videos and HTML outputs
src/                    TypeScript CLIs, local IDE server, and social tools
tests/                  Structured renderer fixtures and smoke tests
.agents/                Contracts, templates, examples, themes, and agent prompts
.render/                Temporary render artifacts
```

---

## Requirements & Setup

1. **Install Node.js 22+**: Run `npm install` at the repository root directory.
2. **Configure API Keys**: Create or update `.env` in the repository root:
   ```env
   GOOGLE_API_KEY="your_google_api_key"
   OPENAI_API_KEY="your_openai_api_key"
   AGENT_MODEL="gemini-3.5-flash"
   ```
3. **Python Dependencies (for local Kokoro TTS)**:
   ```bash
   python -m pip install misaki[en] onnxruntime-gpu scipy numpy huggingface_hub
   ```
4. **Download ONNX Models**: Download the Kokoro ONNX model files to the root `models/` directory:
   ```bash
   python -c "from huggingface_hub import snapshot_download; snapshot_download('onnx-community/Kokoro-82M-v1.0-ONNX', local_dir='models/kokoro-onnx', allow_patterns=['onnx/model.onnx','voices/*','tokenizer.json'])"
   ```

---

## Main Commands

* **Start the IDE Server**:
  ```bash
  npm run ide
  ```
* **Run the Coding Agent**:
  ```bash
  # Single task run
  npm run agent -- "Create a 30s video lecture about red-black trees"
  # Interactive chat mode
  npm run chat
  ```
* **Render Video**:
  ```bash
  npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out output.mp4
  ```
* **Build Timeline Plan**:
  ```bash
  npm run build:plan -- --input tests/fixtures/input-contract-test/index.html --out .render/tests/resolved.html
  ```
* **Run Tests**:
  ```bash
  npm test
  ```

---

## HTML Input Contract

Source HTML files must follow the [HTML input contract](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/workspace/.agents/mylecture-contracts/html-input-contract.md) (v0.2):

```js
window.__VIDEO_METADATA__ = {
  contractVersion: "0.2",
  title: "Dijkstra's Algorithm Explained",
  aspectRatio: "16:9"
};

window.__VIDEO_PLAN__ = [/* visual-only, narration+visual, interactive, or game segments */];
window.__RENDER_SECTION__ = function renderSection(segment, localTime, globalTime) {};
```

The plan-builder writes a generated `lastResolved` timestamp into `window.__VIDEO_METADATA__` in the resolved HTML.

---

## Preview Viewer (IDE)

The local IDE plays, pauses, and scrubs either source or resolved render HTML:
```bash
npm run ide
```
It runs a server at `http://127.0.0.1:4307/` that coordinates the player UI, file browsing, live rendering, and agent chat.

**Viewer Features**:
* **File Picker**: `Load` opens a Windows-native file picker to select files inside the repo.
* **Auto-Aspect Ratio**: Automatically fits the view to `window.__VIDEO_METADATA__.aspectRatio`.
* **Subtitle Engine**: Renders captions on the fly derived from the segment narration texts.
* **Live Agent Integration**: Chat directly with the AI Coding Agent from the side panel to edit, refactor, and update scripts and animations in real-time.

---

## Video Rendering & Customization

Render any standalone HTML file to MP4:
```bash
npm run render:video -- --html tests/fixtures/input-contract-test/index.html --out output.mp4
```

**Common Rendering Options**:
* **Dimensions**: `--width 1080 --height 1920` (default 1080x1920 / 9:16)
* **Framerate**: `--fps 60` (default 60 fps)
* **Limit Frames**: `--max-frames 120` (good for quick smoke tests)
* **Workers**: `--workers 4` (Playwright parallel page count for frame capture)
* **TTS Customization**: `--tts-voice af_heart --tts-speed 1.0` (forces regeneration if `--force-audio` is passed)
* **Codecs**: `--video-codec auto` (checks and uses GPU-accelerated encoders like `h264_nvenc`, falling back to `libx264` with `--x264-preset veryfast`)

---

## Benchmarks & Testing

Verify renderer speeds and hardware capability with the built-in benchmarks:
```bash
npm run benchmark:480p
npm run benchmark:1080p
```

For testing visual rendering:
```bash
# Render visual-only Three.js stress test
npm run render:visual-3d
# Render a 4K 60fps sync test
npm run render:sync-4k-test
```
