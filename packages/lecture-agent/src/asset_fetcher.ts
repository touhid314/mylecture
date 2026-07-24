/**
 * packages/lecture-agent/src/asset_fetcher.ts
 *
 * Programmatic API, CLI tool, and Agent Tool to search for or generate images.
 *
 * Programmatic API:
 *   import { downloadImage } from './asset_fetcher.js';
 *   await downloadImage({ prompt: '...', mode: 'gen', ... });
 *
 * CLI Usage:
 *   npx tsx packages/lecture-agent/src/asset_fetcher.ts --prompt "your prompt" --mode [search|gen] [options]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import sharp from 'sharp';

import { build_prompt } from './prompt_builder.js';
import { resolve_workspace_path } from './workspace.js';
import { LLM_Model } from './utils/llm_model.js';
import { safeRelativeFile } from './lecturegen_shared.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find and load .env file
function loadEnv() {
    let dir = __dirname;
    while (dir && dir !== path.parse(dir).root) {
        const envPath = path.join(dir, '.env');
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath });
            return;
        }
        dir = path.dirname(dir);
    }
}
loadEnv();

type GetimgModel = 'gemini-flash-lite' | 'gemini-flash' | 'gemini-pro' | 'gpt-image-2';

function cleanEnvValue(value: string | undefined): string {
    let cleaned = value || "";
    cleaned = cleaned.split('#')[0].trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    return cleaned;
}

function getDefaultGetimgModel(): GetimgModel {
    const configured = cleanEnvValue(process.env.GETIMG_MODEL).toLowerCase();
    if (configured === 'gemini-flash-lite' || configured === 'gemini-flash' || configured === 'gemini-pro' || configured === 'gpt-image-2') {
        return configured as GetimgModel;
    }
    return 'gemini-flash-lite';
}

function getWatchmanModel(): string {
    return cleanEnvValue(process.env.GETIMG_WATCHMAN_MODEL) || 'gemini-2.5-flash';
}

/**
 * Options configuration for the image downloader.
 */
export interface DownloadOptions {
    /** The search query or AI generation prompt. */
    prompt: string;
    /** 'search' to search the web, 'gen' to generate using AI. */
    mode: 'search' | 'gen';
    /** The AI model to use (only applicable for 'gen' mode). Defaults to GETIMG_MODEL. */
    model?: GetimgModel;
    /** Output file path. */
    out: string;
    /** Optional width (in pixels) for the generated image. */
    width?: number;
    /** Optional height (in pixels) for the generated image. */
    height?: number;
    /** Optional aspect ratio constraint (e.g. '1:1', '16:9'). */
    aspect?: string;
    /** Optional resolution tier (only applicable for Gemini generation). */
    resolution?: '0.5K' | '512' | '1K' | '2K' | '4K';
    /** Whether to verify the output using the Watchman agent. Default is true. */
    watchman?: boolean;
    /** Whether to log/save rejected images to a 'watchman-failed' directory. Default is false. */
    logWatchman?: boolean;
}

/**
 * Searches DuckDuckGo Images for the given query.
 * @param query - The search query string.
 * @returns A promise resolving to an array of image URLs.
 */
async function searchDuckDuckGoImages(query: string): Promise<string[]> {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    const homepageUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    const responseHtml = await fetch(homepageUrl, { headers });
    const html = await responseHtml.text();

    const vqdMatch = html.match(/vqd=([^&'"]+)/);
    if (!vqdMatch) {
        throw new Error("Failed to extract VQD token from DuckDuckGo response.");
    }
    const vqd = vqdMatch[1];

    const searchUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,`;
    const responseJson = await fetch(searchUrl, { headers: { ...headers, 'Referer': 'https://duckduckgo.com/' } });
    if (!responseJson.ok) {
        throw new Error(`DuckDuckGo image API returned status ${responseJson.status}`);
    }

    const data = (await responseJson.json()) as any;
    if (!data.results || data.results.length === 0) {
        throw new Error("No images found on DuckDuckGo for query: " + query);
    }

    return data.results.map((r: any) => r.image);
}

/**
 * Detects the MIME type of an image buffer based on its magic number bytes.
 * @param buffer - The image data buffer.
 * @returns The MIME type string (defaults to 'image/jpeg').
 */
function getMimeType(buffer: Buffer): string {
    if (buffer.length > 4) {
        if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
            return 'image/jpeg';
        }
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
            return 'image/png';
        }
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return 'image/gif';
        }
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
            return 'image/webp';
        }
    }
    return 'image/jpeg';
}

/**
 * Resizes an image buffer to fit inside 480p dimensions for the LLM model to read efficiently.
 * @param buffer - The original image buffer.
 * @returns A promise resolving to the resized image buffer.
 */
async function resizeTo480p(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
        .resize({ height: 480, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
}

/**
 * Invokes the configured Watchman model to verify if a single image satisfies the user's prompt request.
 * @param apiKey - The Google API key.
 * @param prompt - The user prompt/query that description should match.
 * @param imageBuffer - The image data buffer to verify (should be resized).
 * @param mimeType - The MIME type of the image.
 * @returns Verification result with `fulfilled` boolean and a `reason` string.
 */
async function watchmanImageWithGemini(
    prompt: string,
    imageBuffer: Buffer,
    mimeType: string = 'image/jpeg'
): Promise<{ fulfilled: boolean; reason: string }> {
    const base64Image = imageBuffer.toString('base64');
    const watchmanModel = getWatchmanModel();
    const modelInstance = new LLM_Model(watchmanModel);
    modelInstance.token_tracker_session_id = process.env.TOKEN_TRACKER_SESSION_ID || null;
    modelInstance.token_tracker_purpose = "watchman_image_verification";

    const response = await modelInstance.generateContent({
        model: watchmanModel,
        contents: [
            {
                inlineData: {
                    data: base64Image,
                    mimeType: mimeType
                }
            },
            build_prompt(`User request: "${prompt}"\n\nVerify if this image fulfills the user's request. Return a JSON object with:
- "fulfilled" (boolean): true if the image is a high-quality, relevant image that properly fulfills the user request. false if it has errors, irrelevant subject, watermark, or doesn't match the query.
- "reason" (string): brief explanation of your choice.`)
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    fulfilled: { type: "BOOLEAN" },
                    reason: { type: "STRING" }
                },
                required: ["fulfilled", "reason"]
            }
        }
    }, "watchman_image_verification");

    let text = "";
    if (response.text) {
        text = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
    }

    try {
        const result = JSON.parse(text);
        return {
            fulfilled: !!result.fulfilled,
            reason: result.reason || ''
        };
    } catch (e) {
        console.warn("[Watchman Agent] Failed to parse Gemini response as JSON:", text);
        const lower = text.toLowerCase();
        return {
            fulfilled: lower.includes('"fulfilled": true') || lower.includes('"fulfilled":true'),
            reason: "Parsed text: " + text
        };
    }
}

/**
 * Invokes the configured Watchman model to choose the best matching image from multiple candidate image buffers.
 * @param apiKey - The Google API key.
 * @param prompt - The user prompt/query to verify against.
 * @param images - An array of image structures with buffers and MIME types.
 * @returns Verification result containing the 1-based index of the best image or -1 if none fit.
 */
async function watchmanMultipleImagesWithGemini(
    prompt: string,
    images: { buffer: Buffer; mimeType: string }[]
): Promise<{ bestImageIndex: number; reason: string }> {
    const watchmanModel = getWatchmanModel();
    const modelInstance = new LLM_Model(watchmanModel);
    modelInstance.token_tracker_session_id = process.env.TOKEN_TRACKER_SESSION_ID || null;
    modelInstance.token_tracker_purpose = "watchman_multiple_images_verification";
    const contents: any[] = [];

    images.forEach((img) => {
        contents.push({
            inlineData: {
                data: img.buffer.toString('base64'),
                mimeType: img.mimeType
            }
        });
    });

    const promptText = `User request: "${prompt}"\n\nAbove, you are provided with ${images.length} candidate images (labeled in sequence: Image 1, Image 2, etc. based on the order of the images provided).\n\nVerify if any of these images fulfill the user's request. If one or more do, return the 1-based index (1 to ${images.length}) of the best matching image in "bestImageIndex". If none of the images match or fulfill the request, return -1 in "bestImageIndex".\n\nReturn a JSON object with:
- "bestImageIndex" (number): the 1-based index of the best image that fulfills the request (e.g. 1, 2, 3, etc.), or -1 if none of them are suitable.
- "reason" (string): explanation of your choice.`;

    contents.push(build_prompt(promptText));

    const response = await modelInstance.generateContent({
        model: watchmanModel,
        contents: contents,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: {
                    bestImageIndex: { type: "INTEGER" },
                    reason: { type: "STRING" }
                },
                required: ["bestImageIndex", "reason"]
            }
        }
    }, "watchman_multiple_images_verification");

    let text = "";
    if (response.text) {
        text = response.text;
    } else if (response.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = response.candidates[0].content.parts[0].text;
    }

    try {
        const result = JSON.parse(text);
        return {
            bestImageIndex: typeof result.bestImageIndex === 'number' ? result.bestImageIndex : -1,
            reason: result.reason || ''
        };
    } catch (e) {
        console.warn("[Watchman Agent] Failed to parse Gemini multi-image response as JSON:", text);
        return {
            bestImageIndex: -1,
            reason: "Failed to parse JSON response."
        };
    }
}

/**
 * Saves a failed verification image buffer to a 'watchman-failed' subdirectory for debugging.
 * @param out - The original target output path.
 * @param buffer - The image data buffer that failed verification.
 * @param index - Optional index (for candidate sequences).
 */
function saveFailedImage(out: string, buffer: Buffer, index?: number) {
    const dir = path.dirname(out);
    const failedDir = path.join(dir, 'watchman-failed');
    if (!fs.existsSync(failedDir)) {
        fs.mkdirSync(failedDir, { recursive: true });
    }
    const ext = path.extname(out) || '.png';
    const base = path.basename(out, ext);
    const timestamp = Date.now();
    const idxStr = index !== undefined ? `_candidate_${index}` : '';
    const filename = `${base}_failed_${timestamp}${idxStr}${ext}`;
    const failedPath = path.join(failedDir, filename);
    fs.writeFileSync(failedPath, buffer);
    console.log(`[Watchman Agent] Saved failed image to: ${failedPath}`);
}

/**
 * Performs Watchman verification check on a generated image buffer.
 * @param options - DownloadOptions settings.
 * @param buffer - The generated image buffer.
 */
async function performWatchmanCheckForGen(options: DownloadOptions, buffer: Buffer) {
    if (options.watchman === false) {
        return;
    }
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
        console.warn("[Watchman Agent] Warning: GOOGLE_API_KEY is not defined. Skipping watchman check.");
        return;
    }
    const mimeType = getMimeType(buffer);
    console.log(`[Watchman Agent] Resizing generated image to 480p...`);
    const resizedBuffer = await resizeTo480p(buffer);
    console.log(`[Watchman Agent] Asking ${getWatchmanModel()} to verify the generated image...`);
    const verification = await watchmanImageWithGemini(options.prompt, resizedBuffer, mimeType);
    console.log(`[Watchman Agent] Verdict: fulfilled = ${verification.fulfilled}, reason = "${verification.reason}"`);
    if (!verification.fulfilled) {
        if (options.logWatchman) {
            saveFailedImage(options.out, buffer);
        }
        throw new Error(`Watchman verification failed: ${verification.reason}`);
    }
}

/**
 * Search mode implementation. Searches DuckDuckGo, downloads candidates,
 * and verifies/selects the best image matching the prompt.
 * @param options - Configuration settings.
 */
async function handleSearchMode(options: DownloadOptions) {
    const { prompt, out } = options;
    console.log(`[Search Mode] Searching DuckDuckGo for: "${prompt}"...`);

    const imageUrls = await searchDuckDuckGoImages(prompt);
    console.log(`[Search Mode] Found ${imageUrls.length} image results. Trying to download first candidate...`);

    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        throw new Error("GOOGLE_API_KEY environment variable is not defined.");
    }

    let downloadedBuffer: Buffer | null = null;
    let mimeType = 'image/jpeg';
    let firstWorkingIndex = -1;

    for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        console.log(`[Search Mode] Attempting to download candidate: ${url}`);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                continue;
            }

            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            if (buffer.length < 1000) {
                continue;
            }

            downloadedBuffer = buffer;
            mimeType = getMimeType(buffer);
            firstWorkingIndex = i;
            break;
        } catch (e) {
            // ignore and try next
        }
    }

    if (!downloadedBuffer) {
        throw new Error("Failed to download any candidate image from DuckDuckGo search results.");
    }

    if (options.watchman === false) {
        console.log(`[Search Mode] Watchman verification disabled. Saving the first working image directly...`);
        const dir = path.dirname(out);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(out, downloadedBuffer);
        console.log(`[Search Mode] Successfully saved image to ${out} (${downloadedBuffer.length} bytes)`);
        return;
    }

    // Pass the first downloaded image to the watchman agent
    console.log(`[Watchman Agent] Resizing first downloaded image to 480p...`);
    const resizedFirstBuffer = await resizeTo480p(downloadedBuffer);

    console.log(`[Watchman Agent] Asking ${getWatchmanModel()} to verify image...`);
    const verification = await watchmanImageWithGemini(prompt, resizedFirstBuffer, mimeType);
    console.log(`[Watchman Agent] Verdict: fulfilled = ${verification.fulfilled}, reason = "${verification.reason}"`);

    if (verification.fulfilled) {
        // Save the original image to out
        const dir = path.dirname(out);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(out, downloadedBuffer);
        console.log(`[Search Mode] Successfully verified and saved first image to ${out} (${downloadedBuffer.length} bytes)`);
        return;
    }

    if (options.logWatchman) {
        saveFailedImage(out, downloadedBuffer, 1);
    }

    // First image was not verified. Download 5 more images.
    console.log(`[Search Mode] First image did not fulfill request. Downloading 5 alternative candidate images...`);
    
    const alternativeCandidates: { buffer: Buffer; mimeType: string; url: string }[] = [];
    // Start searching after the first working index
    for (let i = firstWorkingIndex + 1; i < imageUrls.length && alternativeCandidates.length < 5; i++) {
        const url = imageUrls[i];
        console.log(`[Search Mode] Attempting to download alternative candidate [${alternativeCandidates.length + 1}/5]: ${url}`);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                continue;
            }

            const arrayBuffer = await res.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            if (buffer.length < 1000) {
                continue;
            }

            alternativeCandidates.push({
                buffer,
                mimeType: getMimeType(buffer),
                url
            });
        } catch (e) {
            // ignore and try next
        }
    }

    if (alternativeCandidates.length === 0) {
        throw new Error("No alternative images could be successfully downloaded for verification.");
    }

    console.log(`[Watchman Agent] Resizing ${alternativeCandidates.length} candidate images to 480p...`);
    const resizedCandidates = await Promise.all(alternativeCandidates.map(async (candidate) => {
        const resized = await resizeTo480p(candidate.buffer);
        return {
            buffer: resized,
            mimeType: candidate.mimeType
        };
    }));

    console.log(`[Watchman Agent] Asking ${getWatchmanModel()} to verify the ${alternativeCandidates.length} candidate images...`);
    const multiVerification = await watchmanMultipleImagesWithGemini(prompt, resizedCandidates);
    console.log(`[Watchman Agent] Verdict: bestImageIndex = ${multiVerification.bestImageIndex}, reason = "${multiVerification.reason}"`);

    const selectedIndex = multiVerification.bestImageIndex - 1; // Convert 1-based to 0-based
    if (selectedIndex >= 0 && selectedIndex < alternativeCandidates.length) {
        const chosen = alternativeCandidates[selectedIndex];
        const dir = path.dirname(out);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(out, chosen.buffer);
        console.log(`[Search Mode] Successfully verified and saved selected image (${multiVerification.bestImageIndex}) to ${out} (${chosen.buffer.length} bytes)`);
    } else {
        if (options.logWatchman) {
            alternativeCandidates.forEach((candidate, idx) => {
                saveFailedImage(out, candidate.buffer, idx + 2); // Start index from 2 since 1 was the first image
            });
        }
        throw new Error(`None of the alternative downloaded images fulfilled the user's request. Agent explanation: ${multiVerification.reason}`);
    }
}

/**
 * Gemini image generation handler. Configures and calls the Google GenAI SDK.
 * @param options - Configuration settings.
 * @param modelName - The system model name (e.g. 'gemini-3.1-flash-lite-image').
 */
async function handleGeminiImageMode(options: DownloadOptions, modelName: string) {
    const { prompt, out, aspect, resolution } = options;
    console.log(`[Gemini Mode] Generating image via ${modelName}...`);

    const modelInstance = new LLM_Model(modelName);
    modelInstance.token_tracker_session_id = process.env.TOKEN_TRACKER_SESSION_ID || null;
    modelInstance.token_tracker_purpose = "image_generation";

    const response = await modelInstance.generateImage({
        prompt: build_prompt(prompt, path.dirname(out)),
        aspect,
        resolution
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (!parts || parts.length === 0) {
        if (candidate?.finishReason) {
            if (candidate.finishReason === 'NO_IMAGE') {
                throw new Error(`Gemini generation finished with reason: NO_IMAGE. The model chose not to generate an image for this prompt (possibly due to safety/moderation filtering, text rendering constraints, or comparison requests). Try using the '--mode search' web search mode instead!`);
            }
            throw new Error(`No content parts returned by Gemini image generation. Finish reason: ${candidate.finishReason}.`);
        }
        throw new Error("No content parts returned by Gemini image generation.");
    }

    let buffer: Buffer | null = null;
    for (const part of parts) {
        if (part.inlineData) {
            const base64Data = part.inlineData.data;
            if (base64Data) {
                buffer = Buffer.from(base64Data, 'base64');
                break;
            }
        }
    }

    if (!buffer) {
        throw new Error("No inline image data found in response parts.");
    }

    // Verify generated image with watchman
    await performWatchmanCheckForGen(options, buffer);

    // Ensure directory exists
    const dir = path.dirname(out);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(out, buffer);
    console.log(`[Gemini Mode] Successfully saved image to ${out} (${buffer.length} bytes)`);
}

/**
 * OpenAI gpt-image-2 generation handler. Configures and calls the OpenAI SDK.
 * @param options - Configuration settings.
 */
async function handleGptImageMode(options: DownloadOptions) {
    const { prompt, out, aspect } = options;
    console.log(`[gpt-image-2 Mode] Generating image via OpenAI gpt-image-2...`);

    const modelInstance = new LLM_Model("gpt-image-2");
    modelInstance.token_tracker_session_id = process.env.TOKEN_TRACKER_SESSION_ID || null;
    modelInstance.token_tracker_purpose = "image_generation";

    const response = await modelInstance.generateImage({
        prompt: build_prompt(prompt, path.dirname(out)),
        aspect
    });

    if (!response.data || response.data.length === 0) {
        throw new Error("No image data returned by OpenAI.");
    }

    const b64Data = response.data[0].b64_json;
    let buffer: Buffer;

    if (b64Data) {
        buffer = Buffer.from(b64Data, 'base64');
    } else {
        const url = response.data[0].url;
        if (!url) {
            throw new Error("No image data (b64_json or url) returned by OpenAI.");
        }
        console.log(`[gpt-image-2 Mode] Fetching generated image from URL: ${url}`);
        const imageRes = await fetch(url);
        if (!imageRes.ok) {
            throw new Error("Failed to fetch image from OpenAI URL. Status: " + imageRes.status);
        }
        const arrayBuffer = await imageRes.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
    }

    // Verify generated image with watchman
    await performWatchmanCheckForGen(options, buffer);

    // Ensure directory exists
    const dir = path.dirname(out);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(out, buffer);
    console.log(`[gpt-image-2 Mode] Successfully saved image to ${out} (${buffer.length} bytes)`);
}

/**
 * Programmatic API entrypoint to retrieve or generate images.
 * @param options - Parameters for the downloader/generator.
 */
export async function downloadImage(options: DownloadOptions): Promise<void> {
    const { mode, model, out, resolution } = options;

    if (mode === 'gen') {
        const selectedModel = model || getDefaultGetimgModel();
        if (selectedModel === 'gpt-image-2' && resolution !== undefined) {
            console.warn("Warning: --resolution is ignored for OpenAI gpt-image-2.");
        }
        if (selectedModel === 'gemini-flash-lite' && resolution !== undefined && resolution !== '1K') {
            throw new Error(`Error: gemini-flash-lite only supports 1K resolution.`);
        }
        if (selectedModel === 'gemini-pro' && resolution !== undefined && (resolution === '0.5K' || resolution === '512')) {
            throw new Error(`Error: gemini-pro does not support 0.5K (512) resolution. Supported resolutions are: 1K, 2K, 4K.`);
        }

        switch (selectedModel) {
            case 'gemini-flash-lite':
                await handleGeminiImageMode(options, 'gemini-3.1-flash-lite-image');
                break;
            case 'gemini-flash':
                await handleGeminiImageMode(options, 'gemini-3.1-flash-image');
                break;
            case 'gemini-pro':
                await handleGeminiImageMode(options, 'gemini-3-pro-image');
                break;
            case 'gpt-image-2':
                await handleGptImageMode(options);
                break;
        }
    } else {
        // mode === 'search'
        if (model !== undefined) {
            console.warn("Warning: --model is ignored when --mode is 'search'.");
        }
        if (resolution !== undefined) {
            console.warn("Warning: --resolution is ignored when --mode is 'search'.");
        }
        await handleSearchMode(options);
    }
}

/**
 * Prints help documentation for CLI usage.
 */
function printHelp() {
    console.log(`
Usage:
  npx tsx packages/lecture-agent/src/asset_fetcher.ts --prompt <prompt> [options]

Required:
  -p, --prompt <string>       The search query or AI generation prompt.

Options:
  -m, --mode <string>         Image source mode:
                              - search: Search DuckDuckGo Images and download the first working result (Default).
                              - gen: Generate an image using an AI model.
  --model <string>            The AI model to use when --mode is 'gen':
                              - gemini-flash-lite: Gemini 3.1 Flash Lite Image (Nano Banana Lite).
                              - gemini-flash: Gemini 3.1 Flash Image (Nano Banana 2).
                              - gemini-pro: Gemini 3 Pro Image (Nano Banana Pro).
                              - gpt-image-2: OpenAI gpt-image-2 (requires OPENAI_API_KEY).
  -o, --out <string>          Path to save the downloaded image. (Default: ./downloaded_image.png)
  -w, --width <number>        Optional: width of the generated image.
  -h, --height <number>       Optional: height of the generated image.
  -a, --aspect <string>       Optional: aspect ratio for AI generation (e.g., "1:1", "16:9", "4:3", "3:2", "2:3").
  -r, --res, --resolution     Optional: resolution tier for Gemini generations ("0.5K", "512", "1K", "2K", "4K").
  Default gen model comes from GETIMG_MODEL. Watchman model comes from GETIMG_WATCHMAN_MODEL.
  --no-watchman               Disable LLM image verification in search and gen modes.
  --log-watchman              Save all images that fail Watchman verification to a 'watchman-failed' directory.
  --help                      Show this message.
`);
}

/**
 * Parse CLI arguments and run the tool.
 */
async function main() {
    const args = process.argv.slice(2);
    let prompt = "";
    let mode: DownloadOptions['mode'] = "search";
    let model: DownloadOptions['model'] = undefined;
    let resolution: DownloadOptions['resolution'] = undefined;
    let out = "./downloaded_image.png";
    let width: number | undefined;
    let height: number | undefined;
    let aspect: string | undefined;
    let watchman = true;
    let logWatchman = false;

    if (args.includes('--help') || args.includes('-h') && args.length === 1) {
        printHelp();
        process.exit(0);
    }

    if (args.includes('--no-verify') || args.includes('--no-watchman')) {
        watchman = false;
    }

    if (args.includes('--log-watchman')) {
        logWatchman = true;
    }

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === "--prompt" || args[i] === "-p") && i + 1 < args.length) {
            prompt = args[++i];
        } else if ((args[i] === "--mode" || args[i] === "-m") && i + 1 < args.length) {
            const m = args[++i].toLowerCase();
            if (m === 'search' || m === 'gen') {
                mode = m as DownloadOptions['mode'];
            } else {
                console.error(`Error: Invalid mode "${m}". Supported modes: search, gen.`);
                process.exit(1);
            }
        } else if (args[i] === "--model" && i + 1 < args.length) {
            const mdl = args[++i].toLowerCase();
            if (mdl === 'gemini-flash-lite' || mdl === 'gemini-flash' || mdl === 'gemini-pro' || mdl === 'gpt-image-2') {
                model = mdl as DownloadOptions['model'];
            } else {
                console.error(`Error: Invalid model "${mdl}". Supported models: gemini-flash-lite, gemini-flash, gemini-pro, gpt-image-2.`);
                process.exit(1);
            }
        } else if ((args[i] === "--res" || args[i] === "--resolution" || args[i] === "-r") && i + 1 < args.length) {
            const r = args[++i].toUpperCase();
            if (r === '0.5K' || r === '512' || r === '1K' || r === '2K' || r === '4K') {
                resolution = r as DownloadOptions['resolution'];
            } else {
                console.error(`Error: Invalid resolution "${r}". Supported resolutions: 0.5K, 512, 1K, 2K, 4K.`);
                process.exit(1);
            }
        } else if ((args[i] === "--out" || args[i] === "-o") && i + 1 < args.length) {
            out = args[++i];
        } else if ((args[i] === "--width" || args[i] === "-w") && i + 1 < args.length) {
            width = parseInt(args[++i], 10);
        } else if ((args[i] === "--height" || args[i] === "-h") && i + 1 < args.length) {
            height = parseInt(args[++i], 10);
        } else if ((args[i] === "--aspect" || args[i] === "-a") && i + 1 < args.length) {
            aspect = args[++i];
        }
    }

    if (!prompt) {
        console.error("Error: --prompt (-p) parameter is required.");
        printHelp();
        process.exit(1);
    }

    if (watchman === false && logWatchman === true) {
        console.warn("Warning: --log-watchman is ignored when watchman verification is disabled.");
    }

    const options: DownloadOptions = { prompt, mode, model, out, width, height, aspect, resolution, watchman, logWatchman };

    try {
        console.log(`Starting image download. Mode: ${mode}${mode === 'gen' ? ` (Model: ${model || getDefaultGetimgModel()}${resolution ? `, Resolution: ${resolution}` : ''})` : ''}, Prompt: "${prompt}", Target file: ${out}`);
        await downloadImage(options);
        console.log("Completed successfully!");
    } catch (e) {
        console.error("Execution failed:", e instanceof Error ? e.message : e);
        process.exit(1);
    }
}

// Check if run directly
const modulePath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMain = !!argvPath && fs.existsSync(argvPath) && fs.realpathSync(argvPath) === fs.realpathSync(modulePath);
if (isMain) {
    main();
}

/**
 * Agent Tool wrapper for getimg
 */
export async function tool_getimg(args: {
    prompt: string;
    mode: 'search' | 'gen';
    model?: 'gemini-flash-lite' | 'gemini-flash' | 'gemini-pro' | 'gpt-image-2';
    out: string;
    width?: number;
    height?: number;
    aspect?: string;
    resolution?: '0.5K' | '512' | '1K' | '2K' | '4K';
    watchman?: boolean;
    logWatchman?: boolean;
}, workspaceDir?: string): Promise<string> {
    try {
        if (!args.prompt) {
            return "ERROR: prompt argument is required.";
        }
        if (!args.mode || (args.mode !== 'search' && args.mode !== 'gen')) {
            return "ERROR: mode must be 'search' or 'gen'.";
        }
        if (!args.out) {
            return "ERROR: out file path is required.";
        }

        const resolvedOut = resolve_workspace_path(args.out, workspaceDir);
        await downloadImage({
            prompt: args.prompt,
            mode: args.mode,
            model: args.model,
            out: resolvedOut,
            width: args.width,
            height: args.height,
            aspect: args.aspect,
            resolution: args.resolution,
            watchman: args.watchman !== false, // default to true
            logWatchman: args.logWatchman === true // default to false
        });

        return `getimg succeeded: successfully retrieved and saved image to ${args.out}`;
    } catch (e: any) {
        return `ERROR: ${e.message || String(e)}`;
    }
}

/**
 * History compactor to avoid keeping full images or huge execution strings in history.
 */
export function compact_getimg(args: any, result: string): { compactedArgs: any; compactedResult: string } {
    return {
        compactedArgs: {
            prompt: args.prompt ? (args.prompt.length > 100 ? args.prompt.substring(0, 100) + '...' : args.prompt) : undefined,
            mode: args.mode,
            model: args.model,
            out: args.out,
            aspect: args.aspect
        },
        compactedResult: result
    };
}

export type AssetDescription = {
    prompt: string;
    path: string;
    width: number | null;
    height: number | null;
    format: string | null;
    bytes: number;
};

const NAMED_GETIMG_PATTERN = /\[\(getimg:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*out:\s*(?:'([^']*)'|"([^"]*)")\s*\)\]/gi;
const LEGACY_GETIMG_PATTERN = /\[\(getimg:\s*(?:'([^']*)'|"([^"]*)")\s*\)\]/gi;

function assetSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
}

export function collectImageRequests(script: string): Array<{ prompt: string; path: string }> {
    const requests: Array<{ prompt: string; path: string }> = [];
    const occupied = new Set<string>();

    for (const match of script.matchAll(NAMED_GETIMG_PATTERN)) {
        const prompt = (match[1] || match[2]).trim();
        const relativePath = safeRelativeFile(match[3] || match[4]);
        const key = relativePath.toLowerCase();
        if (occupied.has(key)) throw new Error(`Duplicate requested asset filename: ${relativePath}`);
        occupied.add(key);
        requests.push({ prompt, path: relativePath });
    }

    for (const match of script.matchAll(LEGACY_GETIMG_PATTERN)) {
        const prompt = (match[1] || match[2]).trim();
        const base = assetSlug(prompt);
        let relativePath = `assets/${base}.png`;
        let suffix = 2;
        while (occupied.has(relativePath.toLowerCase())) relativePath = `assets/${base}-${suffix++}.png`;
        occupied.add(relativePath.toLowerCase());
        requests.push({ prompt, path: relativePath });
    }
    return requests;
}

export function stripImageRequests(script: string): string {
    return script
        .replace(NAMED_GETIMG_PATTERN, '[Use a code-drawn visual; external images are disabled.]')
        .replace(LEGACY_GETIMG_PATTERN, '[Use a code-drawn visual; external images are disabled.]');
}

export async function fetchAssets(script: string, workspaceDir: string): Promise<AssetDescription[]> {
    const descriptions: AssetDescription[] = [];
    for (const request of collectImageRequests(script)) {
        const absolutePath = path.resolve(workspaceDir, request.path);
        const workspaceRoot = path.resolve(workspaceDir);
        if (absolutePath !== workspaceRoot && !absolutePath.startsWith(workspaceRoot + path.sep)) {
            throw new Error(`Asset path escapes workspace: ${request.path}`);
        }
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        await downloadImage({
            prompt: request.prompt,
            mode: 'search',
            out: absolutePath,
            watchman: false
        });
        const metadata = await sharp(absolutePath).metadata();
        descriptions.push({
            prompt: request.prompt,
            path: request.path.replaceAll('\\', '/'),
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            format: metadata.format ?? null,
            bytes: fs.statSync(absolutePath).size
        });
    }
    return descriptions;
}

export function formatAssetDescriptions(assets: AssetDescription[]): string {
    if (assets.length === 0) return 'No external image assets were requested by the script.';
    return assets.map(asset =>
        `- ${asset.path}: ${asset.width || '?'}x${asset.height || '?'} ${asset.format || 'image'}, ${asset.bytes} bytes; requested as "${asset.prompt}"`
    ).join('\n');
}
