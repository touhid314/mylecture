import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_DIR = path.resolve(__dirname, '..', '..');

export const TOKEN_TRACKER_DIR = path.join(PACKAGE_DIR, '.log', 'token-tracker');
export const TOKEN_TRACKER_DB_PATH = path.join(TOKEN_TRACKER_DIR, 'token_usage.db');

type TokenModality = "standard" | "audio" | "video" | "image";

type ModelCostTier = {
    maxContextTokens?: number;
    input: number;
    output: number;
    cachedInput?: number;
    audioInput?: number;
    videoOutput?: number;
};

type ModelCostConfig = {
    label: string;
    contextWindow?: string;
    tiers: ModelCostTier[];
    batchDiscount?: number;
    cacheStoragePerMillionTokenHour?: number;
    imageCostPerGeneration?: number;
    notes?: string;
};

export const MODEL_TOKEN_COSTS_PER_MILLION: Record<string, ModelCostConfig> = {
    "gemini-3.5-flash": {
        label: "Gemini 3.5 Flash",
        contextWindow: "1M",
        tiers: [{ input: 1.50, output: 9.00, cachedInput: 0.15 }],
        batchDiscount: 0.50,
    },
    "gemini-omni-flash": {
        label: "Gemini Omni Flash",
        contextWindow: "1M",
        tiers: [{ input: 1.50, output: 9.00, videoOutput: 17.50, cachedInput: 0.15 }],
        batchDiscount: 0.50,
        notes: "Preview. Video output uses the videoOutput rate when explicitly recorded.",
    },
    "gemini-3.1-pro": {
        label: "Gemini 3.1 Pro",
        contextWindow: "2M",
        tiers: [
            { maxContextTokens: 200_000, input: 2.00, output: 12.00, cachedInput: 0.20 },
            { input: 4.00, output: 18.00, cachedInput: 0.40 },
        ],
        batchDiscount: 0.50,
    },
    "gemini-3-pro": {
        label: "Gemini 3 Pro",
        contextWindow: "2M",
        tiers: [
            { maxContextTokens: 200_000, input: 2.00, output: 12.00, cachedInput: 0.20 },
            { input: 4.00, output: 18.00, cachedInput: 0.40 },
        ],
        batchDiscount: 0.50,
    },
    "gemini-3-flash": {
        label: "Gemini 3 Flash",
        contextWindow: "1M",
        tiers: [{ input: 0.50, audioInput: 1.00, output: 3.00, cachedInput: 0.05 }],
        batchDiscount: 0.50,
    },
    "gemini-3.1-flash-lite": {
        label: "Gemini 3.1 Flash-Lite",
        tiers: [{ input: 0.25, audioInput: 0.50, output: 1.50, cachedInput: 0.025 }],
        batchDiscount: 0.50,
    },
    "gemini-2.5-pro": {
        label: "Gemini 2.5 Pro",
        tiers: [
            { maxContextTokens: 200_000, input: 1.25, output: 10.00, cachedInput: 0.125 },
            { input: 2.50, output: 15.00, cachedInput: 0.25 },
        ],
        batchDiscount: 0.50,
    },
    "gemini-2.5-flash": {
        label: "Gemini 2.5 Flash",
        tiers: [{ input: 0.30, audioInput: 1.00, output: 2.50, cachedInput: 0.03 }],
        batchDiscount: 0.50,
    },
    "gemini-2.5-flash-lite": {
        label: "Gemini 2.5 Flash-Lite",
        tiers: [{ input: 0.10, audioInput: 0.30, output: 0.40, cachedInput: 0.01 }],
        batchDiscount: 0.50,
    },
    "gemini-2.0-flash": {
        label: "Gemini 2.0 Flash",
        tiers: [{ input: 0.10, output: 0.40, cachedInput: 0.01 }],
        batchDiscount: 0.50,
    },
    "gemini-3.1-flash-lite-image": {
        label: "Gemini 3.1 Flash Lite Image",
        tiers: [{ input: 0, output: 0 }],
        imageCostPerGeneration: 0.03,
    },
    "gemini-3.1-flash-image": {
        label: "Gemini 3.1 Flash Image",
        tiers: [{ input: 0, output: 0 }],
        imageCostPerGeneration: 0.03,
    },
    "gemini-3-pro-image": {
        label: "Gemini 3 Pro Image",
        tiers: [{ input: 0, output: 0 }],
        imageCostPerGeneration: 0.03,
    },
    "gpt-image-2": {
        label: "GPT Image 2",
        tiers: [{ input: 0, output: 0 }],
        imageCostPerGeneration: 0.04,
    },
};

export const GLOBAL_COST_FEATURES = {
    batchApiDiscount: 0.50,
    contextCachingDefaultInputMultiplier: 0.10,
    googleSearchGroundingPer1000Queries: {
        gemini3: 14.00,
        gemini2: 35.00,
    },
};

type Provider = "google" | "openai" | "unknown";

export type TokenUsageRecord = {
    sessionId?: string;
    provider: Provider;
    model: string;
    purpose: string;
    inputTokens?: number | null;
    cachedInputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    latencyMs?: number | null;
    inputModality?: TokenModality;
    outputModality?: TokenModality;
    batch?: boolean;
    googleSearchQueries?: number | null;
    cacheStorageMillionTokenHours?: number | null;
    cacheStorageCostPerMillionTokenHour?: number | null;
    rawUsage?: any;
};

type StoredTokenUsageRecord = Required<Omit<TokenUsageRecord, "rawUsage">> & {
    id: number;
    createdAt: string;
    costUsd: number | null;
    rawUsageJson: string | null;
};

const PROCESS_SESSION_ID = process.env.TOKEN_TRACKER_SESSION_ID ||
    `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let db: any | null | undefined;
const listeners = new Set<(record: StoredTokenUsageRecord) => void>();

function getDatabase(): any | null {
    if (db !== undefined) {
        return db;
    }

    try {
        fs.mkdirSync(TOKEN_TRACKER_DIR, { recursive: true });
        const sqlite = require('node:sqlite');
        db = new sqlite.DatabaseSync(TOKEN_TRACKER_DB_PATH);
        db.exec(`
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            CREATE TABLE IF NOT EXISTS token_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                session_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                purpose TEXT NOT NULL,
                input_tokens INTEGER,
                cached_input_tokens INTEGER,
                output_tokens INTEGER,
                total_tokens INTEGER,
                latency_ms INTEGER,
                input_modality TEXT NOT NULL DEFAULT 'standard',
                output_modality TEXT NOT NULL DEFAULT 'standard',
                is_batch INTEGER NOT NULL DEFAULT 0,
                google_search_queries INTEGER,
                cache_storage_million_token_hours REAL,
                cache_storage_cost_per_million_token_hour REAL,
                cost_usd REAL,
                raw_usage_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
            CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
            CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
        `);
    } catch (error: any) {
        db = null;
        console.error(`[token-tracker] SQLite unavailable; token usage will not be persisted: ${error?.message || error}`);
    }

    return db;
}

function numberOrNull(value: any): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeModelName(model: string): string {
    return model.trim().toLowerCase();
}

function findCostConfig(model: string): ModelCostConfig | null {
    const normalized = normalizeModelName(model);
    if (MODEL_TOKEN_COSTS_PER_MILLION[normalized]) {
        return MODEL_TOKEN_COSTS_PER_MILLION[normalized];
    }
    const key = Object.keys(MODEL_TOKEN_COSTS_PER_MILLION)
        .find(candidate => normalized.includes(candidate));
    return key ? MODEL_TOKEN_COSTS_PER_MILLION[key] : null;
}

function selectCostTier(config: ModelCostConfig, contextTokens: number): ModelCostTier {
    for (const tier of config.tiers) {
        if (tier.maxContextTokens === undefined || contextTokens <= tier.maxContextTokens) {
            return tier;
        }
    }
    return config.tiers[config.tiers.length - 1];
}

function inputRateForTier(tier: ModelCostTier, modality: TokenModality): number {
    if (modality === "audio" && tier.audioInput !== undefined) {
        return tier.audioInput;
    }
    return tier.input;
}

function outputRateForTier(tier: ModelCostTier, modality: TokenModality): number {
    if (modality === "video" && tier.videoOutput !== undefined) {
        return tier.videoOutput;
    }
    return tier.output;
}

function googleSearchGroundingCost(model: string, queryCount: number): number {
    const normalized = normalizeModelName(model);
    const rate = normalized.includes("gemini-2.")
        ? GLOBAL_COST_FEATURES.googleSearchGroundingPer1000Queries.gemini2
        : GLOBAL_COST_FEATURES.googleSearchGroundingPer1000Queries.gemini3;
    return (queryCount / 1000) * rate;
}

export function calculateTokenCostUsd(record: Pick<TokenUsageRecord, "model" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "inputModality" | "outputModality" | "batch" | "googleSearchQueries" | "cacheStorageMillionTokenHours" | "cacheStorageCostPerMillionTokenHour">): number | null {
    const costConfig = findCostConfig(record.model);
    if (!costConfig) {
        return null;
    }

    if (costConfig.imageCostPerGeneration !== undefined) {
        return costConfig.imageCostPerGeneration * (record.outputTokens || 1);
    }

    const inputTokens = record.inputTokens || 0;
    const cachedInputTokens = record.cachedInputTokens || 0;
    const outputTokens = record.outputTokens || 0;
    const tier = selectCostTier(costConfig, inputTokens);
    const inputRate = inputRateForTier(tier, record.inputModality || "standard");
    const outputRate = outputRateForTier(tier, record.outputModality || "standard");
    const uncachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
    const cachedRate = tier.cachedInput ?? inputRate * GLOBAL_COST_FEATURES.contextCachingDefaultInputMultiplier;
    const batchMultiplier = record.batch ? (costConfig.batchDiscount ?? GLOBAL_COST_FEATURES.batchApiDiscount) : 1;
    const googleSearchCost = record.googleSearchQueries
        ? googleSearchGroundingCost(record.model, record.googleSearchQueries)
        : 0;
    const cacheStorageRate = record.cacheStorageCostPerMillionTokenHour ?? costConfig.cacheStoragePerMillionTokenHour;
    const cacheStorageCost = record.cacheStorageMillionTokenHours && cacheStorageRate
        ? record.cacheStorageMillionTokenHours * cacheStorageRate
        : 0;

    const tokenCost = batchMultiplier * (
        (uncachedInputTokens / 1_000_000) * inputRate +
        (cachedInputTokens / 1_000_000) * cachedRate +
        (outputTokens / 1_000_000) * outputRate
    );
    return tokenCost + googleSearchCost + cacheStorageCost;
}

export function extractTokenUsage(response: any, provider: Provider): Pick<TokenUsageRecord, "inputTokens" | "cachedInputTokens" | "outputTokens" | "totalTokens" | "rawUsage"> {
    if (!response) {
        return {};
    }

    if (provider === "openai") {
        const usage = response.usage;
        if (!usage) {
            return {};
        }
        const inputTokens = numberOrNull(usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.promptTokens);
        const outputTokens = numberOrNull(usage?.output_tokens ?? usage?.completion_tokens ?? usage?.completionTokens);
        let totalTokens = numberOrNull(usage?.total_tokens ?? usage?.totalTokens);
        if (totalTokens === null && inputTokens !== null && outputTokens !== null) {
            totalTokens = inputTokens + outputTokens;
        }
        const cachedInputTokens = numberOrNull(
            usage?.input_tokens_details?.cached_tokens ??
            usage?.prompt_tokens_details?.cached_tokens ??
            usage?.inputTokenDetails?.cachedTokens ??
            usage?.promptTokenDetails?.cachedTokens
        );
        return { inputTokens, cachedInputTokens, outputTokens, totalTokens, rawUsage: usage || null };
    }

    if (provider === "google") {
        const usage = response.usageMetadata ?? response.usage_metadata;
        if (!usage) {
            return {};
        }
        const promptTokens = numberOrNull(usage?.promptTokenCount ?? usage?.prompt_token_count);
        const toolUsePromptTokens = numberOrNull(usage?.toolUsePromptTokenCount ?? usage?.tool_use_prompt_token_count) || 0;
        const candidatesTokens = numberOrNull(usage?.candidatesTokenCount ?? usage?.candidates_token_count);
        const thoughtsTokens = numberOrNull(usage?.thoughtsTokenCount ?? usage?.thoughts_token_count) || 0;
        const inputTokens = promptTokens === null && toolUsePromptTokens === 0 ? null : (promptTokens || 0) + toolUsePromptTokens;
        const outputTokens = candidatesTokens === null && thoughtsTokens === 0 ? null : (candidatesTokens || 0) + thoughtsTokens;
        let totalTokens = numberOrNull(usage?.totalTokenCount ?? usage?.total_token_count);
        if (totalTokens === null && inputTokens !== null && outputTokens !== null) {
            totalTokens = inputTokens + outputTokens;
        }
        const cachedInputTokens = numberOrNull(usage?.cachedContentTokenCount ?? usage?.cached_content_token_count);
        return { inputTokens, cachedInputTokens, outputTokens, totalTokens, rawUsage: usage || null };
    }

    return {};
}

function rowToRecord(row: any): StoredTokenUsageRecord {
    return {
        id: row.id,
        createdAt: row.created_at,
        sessionId: row.session_id,
        provider: row.provider,
        model: row.model,
        purpose: row.purpose,
        inputTokens: row.input_tokens,
        cachedInputTokens: row.cached_input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        latencyMs: row.latency_ms,
        inputModality: row.input_modality,
        outputModality: row.output_modality,
        batch: row.is_batch === 1,
        googleSearchQueries: row.google_search_queries,
        cacheStorageMillionTokenHours: row.cache_storage_million_token_hours,
        cacheStorageCostPerMillionTokenHour: row.cache_storage_cost_per_million_token_hour,
        costUsd: row.cost_usd,
        rawUsageJson: row.raw_usage_json,
    };
}

function envFlag(name: string): boolean {
    return ["1", "true", "yes", "on"].includes((process.env[name] || "").trim().toLowerCase());
}

export function trackTokenUsage(record: TokenUsageRecord): StoredTokenUsageRecord | null {
    const database = getDatabase();
    if (!database) {
        return null;
    }

    const inputTokens = numberOrNull(record.inputTokens);
    const cachedInputTokens = numberOrNull(record.cachedInputTokens);
    const outputTokens = numberOrNull(record.outputTokens);
    const totalTokens = numberOrNull(record.totalTokens) ?? (
        (inputTokens !== null && outputTokens !== null) ? inputTokens + outputTokens : null
    );

    const fullRecord = {
        sessionId: record.sessionId || PROCESS_SESSION_ID,
        provider: record.provider || "unknown",
        model: record.model,
        purpose: record.purpose,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens,
        latencyMs: numberOrNull(record.latencyMs),
        inputModality: record.inputModality || "standard",
        outputModality: record.outputModality || "standard",
        batch: record.batch === true || envFlag("TOKEN_TRACKER_BATCH"),
        googleSearchQueries: numberOrNull(record.googleSearchQueries),
        cacheStorageMillionTokenHours: numberOrNull(record.cacheStorageMillionTokenHours),
        cacheStorageCostPerMillionTokenHour: numberOrNull(record.cacheStorageCostPerMillionTokenHour),
        rawUsageJson: record.rawUsage ? JSON.stringify(record.rawUsage) : null,
    };
    const costUsd = calculateTokenCostUsd(fullRecord);

    const insert = database.prepare(`
        INSERT INTO token_usage (
            created_at, session_id, provider, model, purpose,
            input_tokens, cached_input_tokens, output_tokens, total_tokens,
            latency_ms, input_modality, output_modality, is_batch,
            google_search_queries, cache_storage_million_token_hours,
            cache_storage_cost_per_million_token_hour, cost_usd, raw_usage_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
        new Date().toISOString(),
        fullRecord.sessionId,
        fullRecord.provider,
        fullRecord.model,
        fullRecord.purpose,
        fullRecord.inputTokens,
        fullRecord.cachedInputTokens,
        fullRecord.outputTokens,
        fullRecord.totalTokens,
        fullRecord.latencyMs,
        fullRecord.inputModality,
        fullRecord.outputModality,
        fullRecord.batch ? 1 : 0,
        fullRecord.googleSearchQueries,
        fullRecord.cacheStorageMillionTokenHours,
        fullRecord.cacheStorageCostPerMillionTokenHour,
        costUsd,
        fullRecord.rawUsageJson
    );

    const stored = rowToRecord(database.prepare("SELECT * FROM token_usage WHERE id = last_insert_rowid()").get());
    for (const listener of listeners) {
        listener(stored);
    }
    return stored;
}

export function trackTokenUsageFromResponse(options: {
    response: any;
    provider: Provider;
    model: string;
    purpose: string;
    latencyMs?: number | null;
    sessionId?: string;
    inputModality?: TokenModality;
    outputModality?: TokenModality;
    batch?: boolean;
    googleSearchQueries?: number | null;
    cacheStorageMillionTokenHours?: number | null;
    cacheStorageCostPerMillionTokenHour?: number | null;
}): StoredTokenUsageRecord | null {
    const usage = extractTokenUsage(options.response, options.provider);
    if (
        usage.inputTokens == null &&
        usage.outputTokens == null &&
        usage.totalTokens == null &&
        usage.cachedInputTokens == null
    ) {
        return null;
    }
    return trackTokenUsage({
        sessionId: options.sessionId,
        provider: options.provider,
        model: options.model,
        purpose: options.purpose,
        latencyMs: options.latencyMs,
        inputModality: options.inputModality,
        outputModality: options.outputModality,
        batch: options.batch,
        googleSearchQueries: options.googleSearchQueries,
        cacheStorageMillionTokenHours: options.cacheStorageMillionTokenHours,
        cacheStorageCostPerMillionTokenHour: options.cacheStorageCostPerMillionTokenHour,
        ...usage,
    });
}

export function getTokenTrackerSummary() {
    const database = getDatabase();
    if (!database) {
        return { totals: null, byModel: [], bySession: [], sessionCalls: {}, recent: [], modelCosts: MODEL_TOKEN_COSTS_PER_MILLION, globalCostFeatures: GLOBAL_COST_FEATURES, dbPath: TOKEN_TRACKER_DB_PATH };
    }

    const totals = database.prepare(`
        SELECT
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            COALESCE(SUM(cost_usd), 0) AS costUsd,
            AVG(latency_ms) AS avgLatencyMs
        FROM token_usage
    `).get();
    const byModel = database.prepare(`
        SELECT
            model,
            MAX(created_at) AS lastSeenAt,
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            COALESCE(SUM(cost_usd), 0) AS costUsd,
            AVG(latency_ms) AS avgLatencyMs
        FROM token_usage
        GROUP BY model
        ORDER BY lastSeenAt DESC
    `).all();
    const bySession = database.prepare(`
        SELECT
            session_id AS sessionId,
            MIN(created_at) AS startedAt,
            MAX(created_at) AS lastSeenAt,
            COUNT(*) AS calls,
            COALESCE(SUM(input_tokens), 0) AS inputTokens,
            COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
            COALESCE(SUM(output_tokens), 0) AS outputTokens,
            COALESCE(SUM(total_tokens), 0) AS totalTokens,
            COALESCE(SUM(cost_usd), 0) AS costUsd,
            AVG(latency_ms) AS avgLatencyMs
        FROM token_usage
        GROUP BY session_id
        ORDER BY lastSeenAt DESC
        LIMIT 100
    `).all();
    const sessionRows = database.prepare(`
        SELECT * FROM token_usage
        WHERE session_id IN (
            SELECT session_id FROM token_usage
            GROUP BY session_id
            ORDER BY MAX(created_at) DESC
            LIMIT 100
        )
        ORDER BY session_id ASC, id DESC
    `).all().map(rowToRecord);
    const sessionCalls: Record<string, StoredTokenUsageRecord[]> = {};
    for (const row of sessionRows) {
        if (!sessionCalls[row.sessionId]) {
            sessionCalls[row.sessionId] = [];
        }
        sessionCalls[row.sessionId].push(row);
    }
    const recent = database.prepare(`
        SELECT * FROM token_usage
        ORDER BY id DESC
        LIMIT 50
    `).all().map(rowToRecord);

    return { totals, byModel, bySession, sessionCalls, recent, modelCosts: MODEL_TOKEN_COSTS_PER_MILLION, globalCostFeatures: GLOBAL_COST_FEATURES, dbPath: TOKEN_TRACKER_DB_PATH };
}

function getTokenUsageAfterId(id: number): StoredTokenUsageRecord[] {
    const database = getDatabase();
    if (!database) {
        return [];
    }
    return database.prepare(`
        SELECT * FROM token_usage
        WHERE id > ?
        ORDER BY id ASC
        LIMIT 200
    `).all(id).map(rowToRecord);
}

function dashboardHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token Tracker</title>
<style>
body{margin:0;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f7f8fb;color:#171923}
header{padding:18px 24px;background:#111827;color:white;display:flex;align-items:center;justify-content:space-between}
main{padding:20px 24px;display:grid;gap:18px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.card{background:white;border:1px solid #d9dee8;border-radius:8px;padding:14px}
.label{color:#667085;font-size:12px;text-transform:uppercase}
.value{font-size:26px;font-weight:700;margin-top:6px}
table{width:100%;border-collapse:collapse;background:white;border:1px solid #d9dee8;border-radius:8px;overflow:hidden}
th,td{padding:10px 12px;border-bottom:1px solid #e8ebf1;text-align:left;font-size:14px}
th{background:#eef2f7;color:#344054}
tr:last-child td{border-bottom:none}
.session-row{cursor:pointer}
.session-row:hover td{background:#f8fafc}
.call-row td{background:#fbfcff}
.brand{display:flex;gap:12px;align-items:center}
.mark{width:36px;height:36px;border-radius:8px;background:#ffffff;color:#111827;display:grid;place-items:center;font-weight:900}
.actions{display:flex;gap:12px;align-items:center}
button{border:1px solid #cfd6e3;background:white;color:#111827;border-radius:7px;padding:8px 11px;font-weight:600;cursor:pointer}
button:hover{background:#f3f6fb}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.48);display:none;align-items:center;justify-content:center;padding:24px}
.modal.open{display:flex}
.modal-panel{width:min(860px,100%);max-height:88vh;background:white;border-radius:8px;border:1px solid #d9dee8;box-shadow:0 24px 80px rgba(15,23,42,.28);overflow:hidden;display:flex;flex-direction:column}
.modal-head{padding:16px 18px;border-bottom:1px solid #e8ebf1;display:flex;justify-content:space-between;align-items:center}
.modal-body{padding:18px;overflow:auto}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.muted{color:#667085}
@media (max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.grid{grid-template-columns:1fr}header{display:block}}
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="mark">M</div>
    <div>
    <div style="font-size:22px;font-weight:700">mylecture.ai Token Tracker</div>
    <div class="muted" id="dbPath"></div>
    </div>
  </div>
  <div class="actions"><button id="costButton">Model Costs</button><div class="mono" id="status">connecting</div></div>
</header>
<main>
  <section class="grid">
    <div class="card"><div class="label">Calls</div><div class="value" id="calls">0</div></div>
    <div class="card"><div class="label">Total Tokens</div><div class="value" id="totalTokens">0</div></div>
    <div class="card"><div class="label">Cached Input</div><div class="value" id="cachedTokens">0</div></div>
    <div class="card"><div class="label">Estimated Cost</div><div class="value" id="cost">$0.0000</div></div>
  </section>
  <section>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2 style="margin:0">Cost By Session</h2>
      <div style="display:flex;gap:12px;align-items:center">
        <button id="prevSessionPage">Previous</button>
        <span id="sessionPageDisplay" style="font-weight:500;font-size:14px;color:#4a5568">Page 1 of 1</span>
        <button id="nextSessionPage">Next</button>
      </div>
    </div>
    <table><thead><tr><th>Session</th><th>Started</th><th>Calls</th><th>Uncached</th><th>Cached</th><th>Output</th><th>Total</th><th>Avg Latency</th><th>Cost</th></tr></thead><tbody id="sessions"></tbody></table>
  </section>
  <section>
    <h2>Cost By Model</h2>
    <table><thead><tr><th>Model</th><th>Calls</th><th>Uncached</th><th>Cached</th><th>Output</th><th>Total</th><th>Avg Latency</th><th>Cost</th></tr></thead><tbody id="models"></tbody></table>
  </section>
  <section>
    <h2>Recent Calls</h2>
    <table><thead><tr><th>Time</th><th>Purpose</th><th>Model</th><th>Uncached</th><th>Cached</th><th>Output</th><th>Total</th><th>Latency</th><th>Cost</th></tr></thead><tbody id="recent"></tbody></table>
  </section>
</main>
<div class="modal" id="costModal">
  <div class="modal-panel">
    <div class="modal-head"><h2 style="margin:0">Model Costs Per 1M Tokens</h2><button id="closeCosts">Close</button></div>
    <div class="modal-body">
      <table><thead><tr><th>Model</th><th>Context Tier</th><th>Input</th><th>Cached Input</th><th>Output</th></tr></thead><tbody id="costRows"></tbody></table>
      <div class="card" style="margin-top:14px">
        <div class="label">Global Cost Features</div>
        <div id="featureRows" style="margin-top:8px;line-height:1.7"></div>
      </div>
    </div>
  </div>
</div>
<script>
const fmt = new Intl.NumberFormat();
const money = value => "$" + Number(value || 0).toFixed(6);
const seconds = value => value == null ? "" : (Number(value) / 1000).toFixed(2) + "s";
let openSessions = new Set();
let latestData = null;
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let currentSessionPage = 1;
const sessionsPerPage = 10;

function renderSessions(data){
  const sessions = data.bySession || [];
  const calls = data.sessionCalls || {};
  const totalPages = Math.max(Math.ceil(sessions.length / sessionsPerPage), 1);
  if (currentSessionPage > totalPages) {
    currentSessionPage = totalPages;
  }
  document.getElementById('sessionPageDisplay').textContent = 'Page ' + currentSessionPage + ' of ' + totalPages;
  document.getElementById('prevSessionPage').disabled = currentSessionPage === 1;
  document.getElementById('nextSessionPage').disabled = currentSessionPage === totalPages;

  const startIdx = (currentSessionPage - 1) * sessionsPerPage;
  const paginatedSessions = sessions.slice(startIdx, startIdx + sessionsPerPage);

  document.getElementById('sessions').innerHTML = paginatedSessions.map(row => {
    const isOpen = openSessions.has(row.sessionId);
    const sessionCalls = calls[row.sessionId] || [];
    const parent = '<tr class="session-row" data-session="' + esc(row.sessionId) + '"><td class="mono">' + (isOpen ? 'v ' : '> ') + esc(row.sessionId) + '</td><td>' +
      new Date(row.startedAt).toLocaleString() + '</td><td>' + fmt.format(row.calls || 0) + '</td><td>' +
      fmt.format(Math.max((row.inputTokens || 0) - (row.cachedInputTokens || 0), 0)) + '</td><td>' + fmt.format(row.cachedInputTokens || 0) + '</td><td>' +
      fmt.format(row.outputTokens || 0) + '</td><td>' + fmt.format(row.totalTokens || 0) + '</td><td>' +
      seconds(row.avgLatencyMs) + '</td><td>' + money(row.costUsd) + '</td></tr>';
    const children = isOpen ? sessionCalls.map(call =>
      '<tr class="call-row"><td class="mono">' + esc(call.purpose) + '<br><span class="muted">' + esc(call.model) + '</span></td><td class="mono">' +
      new Date(call.createdAt).toLocaleTimeString() + '</td><td>1</td><td>' +
      fmt.format(Math.max((call.inputTokens || 0) - (call.cachedInputTokens || 0), 0)) + '</td><td>' + fmt.format(call.cachedInputTokens || 0) + '</td><td>' +
      fmt.format(call.outputTokens || 0) + '</td><td>' + fmt.format(call.totalTokens || ((call.inputTokens || 0) + (call.outputTokens || 0))) + '</td><td>' +
      seconds(call.latencyMs) + '</td><td>' + money(call.costUsd) + '</td></tr>'
    ).join('') : '';
    return parent + children;
  }).join('');
}
function renderCosts(data){
  document.getElementById('costRows').innerHTML = Object.entries(data.modelCosts || {}).flatMap(([model, config]) =>
    (config.tiers || []).map((tier, index) => {
      const context = tier.maxContextTokens ? '<=' + fmt.format(tier.maxContextTokens) + ' tokens' : 'default';
      const input = money(tier.input) + (tier.audioInput !== undefined ? ' / audio ' + money(tier.audioInput) : '');
      const output = money(tier.output) + (tier.videoOutput !== undefined ? ' / video ' + money(tier.videoOutput) : '');
      return '<tr><td class="mono">' + esc(model) + (index === 0 ? '<br><span class="muted">' + esc(config.label || '') + '</span>' : '') +
        '</td><td>' + esc(context) + '</td><td>' + input + '</td><td>' + money(tier.cachedInput ?? tier.input * 0.10) + '</td><td>' + output + '</td></tr>';
    })
  ).join('');
  const features = data.globalCostFeatures || {};
  const grounding = features.googleSearchGroundingPer1000Queries || {};
  document.getElementById('featureRows').innerHTML =
    'Batch API multiplier: <span class="mono">' + esc(features.batchApiDiscount ?? '') + '</span><br>' +
    'Default cached input multiplier: <span class="mono">' + esc(features.contextCachingDefaultInputMultiplier ?? '') + '</span><br>' +
    'Google Search grounding: <span class="mono">$' + esc(grounding.gemini3 ?? '') + ' / 1K queries for Gemini 3.x, $' + esc(grounding.gemini2 ?? '') + ' / 1K queries for Gemini 2.x</span>';
}
async function refresh(){
  const res = await fetch('/api/summary');
  const data = await res.json();
  latestData = data;
  document.getElementById('dbPath').textContent = data.dbPath || '';
  const t = data.totals || {};
  document.getElementById('calls').textContent = fmt.format(t.calls || 0);
  document.getElementById('totalTokens').textContent = fmt.format(t.totalTokens || 0);
  document.getElementById('cachedTokens').textContent = fmt.format(t.cachedInputTokens || 0);
  document.getElementById('cost').textContent = money(t.costUsd || 0);
  renderSessions(data);
  renderCosts(data);
  document.getElementById('models').innerHTML = (data.byModel || []).map(row =>
    '<tr><td class="mono">' + row.model + '</td><td>' + fmt.format(row.calls || 0) + '</td><td>' +
    fmt.format(Math.max((row.inputTokens || 0) - (row.cachedInputTokens || 0), 0)) + '</td><td>' + fmt.format(row.cachedInputTokens || 0) + '</td><td>' +
    fmt.format(row.outputTokens || 0) + '</td><td>' + fmt.format(row.totalTokens || 0) + '</td><td>' +
    seconds(row.avgLatencyMs) + '</td><td>' + money(row.costUsd) + '</td></tr>'
  ).join('');
  document.getElementById('recent').innerHTML = (data.recent || []).slice(0, 15).map(row =>
    '<tr><td class="mono">' + new Date(row.createdAt).toLocaleTimeString() + '</td><td>' + row.purpose + '</td><td class="mono">' + row.model + '</td><td>' +
    fmt.format(Math.max((row.inputTokens || 0) - (row.cachedInputTokens || 0), 0)) + '</td><td>' + fmt.format(row.cachedInputTokens || 0) + '</td><td>' +
    fmt.format(row.outputTokens || 0) + '</td><td>' + fmt.format(row.totalTokens || ((row.inputTokens || 0) + (row.outputTokens || 0))) + '</td><td>' +
    seconds(row.latencyMs) + '</td><td>' + money(row.costUsd) + '</td></tr>'
  ).join('');
}
document.addEventListener('click', event => {
  const row = event.target.closest('.session-row');
  if (row) {
    const id = row.getAttribute('data-session');
    if (openSessions.has(id)) openSessions.delete(id); else openSessions.add(id);
    if (latestData) renderSessions(latestData);
  }
});
document.getElementById('costButton').onclick = () => document.getElementById('costModal').classList.add('open');
document.getElementById('closeCosts').onclick = () => document.getElementById('costModal').classList.remove('open');
document.getElementById('costModal').addEventListener('click', event => {
  if (event.target.id === 'costModal') event.currentTarget.classList.remove('open');
});
document.getElementById('prevSessionPage').onclick = () => {
  if (currentSessionPage > 1) {
    currentSessionPage--;
    if (latestData) renderSessions(latestData);
  }
};
document.getElementById('nextSessionPage').onclick = () => {
  if (latestData) {
    const sessions = latestData.bySession || [];
    const totalPages = Math.ceil(sessions.length / sessionsPerPage);
    if (currentSessionPage < totalPages) {
      currentSessionPage++;
      renderSessions(latestData);
    }
  }
};
refresh();
setInterval(refresh, 1000);
const events = new EventSource('/api/events');
events.onopen = () => document.getElementById('status').textContent = 'live';
events.onerror = () => document.getElementById('status').textContent = 'reconnecting';
events.onmessage = () => refresh();
</script>
</body>
</html>`;
}

export function startTokenTrackerDashboard(options: { port?: number; host?: string } = {}) {
    const port = options.port ?? Number(process.env.TOKEN_TRACKER_PORT || 4317);
    const host = options.host ?? process.env.TOKEN_TRACKER_HOST ?? '127.0.0.1';

    const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${host}:${port}`);
        if (url.pathname === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(dashboardHtml());
            return;
        }
        if (url.pathname === '/api/summary') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(getTokenTrackerSummary()));
            return;
        }
        if (url.pathname === '/api/events') {
            res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
            });
            res.write('retry: 1000\n\n');
            let lastId = Number(url.searchParams.get('lastId') || 0);
            const send = (record: StoredTokenUsageRecord) => {
                if (record.id <= lastId) {
                    return;
                }
                lastId = record.id;
                res.write(`data: ${JSON.stringify(record)}\n\n`);
            };
            const poll = setInterval(() => {
                for (const record of getTokenUsageAfterId(lastId)) {
                    send(record);
                }
            }, 1000);
            listeners.add(send);
            req.on('close', () => {
                clearInterval(poll);
                listeners.delete(send);
            });
            return;
        }
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
    });

    server.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : port;
        console.log(`Token tracker dashboard: http://${host}:${actualPort}/`);
        console.log(`Token tracker database: ${TOKEN_TRACKER_DB_PATH}`);
    });
    return server;
}
