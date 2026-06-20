import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

import { Logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
    let dir = __dirname;
    while (dir && dir !== path.parse(dir).root) {
        const envPath = path.join(dir, '.env');
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, quiet: true });
            return;
        }
        dir = path.dirname(dir);
    }
    dotenv.config({ quiet: true });
}
loadEnv();

export class LLM_Model {
    private logger: Logger;
    public model_name: string;
    public system_content: string | null;
    public system_attachments: Array<{ path: string; kind: string }>;
    public return_json: boolean;
    public max_history_messages: number | null;
    public history: Array<{ role: string; content: string; attachments?: Array<{ path: string; kind: string }> }>;
    private _client: any;
    public api_type: 'openai' | 'google';

    constructor(
        model_name: string,
        system_content: string | null = null,
        system_attachments: any[] | null = null,
        return_json: boolean = false,
        max_history_messages: number | null = null
    ) {
        this.logger = new Logger();
        this.logger.info(`Initializing LLM_Model with model: ${model_name}`);

        this.model_name = model_name;
        this.system_content = system_content;
        this.system_attachments = this._normalize_attachments(system_attachments || []);
        this.return_json = return_json;
        this.max_history_messages = max_history_messages;

        if (this.max_history_messages !== null && this.max_history_messages <= 0) {
            this.logger.error("max_history_messages must be > 0 when provided.");
            throw new Error("max_history_messages must be > 0 when provided.");
        }

        this.history = [];

        if (model_name.startsWith("gpt-")) {
            this.api_type = "openai";
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) {
                this.logger.error("OPENAI_API_KEY environment variable not set.");
                throw new Error("OPENAI_API_KEY environment variable not set.");
            }
            this._client = new OpenAI({ apiKey });
            this.logger.debug("OpenAI client initialized.");
        } else if (model_name.includes("gemini")) {
            this.api_type = "google";
            const apiKey = process.env.GOOGLE_API_KEY;
            if (!apiKey) {
                this.logger.error("GOOGLE_API_KEY environment variable not set.");
                throw new Error("GOOGLE_API_KEY environment variable not set.");
            }
            this._client = new GoogleGenAI({ apiKey });
            this.logger.debug("Google Gemini client initialized (Client API).");
        } else {
            this.logger.error(`Unsupported model_name: ${model_name}.`);
            throw new Error(`Unsupported model_name: ${model_name}. Must start with 'gpt-' or contain 'gemini'.`);
        }
    }

    private _extract_json_objects(s: string): string[] {
        const results: string[] = [];
        let i = 0;
        while (i < s.length) {
            let start_idx = -1;
            for (let j = i; j < s.length; j++) {
                if (s[j] === '{' || s[j] === '[') {
                    start_idx = j;
                    break;
                }
            }
            if (start_idx === -1) {
                break;
            }

            const open_char = s[start_idx];
            const close_char = open_char === '{' ? '}' : ']';

            let count = 0;
            let in_string = false;
            let escape = false;
            let found = false;

            for (let k = start_idx; k < s.length; k++) {
                const char = s[k];
                if (escape) {
                    escape = false;
                    continue;
                }
                if (char === '\\') {
                    escape = true;
                    continue;
                }
                if (char === '"') {
                    in_string = !in_string;
                    continue;
                }
                if (!in_string) {
                    if (char === open_char) {
                        count++;
                    } else if (char === close_char) {
                        count--;
                        if (count === 0) {
                            results.push(s.substring(start_idx, k + 1));
                            i = k + 1;
                            found = true;
                            break;
                        }
                    }
                }
            }
            if (!found) {
                break;
            }
        }
        return results;
    }

    private _clean_json(response_string: string): string {
        if (!response_string) {
            return "";
        }

        const fenceRegex = /```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```/gs;
        const extracted_parts: string[] = [];
        let match;
        
        // Try match standard fences first
        const matches = [...response_string.matchAll(fenceRegex)];
        if (matches.length > 0) {
            for (const m of matches) {
                extracted_parts.push(...this._extract_json_objects(m[1]));
            }
        } else {
            extracted_parts.push(...this._extract_json_objects(response_string));
        }

        if (extracted_parts.length === 0) {
            return response_string;
        }

        if (extracted_parts.length === 1) {
            return extracted_parts[0];
        }

        return "[" + extracted_parts.join(",\n") + "]";
    }

    private _parse_json_response(response_content: string): any {
        if (!response_content) {
            return null;
        }

        const cleaned_content = this._clean_json(response_content);
        try {
            return JSON.parse(cleaned_content);
        } catch (e) {
            // Try parsing individual repaired objects
            const extracted_objs = this._extract_json_objects(cleaned_content);
            const repaired_objs: any[] = [];
            for (const obj of extracted_objs) {
                try {
                    repaired_objs.push(JSON.parse(obj));
                } catch {
                    try {
                        const repaired = this._repair_json_string(obj);
                        repaired_objs.push(JSON.parse(repaired));
                    } catch {
                        // ignore failed repair
                    }
                }
            }
            if (repaired_objs.length > 0) {
                if (repaired_objs.length === 1) {
                    return repaired_objs[0];
                }
                return repaired_objs;
            }

            // Fallback to general repair
            try {
                const repaired = this._repair_json_string(cleaned_content);
                return JSON.parse(repaired);
            } catch (repair_err) {
                this.logger.warning(`JSON response was not valid and repair failed: ${response_content}. Error: ${repair_err}`);
                return response_content;
            }
        }
    }

    private _repair_json_string(s: string): string {
        const find_key_pos = (pattern: RegExp, text: string, start_idx: number = 0): [number, number] => {
            const search_text = text.substring(start_idx);
            const match = pattern.exec(search_text);
            if (match) {
                const start = start_idx + match.index;
                const end = start + match[0].length;
                return [start, end];
            }
            return [-1, -1];
        };

        const decode_val = (val: string): string => {
            if (typeof val !== 'string') return val;
            try {
                // Decode common JSON escape sequences
                return val
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\r/g, '\r')
                    .replace(/\\\\/g, '\\');
            } catch {
                return val;
            }
        };

        const thought_start_pattern = /"thought"\s*:\s*"/g;
        const tool_start_pattern = /"tool"\s*:\s*"/g;
        const done_start_pattern = /"done"\s*:\s*/g;
        const output_start_pattern = /"output"\s*:\s*"/g;

        const [idx_thought_key_start, idx_thought_val_start] = find_key_pos(thought_start_pattern, s);
        if (idx_thought_key_start === -1) {
            return s;
        }

        const [idx_tool_key_start, idx_tool_val_start] = find_key_pos(tool_start_pattern, s, idx_thought_val_start);
        const [idx_done_key_start, idx_done_val_start] = find_key_pos(done_start_pattern, s, idx_thought_val_start);

        let thought_val = "";
        let tool_val: string | null = null;
        let done_val: boolean | null = null;
        let arguments_val: any = null;
        let output_val: string | null = null;

        let next_key_idx = -1;
        if (idx_tool_key_start !== -1) {
            next_key_idx = idx_tool_key_start;
        } else if (idx_done_key_start !== -1) {
            next_key_idx = idx_done_key_start;
        }

        if (next_key_idx === -1) {
            const last_quote = s.lastIndexOf('"');
            if (last_quote > idx_thought_val_start) {
                thought_val = decode_val(s.substring(idx_thought_val_start, last_quote));
            } else {
                thought_val = decode_val(s.substring(idx_thought_val_start));
            }
        } else {
            const search_area = s.substring(idx_thought_val_start, next_key_idx);
            const last_quote_in_search = search_area.lastIndexOf('"');
            if (last_quote_in_search !== -1) {
                thought_val = decode_val(search_area.substring(0, last_quote_in_search));
            } else {
                thought_val = decode_val(search_area);
            }
        }

        if (idx_done_key_start !== -1 && (idx_tool_key_start === -1 || idx_done_key_start < idx_tool_key_start)) {
            const [idx_output_key_start, idx_output_val_start] = find_key_pos(output_start_pattern, s, idx_done_val_start);
            if (idx_output_key_start !== -1) {
                const done_str = s.substring(idx_done_val_start, idx_output_key_start).trim().replace(/,$/, '').trim().replace(/"/g, '').trim();
                done_val = (done_str.toLowerCase() === "true");

                const last_brace = s.lastIndexOf('}');
                const search_area = s.substring(idx_output_val_start, last_brace);
                const last_quote = search_area.lastIndexOf('"');
                if (last_quote !== -1) {
                    output_val = decode_val(search_area.substring(0, last_quote));
                } else {
                    output_val = decode_val(search_area);
                }
            } else {
                const done_str = s.substring(idx_done_val_start).trim().replace(/\}$/, '').trim().replace(/"/g, '').trim();
                done_val = (done_str.toLowerCase() === "true");
            }
        } else if (idx_tool_key_start !== -1) {
            const [idx_args_key_start, idx_args_val_start] = find_key_pos(/"arguments"\s*:\s*\{/g, s, idx_tool_val_start);
            if (idx_args_key_start !== -1) {
                const search_area = s.substring(idx_tool_val_start, idx_args_key_start);
                const last_quote = search_area.lastIndexOf('"');
                if (last_quote !== -1) {
                    tool_val = decode_val(search_area.substring(0, last_quote));
                } else {
                    tool_val = decode_val(search_area);
                }

                const last_brace = s.lastIndexOf('}');
                const second_last_brace = s.substring(0, last_brace).lastIndexOf('}');
                const args_end_idx = second_last_brace !== -1 ? second_last_brace : last_brace;

                const args_block = s.substring(idx_args_val_start, args_end_idx);

                const arg_keys: Array<{ name: string; key_start: number; val_start: number }> = [];
                const key_regex = /"([a-zA-Z0-9_-]+)"\s*:/g;
                let key_match;
                while ((key_match = key_regex.exec(args_block)) !== null) {
                    arg_keys.push({
                        name: key_match[1],
                        key_start: key_match.index,
                        val_start: key_regex.lastIndex
                    });
                }

                arguments_val = {};
                for (let i = 0; i < arg_keys.length; i++) {
                    const name = arg_keys[i].name;
                    const start_search = arg_keys[i].val_start;
                    const first_quote = args_block.indexOf('"', start_search);
                    if (first_quote === -1) {
                        const end_val_idx = (i + 1 < arg_keys.length) ? arg_keys[i + 1].key_start : args_block.length;
                        const val_str = args_block.substring(start_search, end_val_idx).trim().replace(/,$/, '').trim().replace(/"/g, '').trim();
                        if (val_str.toLowerCase() === "true") {
                            arguments_val[name] = true;
                        } else if (val_str.toLowerCase() === "false") {
                            arguments_val[name] = false;
                        } else {
                            const num = Number(val_str);
                            arguments_val[name] = isNaN(num) ? val_str : num;
                        }
                    } else {
                        const val_start_idx = first_quote + 1;
                        if (i + 1 < arg_keys.length) {
                            const next_key_pos = arg_keys[i + 1].key_start;
                            const sub_search = args_block.substring(val_start_idx, next_key_pos);
                            const last_q = sub_search.lastIndexOf('"');
                            arguments_val[name] = last_q !== -1 ? decode_val(sub_search.substring(0, last_q)) : decode_val(sub_search);
                        } else {
                            const sub_search = args_block.substring(val_start_idx);
                            const last_q = sub_search.lastIndexOf('"');
                            arguments_val[name] = last_q !== -1 ? decode_val(sub_search.substring(0, last_q)) : decode_val(sub_search);
                        }
                    }
                }
            } else {
                const search_area = s.substring(idx_tool_val_start);
                const last_quote = search_area.lastIndexOf('"');
                tool_val = last_quote !== -1 ? decode_val(search_area.substring(0, last_quote)) : decode_val(search_area);
            }
        }

        const rebuilt: any = {};
        if (thought_val !== null) rebuilt["thought"] = thought_val;
        if (tool_val !== null) rebuilt["tool"] = tool_val;
        if (done_val !== null) rebuilt["done"] = done_val;
        if (output_val !== null) rebuilt["output"] = output_val;
        if (arguments_val !== null) rebuilt["arguments"] = arguments_val;

        return JSON.stringify(rebuilt, null, 2);
    }

    private _preprocess_video_for_gemini(video_path: string): string | null {
        const fps_env = process.env.GEMINI_VIDEO_FPS;
        const res_env = process.env.GEMINI_VIDEO_RES;
        if (!fps_env && !res_env) {
            return null;
        }

        const target_fps = fps_env ? parseFloat(fps_env) : null;
        const target_h = res_env ? parseInt(res_env, 10) : null;

        if (target_fps === null && target_h === null) {
            return null;
        }

        const tmp_path = path.join(os.tmpdir(), `gemini_preprocess_${Date.now()}_${path.basename(video_path)}`);

        // Build ffmpeg filters
        const filters: string[] = [];
        if (target_fps !== null && !isNaN(target_fps)) {
            filters.push(`fps=${target_fps}`);
        }
        if (target_h !== null && !isNaN(target_h)) {
            // scale maintaining aspect ratio, making height target_h (even pixels)
            filters.push(`scale=-2:${target_h % 2 === 0 ? target_h : target_h + 1}`);
        }

        const filter_arg = filters.join(',');
        const args = ['-y', '-i', video_path];
        if (filter_arg) {
            args.push('-filter:v', filter_arg);
        }
        // Preserve audio, use h264 CPU encoding
        args.push('-c:a', 'aac', '-preset', 'fast', tmp_path);

        this.logger.info(`Preprocessing video with ffmpeg: ffmpeg ${args.join(' ')}`);

        try {
            const completed = spawnSync('ffmpeg', args, { stdio: 'ignore' });
            if (completed.status === 0) {
                this.logger.info(`Preprocessed video successfully saved to: ${tmp_path}`);

                // Optionally save copy
                if ((process.env.SAVE_TEMP || "").trim().toLowerCase() === "true") {
                    const projectRoot = path.resolve(__dirname, '..');
                    const out_dir = path.join(projectRoot, "temp");
                    fs.mkdirSync(out_dir, { recursive: true });
                    const dest_path = path.join(out_dir, `${path.basename(video_path, path.extname(video_path))}_preprocessed.mp4`);
                    fs.copyFileSync(tmp_path, dest_path);
                    this.logger.info(`Saved preprocessed video copy to: ${dest_path}`);
                }

                return tmp_path;
            } else {
                this.logger.warning(`ffmpeg exit code ${completed.status}; using original video.`);
            }
        } catch (e: any) {
            this.logger.warning(`ffmpeg preprocessing failed: ${e.message}; using original video.`);
        }
        return null;
    }

    private _process_static_image(image_path: string): any {
        this.logger.debug(`Processing static image for OpenAI: ${image_path}`);
        if (!fs.existsSync(image_path)) {
            this.logger.error(`Image file not found at: ${image_path}`);
            throw new Error(`Image file not found at: ${image_path}`);
        }

        try {
            const ext = path.extname(image_path).toLowerCase();
            let mimeType = "image/jpeg";
            if (ext === ".png") mimeType = "image/png";
            else if (ext === ".webp") mimeType = "image/webp";
            else if (ext === ".gif") mimeType = "image/gif";

            const base64_image = fs.readFileSync(image_path).toString('base64');
            this.logger.info(`Successfully converted static image: ${image_path}`);
            return {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64_image}` }
            };
        } catch (e) {
            this.logger.error(`Failed to process static image: ${e}`);
            throw e;
        }
    }

    private _validate_pdf_path(pdf_path: string): void {
        if (!fs.existsSync(pdf_path)) {
            throw new Error(`PDF file not found at: ${pdf_path}`);
        }
        if (path.extname(pdf_path).toLowerCase() !== ".pdf") {
            throw new Error(`Expected a .pdf file, got: ${pdf_path}`);
        }
    }

    private _infer_attachment_kind(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
            return "image";
        }
        if (ext === ".pdf") {
            return "pdf";
        }
        if ([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"].includes(ext)) {
            return "video";
        }
        return "file";
    }

    private _normalize_attachments(attachments: any[], allow_missing: boolean = false): Array<{ path: string; kind: string }> {
        const normalized: Array<{ path: string; kind: string }> = [];
        const seen = new Set<string>();

        if (!attachments) return normalized;

        for (const item of attachments) {
            let filePath: string | null = null;
            let kind: string | null = null;

            if (typeof item === 'string') {
                filePath = item;
            } else if (item && typeof item === 'object') {
                filePath = item.path || item.file || item.filepath || null;
                kind = item.kind || item.type || null;
            }

            if (!filePath) continue;

            const abs_path = path.resolve(filePath);
            if (!fs.existsSync(abs_path)) {
                if (allow_missing) {
                    this.logger.warning(`Skipping missing attachment in history: ${abs_path}`);
                    continue;
                }
                throw new Error(`Attachment file not found: ${abs_path}`);
            }

            const resolved_kind = kind ? kind.trim().toLowerCase() : this._infer_attachment_kind(abs_path);
            const dedup_key = `${abs_path}::${resolved_kind}`;
            if (seen.has(dedup_key)) {
                continue;
            }
            seen.add(dedup_key);
            normalized.push({ path: abs_path, kind: resolved_kind });
        }

        return normalized;
    }

    private _merge_attachments(...groups: Array<Array<{ path: string; kind: string }> | undefined>): Array<{ path: string; kind: string }> {
        const merged: Array<{ path: string; kind: string }> = [];
        const seen = new Set<string>();
        for (const group of groups) {
            if (!group) continue;
            for (const att of group) {
                if (!att.path) continue;
                const key = `${att.path}::${att.kind || 'file'}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(att);
            }
        }
        return merged;
    }

    public clear_history(): void {
        this.history = [];
        this.logger.info("Conversation history cleared.");
        console.log("--- History Cleared ---");
    }

    private _get_trimmed_history(): typeof this.history {
        if (this.max_history_messages === null) {
            return this.history;
        }
        return this.history.slice(-this.max_history_messages);
    }

    private _enforce_history_limit(): void {
        if (this.max_history_messages === null) return;
        if (this.history.length > this.max_history_messages) {
            this.history = this.history.slice(-this.max_history_messages);
        }
    }

    public async generate(
        prompt: string,
        image_path: string | null = null,
        video_path: string | null = null,
        pdf_path: string | null = null,
        attachments: any[] | null = null,
        return_json: boolean | null = null,
        keep_history: boolean = false,
        video_sample_fps: number = 1.0
    ): Promise<any> {
        this.logger.info(`Generate called with model: ${this.model_name}`);
        if (image_path) this.logger.info(`  ... with image: ${image_path}`);
        if (video_path) this.logger.info(`  ... with video: ${video_path}`);
        if (pdf_path) this.logger.info(`  ... with pdf: ${pdf_path}`);
        if (attachments) this.logger.info(`  ... with attachments: ${attachments.length} item(s)`);

        const should_return_json = return_json === null ? this.return_json : return_json;
        this.logger.debug(`  ... return_json=${should_return_json}, keep_history=${keep_history}`);

        let normalized_current_attachments = this._normalize_attachments(attachments || []);
        const inline_attachments: string[] = [];
        if (image_path) inline_attachments.push(image_path);
        if (video_path) inline_attachments.push(video_path);
        if (pdf_path) inline_attachments.push(pdf_path);

        normalized_current_attachments = this._merge_attachments(
            normalized_current_attachments,
            this._normalize_attachments(inline_attachments)
        );

        if (video_path && this.api_type === "openai") {
            this.logger.error("OpenAI API wrapper does not support video input; use Google Gemini for video.");
            throw new Error("OpenAI does not support video input in this wrapper. Please use a Google Gemini model for video processing.");
        }
        if (this.api_type === "openai" && normalized_current_attachments.some(att => att.kind === "video")) {
            this.logger.error("OpenAI path does not support video attachments in this wrapper.");
            throw new Error("OpenAI does not support video attachments in this wrapper. Please use a Google Gemini model for video processing.");
        }

        if (this.api_type === "openai") {
            return this._generate_openai(
                prompt,
                image_path,
                pdf_path,
                normalized_current_attachments,
                should_return_json,
                keep_history,
                video_sample_fps
            );
        } else {
            return this._generate_google(
                prompt,
                image_path,
                video_path,
                pdf_path,
                normalized_current_attachments,
                should_return_json,
                keep_history
            );
        }
    }

    private async _generate_openai(
        prompt: string,
        image_path: string | null,
        pdf_path: string | null,
        current_attachments: Array<{ path: string; kind: string }>,
        return_json: boolean,
        keep_history: boolean,
        video_sample_fps: number
    ): Promise<any> {
        const history_to_send = keep_history ? this._get_trimmed_history() : [];
        let final_prompt = prompt;
        if (return_json && !final_prompt.toLowerCase().includes("json")) {
            final_prompt += "\n\nYou must return a valid JSON object.";
        }

        const history_has_attachments = history_to_send.some(msg => msg.attachments && msg.attachments.length > 0);
        let only_inline_image = false;
        if (image_path && current_attachments.length === 1) {
            const abs_image = path.resolve(image_path);
            only_inline_image = current_attachments[0].kind === "image" && path.resolve(current_attachments[0].path) === abs_image;
        }

        const use_responses_api = !!(
            this.system_attachments.length > 0 ||
            (current_attachments.length > 0 && !only_inline_image) ||
            history_has_attachments ||
            pdf_path
        );

        const uploaded_file_ids: string[] = [];

        const _upload_openai_attachments = async (att_list: Array<{ path: string; kind: string }>): Promise<any[]> => {
            const parts: any[] = [];
            for (const att of att_list) {
                const uploaded = await this._client.files.create({
                    file: fs.createReadStream(att.path),
                    purpose: "user_data"
                });
                uploaded_file_ids.push(uploaded.id);
                parts.push({ type: "input_file", file_id: uploaded.id });
            }
            return parts;
        };

        try {
            let response_content = "";
            if (use_responses_api) {
                const input_messages: any[] = [];

                const system_parts: any[] = [];
                if (this.system_content) {
                    system_parts.push({ type: "input_text", text: this.system_content });
                }
                system_parts.push(...(await _upload_openai_attachments(this.system_attachments)));
                if (system_parts.length > 0) {
                    input_messages.push({ role: "system", content: system_parts });
                }

                for (const msg of history_to_send) {
                    const mapped_role = msg.role === "model" ? "assistant" : msg.role;
                    const msg_parts: any[] = [];
                    if (msg.content) {
                        msg_parts.push({ type: "input_text", text: msg.content });
                    }
                    const hist_att = this._normalize_attachments(msg.attachments || [], true);
                    msg_parts.push(...(await _upload_openai_attachments(hist_att)));
                    if (msg_parts.length > 0) {
                        input_messages.push({ role: mapped_role, content: msg_parts });
                    }
                }

                const input_parts: any[] = [{ type: "input_text", text: final_prompt }];
                input_parts.push(...(await _upload_openai_attachments(current_attachments)));
                input_messages.push({ role: "user", content: input_parts });

                const response_kwargs: any = {
                    model: this.model_name,
                    input: input_messages,
                };
                if (return_json) {
                    response_kwargs["text"] = { format: { type: "json_object" } };
                }
                const gpt_max_tokens = process.env.GPT_MAX_TOKENS;
                if (gpt_max_tokens) {
                    response_kwargs["max_output_tokens"] = parseInt(gpt_max_tokens, 10);
                }

                this.logger.debug("Sending request to OpenAI Responses API...");
                const response = await this._client.responses.create(response_kwargs);
                response_content = response.output_text || JSON.stringify(response);
            } else {
                const messages: any[] = [];
                if (this.system_content) {
                    messages.push({ role: "system", content: this.system_content });
                }
                for (const msg of history_to_send) {
                    messages.push({
                        role: msg.role === "model" ? "assistant" : msg.role,
                        content: msg.content
                    });
                }

                const user_content: any[] = [{ type: "text", text: final_prompt }];
                if (image_path) {
                    this.logger.info(`Processing static image: ${image_path}`);
                    try {
                        user_content.push(this._process_static_image(image_path));
                    } catch (e) {
                        this.logger.error(`Error processing static image: ${e}`);
                        return null;
                    }
                }
                messages.push({ role: "user", content: user_content });

                const request_params: any = {
                    model: this.model_name,
                    messages: messages,
                };
                const gpt_max_tokens = process.env.GPT_MAX_TOKENS;
                if (gpt_max_tokens) {
                    request_params["max_completion_tokens"] = parseInt(gpt_max_tokens, 10);
                }
                if (return_json) {
                    request_params["response_format"] = { type: "json_object" };
                }

                this.logger.debug("Sending request to OpenAI Chat Completions API...");
                const response = await this._client.chat.completions.create(request_params);
                response_content = response.choices[0].message.content || "";
            }

            this.logger.debug(`Received response from OpenAI:${response_content}`);

            if (keep_history && response_content) {
                this.history.push({
                    role: "user",
                    content: prompt,
                    attachments: current_attachments,
                });
                this.history.push({ role: "model", content: response_content });
                this._enforce_history_limit();
            }

            if (return_json && response_content) {
                return this._parse_json_response(response_content);
            }
            return response_content;
        } catch (e) {
            this.logger.error(`Error calling OpenAI: ${e}`);
            return null;
        } finally {
            for (const file_id of uploaded_file_ids) {
                try {
                    await this._client.files.delete(file_id);
                } catch {
                    // ignore
                }
            }
        }
    }

    private async _generate_google(
        prompt: string,
        image_path: string | null,
        video_path: string | null,
        pdf_path: string | null,
        current_attachments: Array<{ path: string; kind: string }>,
        return_json: boolean,
        keep_history: boolean
    ): Promise<any> {
        const contents: any[] = [];
        const uploaded_files: any[] = [];
        const temp_local_paths: string[] = [];

        const _upload_google_attachment = async (att: { path: string; kind: string }): Promise<any> => {
            let upload_path = att.path;
            if (att.kind === "video") {
                const preprocessed = this._preprocess_video_for_gemini(upload_path);
                if (preprocessed) {
                    upload_path = preprocessed;
                    temp_local_paths.push(preprocessed);
                }
            }

            // Detect MIME type based on extension
            const ext = path.extname(upload_path).toLowerCase();
            let mimeType = undefined;
            if (ext === ".png") mimeType = "image/png";
            else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
            else if (ext === ".pdf") mimeType = "application/pdf";
            else if (ext === ".mp4") mimeType = "video/mp4";

            this.logger.info(`Uploading file to Gemini: ${upload_path}`);
            let file_ref = await this._client.files.upload({
                file: upload_path,
                mimeType: mimeType
            });

            let state_name = file_ref.state;
            while (state_name !== "ACTIVE") {
                await new Promise(resolve => setTimeout(resolve, 2000));
                file_ref = await this._client.files.get({ name: file_ref.name });
                state_name = file_ref.state;
                if (state_name === "FAILED") {
                    throw new Error(`File processing failed for ${att.path}: ${state_name}`);
                }
            }
            uploaded_files.push(file_ref);
            return file_ref;
        };

        try {
            if (this.system_content) {
                contents.push({ role: "system", parts: [{ text: this.system_content }] });
            }

            for (const att of this.system_attachments) {
                const file_ref = await _upload_google_attachment(att);
                contents.push(file_ref);
            }

            const history_to_send = keep_history ? this._get_trimmed_history() : [];
            for (const msg of history_to_send) {
                let role = msg.role;
                if (role === "assistant") {
                    role = "model";
                }
                contents.push({ role, parts: [{ text: msg.content }] });

                const hist_att = this._normalize_attachments(msg.attachments || [], true);
                for (const att of hist_att) {
                    const file_ref = await _upload_google_attachment(att);
                    contents.push(file_ref);
                }
            }

            // User prompt
            contents.push({ role: "user", parts: [{ text: prompt }] });

            for (const att of current_attachments) {
                const file_ref = await _upload_google_attachment(att);
                contents.push(file_ref);
            }

            const generation_config: any = {};
            if (return_json) {
                generation_config.responseMimeType = "application/json";
            }

            this.logger.debug("Sending request to Google Gemini API (Client models.generate_content)...");
            const response = await this._client.models.generateContent({
                model: this.model_name,
                contents: contents,
                config: generation_config
            });


            let response_content = response.text || null;
            if (response_content === null && response.candidates && response.candidates.length > 0) {
                try {
                    response_content = response.candidates[0].content.parts[0].text || null;
                } catch {
                    response_content = null;
                }
            }

            if (keep_history && response_content) {
                this.history.push({
                    role: "user",
                    content: prompt,
                    attachments: current_attachments,
                });
                this.history.push({ role: "model", content: response_content });
                this._enforce_history_limit();
            }

            if (return_json && response_content) {
                return this._parse_json_response(response_content);
            }
            return response_content;

        } catch (e: any) {
            this.logger.error(`Error calling Google Gemini: ${e.message}`);
            return null;
        } finally {
            for (const file_ref of uploaded_files) {
                try {
                    if (file_ref.state === "ACTIVE") {
                        await this._client.files.delete({ name: file_ref.name });
                    }
                } catch {
                    // ignore
                }
            }
            for (const local_path of temp_local_paths) {
                try {
                    if (fs.existsSync(local_path)) {
                        fs.unlinkSync(local_path);
                    }
                } catch {
                    // ignore
                }
            }
        }
    }
}
