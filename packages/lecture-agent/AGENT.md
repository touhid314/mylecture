# Developer & Agent Guide: `lecture-agent`

Welcome! This guide outlines the purpose, architecture, workflow, and guidelines for agents and developers working on the `lecture-agent` repository.

---

## 1. Project Overview

`lecture-agent` is a TypeScript-based AI coding agent designed to generate high-quality, visually engaging lectures using web technologies. It takes a prompt and produces structured scripts, simple text answers, and animated HTML pages representing individual video scenes.

### Core Architecture
* **`src/coding_agent.ts`**: The main orchestration class. It manages the conversation flow with the LLM, parses tool calls, and handles responses.
* **`src/tools/`**: Files implementing the tools available to the agent:
  * [read.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/read.ts): Read files.
  * [write.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/write.ts): Create files.
  * [edits.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/edits.ts): Apply atomic batch replacements.
  * [mkdir.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/mkdir.ts): Create directories.
  * [list_dir.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/list_dir.ts): List directories.
  * [del.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/del.ts): Delete files or directories.
  * [cmd.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/cmd.ts): *Note: This tool is unwired from the agent's schema. The source file is kept, but it is not registered as a tool.*
* **`src/prompts/`**: Prompt templates defining the agent's behavior and strict guidelines.

---

## 2. Agent Workflow & Deliverables

Every task follows a strict sequence:
1. **`answer.md`**: First, write a simple text-only chatbot-style answer in the workspace root.
2. **`scrip.md`**: Write the complete Audio-Visual (AV) script using the following format:
   ```text
   AUDIO: [Single narration sentence]
   VISUAL: [Incremental visual action/animation detail]
   ```
3. **`index[x].html`**: Build visual scenes mapping to the script.
   * **Rule of 150:** ~150 words of audio narration equals 1 minute of video segment, which should correspond to one HTML file (e.g., `index1.html` for Minute 1, `index2.html` for Minute 2, etc.).
   * **Scene Continuity:** Do not switch scenes on every sentence. Keep diagrams/layouts cohesive and animate them incrementally. Change the scene only when changing topics.
   * **Formatting:** Never escape attribute quotes in written HTML (e.g. write `class="stage"`, not `class=\"stage\"`).
4. **Interactive or Game files (`interactive.html` / `game.html`):** Only create these if explicitly requested.

---

## 3. Tool Usage Constraints

* **Do not use `write` to update files:** Use `write` only to create a file initially. For all subsequent updates, use the `edits` tool.
* **Batch edits:** Batch all known changes to a file into a single `edits` call using `arguments.edits` with multiple replacement items.
* **No `cmd` usage:** The `cmd` tool is deliberately removed from the agent's schemas. Use `read` to inspect files and folder-specific tools (`list_dir`, `mkdir`, `del`) for directory and file manipulation.
* **Workspace Resolution:** All paths provided to file/directory tools must be workspace-relative. They are resolved using `resolve_workspace_path` to prevent escaping the workspace root.

---

## 4. Development & Verification

When modifying the agent runtime or tools:
* **Typechecking:** Always run typecheck verification to ensure your changes compile cleanly:
  ```bash
  npx tsc --noEmit
  ```
* **Testing:** Run the LLM mock/test suite to verify there are no system integration issues:
  ```bash
  npm test
  ```

---

## 5. How to Create a New Tool

To add a new tool to `lecture-agent`, follow these three steps:

### Step 1: Implement the Tool
Create a new file in `src/tools/` (e.g., `src/tools/my_tool.ts`) exporting the tool function. If the tool interacts with files, resolve paths using `resolve_workspace_path` to guarantee workspace safety:
```typescript
import { resolve_workspace_path } from './utils/workspace.js';

export function tool_my_tool(filePath: string): string {
    const target = resolve_workspace_path(filePath);
    // Tool logic...
    return "Result message";
}
```

### Step 2: Define the Tool Schema
Open [schemas.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/utils/schemas.ts) and add the JSON Schema description of your tool parameters to the `TOOLS` array:
```typescript
{
    type: "function",
    name: "my_tool",
    description: "Briefly explain what the tool does.",
    parameters: {
        type: "object",
        properties: {
            filePath: { type: "string", description: "Workspace-relative file path." }
        },
        required: ["filePath"],
        additionalProperties: false,
    },
}
```
Also update `TOOL_JSON_SCHEMA`'s `tool` lists and `arguments` descriptions if relevant.

### Step 3: Register the Tool in index.ts
Open [index.ts](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/tools/index.ts) and:
1. Export and import the new function:
   ```typescript
   export { tool_my_tool } from './my_tool.js';
   import { tool_my_tool } from './my_tool.js';
   ```
2. Map the name to the implementation in `execute_tool`:
   ```typescript
   if (name === "my_tool") {
       return tool_my_tool(argumentsObj.filePath);
   }
   ```

### Step 4: Update the System Prompt
Open [system_prompt.md](file:///c:/Users/touhi/OneDrive/Desktop/mylecture/mylecture-ide/packages/lecture-agent/src/prompts/system_prompt.md) and:
1. Add the tool to the **# Available tools:** list.
2. If necessary, write any behavioral constraints, strategy rules, or guidelines for when the agent should (or should not) use the tool.
*Note: Although native function calling passes the API schema directly to Gemini, updating the prompt text is required to support the JSON fallback mode and to guide the agent on tool usage strategies.*
