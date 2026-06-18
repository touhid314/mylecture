# Basic Coding Agent (TypeScript)

A TypeScript-based coding agent with four local workspace tools:

- `read`
- `write`
- `edits` (atomic batch search-and-replace)
- `cmd` (runs shell commands in the workspace)

The system instructions are located in `system_prompt.md`. You can customize the agent's behavior by editing that file without changing the TS code.

The agent's working directory is the `workspace/` folder. All file tools are restricted to that folder, and shell commands run from there.

## Setup

Since this is part of the npm workspaces monorepo:

1. Run `npm install` at the repository root directory.
2. Configure your API keys in the root `.env` file:
   ```env
   GOOGLE_API_KEY="your_google_api_key"
   OPENAI_API_KEY="your_openai_api_key"
   ```

Optional model override:
```env
AGENT_MODEL="gemini-3.5-flash"
```

## Running the Agent via CLI

You can execute the agent using commands from the repository root:

### Single Task Run
```powershell
npm run agent -- "Inspect this repo and create a hello world script"
```
Or for piped/longer inputs:
```powershell
"Read the code, find the bug, fix it" | npm run agent
```

### Interactive Chat Mode
Starts a conversational CLI session where the agent maintains context between your replies:
```powershell
npm run chat
```
Type `/exit` or `/quit` to stop the session.

### Load Skills
Skills can be loaded by name (resolved from `.agents/skills/<name>/SKILL.md` inside either the workspace or the package directory) or by direct path:
```powershell
npm run agent -- --skill mylecture-make-long "Make a video about PCA"
npm run chat -- --skill mylecture-make-reels
# Loading a specific markdown file as a skill
npm run agent -- --skill workspace/.agents/mylecture-contracts/avsl-syntax.md "Task here"
```

### List Skills
List all available skill names:
```powershell
npm run agent -- --list-skills
```

### Custom Model & Max Turns
Override the default model or maximum conversational turns via CLI flags:
```powershell
npm run agent -- --model gemini-2.5-pro "Create a video outline"
npm run agent -- --max-turns 150 "Check and refine index1.html"
```

---

## Technical Details

* **Dynamic Env Loading:** The agent automatically traverses parent directories upwards starting from the script path to find and load the repository root `.env` file.
* **Native Gemini Function Calling:** For Gemini models, the agent uses structured function declarations (`automaticFunctionCalling: { disable: true }` mode).
* **JSON Fallback:** Non-Gemini models (like OpenAI) fall back to the schema parsing implemented in [llm_model.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/llm_model.ts).
* **Flushed Exit & Stdin:** Stdin is forcefully closed via `process.stdin.destroy()` immediately after parsing, and the process exits cleanly after a `100ms` stream-flushing delay to avoid libuv event loop assertions on Windows.
