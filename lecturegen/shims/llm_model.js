// Stand-in for mylecture-agent/src/utils/llm_model.ts.
// Same public surface (constructor, history, generate(...)) but the request
// goes to whichever engine the MyLecture app is configured with
// (Antigravity, Codex, Claude Code or an API key), via globalThis.__ML_LLM__.
//
// The original keeps a multi-turn history when keep_history is true (the
// animator's retained session). App engines are single-turn, so the retained
// history is replayed as a transcript in front of the new message.

function transcript(history, prompt) {
  if (!history.length) return prompt;
  const turns = history.map((m) => `[${m.role === "user" ? "USER" : "ASSISTANT"}]\n${m.content}`).join("\n\n");
  return `# Conversation so far (you are the ASSISTANT; continue it)\n\n${turns}\n\n# New USER message\n\n${prompt}`;
}

export class LLM_Model {
  constructor(model_name, system_content = null, system_attachments = null, return_json = false, max_history_messages = null) {
    this.model_name = model_name;
    this.system_content = system_content;
    this.return_json = return_json;
    this.max_history_messages = max_history_messages;
    this.history = [];
    this.api_type = "app";
    this.usesGateway = false;
    this.token_tracker_session_id = null;
    this.token_tracker_purpose = null;
  }

  clear_history() {
    this.history = [];
  }

  async generate(prompt, image_path = null, video_path = null, pdf_path = null, attachments = null, return_json = null, keep_history = false) {
    const llm = globalThis.__ML_LLM__;
    if (!llm) throw new Error("MyLecture LLM bridge is not configured.");
    const hist = keep_history ? (this.max_history_messages ? this.history.slice(-this.max_history_messages) : this.history) : [];
    const json = return_json === null ? this.return_json : return_json;
    let user = transcript(hist, prompt);
    if (json && !user.toLowerCase().includes("json")) user += "\n\nYou must return a valid JSON object.";
    const text = await llm.generate({ system: this.system_content || "", user, purpose: this.token_tracker_purpose || "", model: this.model_name });
    if (keep_history) {
      this.history.push({ role: "user", content: prompt });
      this.history.push({ role: "model", content: text });
    }
    return { text };
  }
}
