# MyLecture

**Bring every lesson to life.**

Turn complex ideas into narrated, animated videos. MyLecture gives teachers, tutors, students, and educational creators a Windows workspace for explaining anything, from mathematics and science to engineering, economics, and beyond.

**[Download for Windows](https://mylecture-server.touhid3-1416.workers.dev/download/windows)** | [MyLecture.ai](https://www.mylecture.ai) | [Latest release](https://github.com/touhid314/mylecture/releases/latest)

![MyLecture desktop app showing a narrated circuit lesson, recent projects, scene timeline, and AI editing panel](docs/images/mylecture-studio.png)

*Preview the lesson, navigate its scenes, and refine it with AI, all in one workspace.*

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

## Development

With Node.js 22 installed:

```sh
git clone https://github.com/touhid314/mylecture.git
cd mylecture
npm ci
npm start
```

Run `npm test` to validate changes. See the [release guide](docs/RELEASING.md) for Windows builds and publishing.

**License:** [CC BY-NC 4.0](LICENSE): free to use, share, and adapt with attribution for non-commercial purposes. For commercial use, contact [support@mylecture.ai](mailto:support@mylecture.ai).
