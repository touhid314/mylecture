import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LLM_Model } from '../llm_model.js';
import { BASE_DIR, resolve_workspace_path } from '../workspace.js';
import { print_step, print_detail, Color } from '../coding_agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ansgenSystemPromptPath = path.resolve(__dirname, '..', 'prompts', 'ansgen_system.md');
const scriptgenSystemPromptPath = path.resolve(__dirname, '..', 'prompts', 'scriptgen_system.md');

export async function runScriptAgent(
    workspaceDir: string,
    topic: string,
    length: string,
    theme: string,
    teachingStyle: string,
    model: string,
    tokenTrackerSessionId?: string | null,
    attachments: string[] = []
): Promise<string> {
    const resolvedAttachments = attachments.map(attachment => resolve_workspace_path(attachment, workspaceDir));
    // Resolve default theme and teaching style if empty
    let activeTheme = theme;
    if (!activeTheme) {
        const defaultThemePath = path.join(BASE_DIR, 'packages', 'lecture-agent', '.agents', 'mylecture-themes', 'default.md');
        if (fs.existsSync(defaultThemePath)) {
            activeTheme = fs.readFileSync(defaultThemePath, 'utf8').trim();
        } else {
            const fallbackThemePath = path.join(BASE_DIR, '.agents', 'mylecture-themes', 'default.md');
            if (fs.existsSync(fallbackThemePath)) {
                activeTheme = fs.readFileSync(fallbackThemePath, 'utf8').trim();
            }
        }
    }

    let activeStyle = teachingStyle;
    if (!activeStyle) {
        const defaultStylePath = path.join(BASE_DIR, 'packages', 'lecture-agent', '.agents', 'mylecture-teaching-style', 'default.md');
        if (fs.existsSync(defaultStylePath)) {
            activeStyle = fs.readFileSync(defaultStylePath, 'utf8').trim();
        } else {
            const fallbackStylePath = path.join(BASE_DIR, '.agents', 'mylecture-teaching-style', 'default.md');
            if (fs.existsSync(fallbackStylePath)) {
                activeStyle = fs.readFileSync(fallbackStylePath, 'utf8').trim();
            }
        }
    }

    // 1. Run ans-agent to generate answer.md
    print_step(0, "Running ans-agent subagent to generate answer.md", Color.MAGENTA);
    if (!fs.existsSync(ansgenSystemPromptPath)) {
        throw new Error(`ansgen_system.md not found at: ${ansgenSystemPromptPath}`);
    }
    let ansSystem = fs.readFileSync(ansgenSystemPromptPath, 'utf8');
    ansSystem += `\n\n# Teaching Style\n${activeStyle}`;

    const ansUserPrompt = `Request Topic: ${topic}\nRequested Length: ${length}`;
    const llm = new LLM_Model(model, ansSystem);
    if (tokenTrackerSessionId) {
        llm.token_tracker_session_id = tokenTrackerSessionId;
    }
    llm.token_tracker_purpose = "ans_agent";

    const ansResponse = await llm.generate(
        ansUserPrompt,
        null, null, null, null,
        false, // return_json
        false  // keep_history
    );
    const answerText = (typeof ansResponse === 'string' ? ansResponse : ansResponse.text || '').trim();
    if (!answerText) {
        throw new Error("Failed to generate answer from ans-agent.");
    }

    const answerPath = path.join(workspaceDir, 'answer.md');
    fs.writeFileSync(answerPath, answerText, 'utf8');
    print_detail("ans-agent", `Saved answer.md (${answerText.split(/\s+/).filter(Boolean).length} words)`, Color.GREEN);

    // 2. Run script-agent to generate script.md
    print_step(0, "Running script-agent subagent to generate script.md", Color.MAGENTA);
    if (!fs.existsSync(scriptgenSystemPromptPath)) {
        throw new Error(`scriptgen_system.md not found at: ${scriptgenSystemPromptPath}`);
    }
    let scriptSystem = fs.readFileSync(scriptgenSystemPromptPath, 'utf8');
    scriptSystem += `\n\n# Teaching Style\n${activeStyle}\n\n# Visual Theme\n${activeTheme}`;

    const scriptUserPrompt = `Request Topic: ${topic}\nRequested Length: ${length}\n\nHere is the concept explanation (answer.md):\n\n${answerText}`;
    const scriptLlm = new LLM_Model(model, scriptSystem);
    if (tokenTrackerSessionId) {
        scriptLlm.token_tracker_session_id = tokenTrackerSessionId;
    }
    scriptLlm.token_tracker_purpose = "script_agent";

    const scriptResponse = await scriptLlm.generate(
        scriptUserPrompt,
        null, null, null, resolvedAttachments,
        false, // return_json
        false  // keep_history
    );
    const scriptText = (typeof scriptResponse === 'string' ? scriptResponse : scriptResponse.text || '').trim();
    if (!scriptText) {
        throw new Error("Failed to generate script from script-agent.");
    }

    const scriptPath = path.join(workspaceDir, 'script.md');
    fs.writeFileSync(scriptPath, scriptText, 'utf8');
    print_detail("script-agent", `Saved script.md (${scriptText.split(/\s+/).filter(Boolean).length} words)`, Color.GREEN);

    return `Success: answer.md and script.md generated in the workspace.`;
}
