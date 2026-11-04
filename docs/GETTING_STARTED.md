# Run MyLecture without the installer

These instructions target the current Windows desktop app. Running from source opens the same Create, Library, and Settings interface as the packaged app.

## 1. Start the app

Install [Git](https://git-scm.com/downloads) and [Node.js](https://nodejs.org/en/download) 22.15+ (22.x or 24.x), then open PowerShell:

```powershell
git clone https://github.com/touhid314/mylecture.git
cd mylecture
npm ci
npm start
```

No MyLecture installer, cloud deployment, or repository `.env` file is needed. Internet access is needed to download dependencies, install AI engines/voice models, and use hosted AI.

Use `npm run dev` to open developer tools. After pulling code changes, close the app, run `npm ci` if dependencies changed, and restart with `npm start`.

## 2. Set up an AI provider

Use **Set up** on the welcome screen, or **Settings > AI engines & voices**, to install the provider's CLI. Then choose **Connect** and complete its browser/terminal sign-in.

| MyLecture provider | Integration | Account to use |
| --- | --- | --- |
| **GPT** | OpenAI Codex CLI | Sign in with your ChatGPT account to use its eligible Codex allowance. |
| **Gemini** | Google Antigravity CLI (`agy`) | Sign in with your Google account. Google AI Pro/Ultra plans provide higher allowances. |
| **Claude** | Claude Code CLI | Sign in with your Claude account on a plan that includes Claude Code, such as Pro or Max. |

MyLecture launches the installed CLI; you do not paste subscription login tokens into the app. Allowances, available models, and workspace restrictions come from the provider. Usage is shared with other activity on the same provider account.

Official account guidance: [OpenAI](https://learn.chatgpt.com/docs/auth), [Google](https://antigravity.google/docs/plans), [Claude](https://code.claude.com/docs/en/authentication).

If needed, complete sign-in directly in a terminal, then return to MyLecture and connect the account:

| Provider | Terminal sign-in |
| --- | --- |
| GPT | `codex login` |
| Gemini | `agy`, then follow the Google sign-in flow |
| Claude | `claude auth login --claudeai` |

## 3. Choose a voice and make a video

Kokoro provides fast, natural narration. Optional OmniVoice provides high-quality, expressive narration and has an in-app downloader that sets up its environment and models.

1. Choose a provider, model, voice, aspect ratio, and target length in Create.
2. Describe your lesson, or attach source material.
3. Preview the scenes and ask for changes in the agent chat.
4. Use **Edit narration** or **Change voice** to refine speech.
5. Choose **Render** to export an MP4. Finished videos appear in Library.

Narration synthesis and rendering run locally; AI generation uses the selected provider.

## API-key mode

Choose **Use with API key** if you prefer API billing. The current UI offers **Gemini API** and **LiteLLM**; LiteLLM also needs its server URL.

API-key usage follows the selected API/provider's billing instead of automatically using a chat subscription's allowance. For subscription usage, connect the GPT, Gemini, or Claude account card instead.

If a CLI reports API-key authentication when you intended subscription access, change its sign-in method. In particular, an existing `ANTHROPIC_API_KEY` can select API billing in Claude Code; check the provider's authentication guidance above.

## Useful checks

- **Engine missing:** install it from Settings, reopen MyLecture, and reconnect.
- **Voice unavailable:** finish its download in Settings or the voice picker.
- **Need diagnostics:** open the live log under Settings.
- **Validate code changes:** run `npm test`.

For installers and update publishing, see the [Windows release guide](RELEASING.md). Source runs use local app data and skip launch telemetry and automatic update checks.
