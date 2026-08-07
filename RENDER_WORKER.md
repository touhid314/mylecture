# Render Worker

Standalone HTTP service that runs `build:plan` and `render:video` for remote
offloading from the website.

## Run locally

```bash
npm run render:server
```

The server listens on `PORT` (default `8787`).

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | HTTP listen port |
| `RENDER_WORKER_TOKEN` | _(unset)_ | Required when `NODE_ENV=production` or `RENDER_REQUIRE_AUTH=1`; when set, `/render` and `/jobs` require `Authorization: Bearer <token>`. If required but missing, those endpoints return `503`. |
| `RENDER_REQUIRE_AUTH` | _(unset)_ | Set to `1` to require `RENDER_WORKER_TOKEN` even outside production (useful for staging) |
| `KOKORO_DEVICE` | `cpu` | Default Kokoro device when the request omits `kokoroDevice` |
| `KOKORO_CHUNK_WORKERS` | `1` | Default per-clip Kokoro chunk workers when the request omits `chunkWorkers` |
| `RENDER_WORKER_MAX_BODY_BYTES` | `5242880` (5 MB) | Maximum JSON request body size |
| `RENDER_WORKER_MAX_CONCURRENCY` | `1` | Maximum number of background `/jobs` tasks running at once |
| `SUPABASE_URL` | _(unset)_ | Supabase project URL (falls back to `NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_SERVICE_ROLE_KEY` | _(unset)_ | Supabase service-role key for storage uploads/downloads |
| `SUPABASE_VIDEO_BUCKET` | `videos` | Storage bucket for render artifacts |
| `WEBSITE_CALLBACK_URL` | _(unset)_ | URL to POST job status callbacks (e.g. `https://site/api/video-agent/callback`) |
| `RENDER_CALLBACK_TOKEN` | _(unset)_ | When set, callbacks include `Authorization: Bearer <token>` |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | _(unset)_ | Forwarded to child processes for cloud TTS if needed |
| `DATABASE_URL` | _(unset)_ | Postgres connection for durable `RenderQueue` polling — use the Supabase **session** pooler (`pooler.supabase.com:5432`, not port `6543`) so `FOR UPDATE SKIP LOCKED` works |
| `RENDER_QUEUE_WORKER_ENABLED` | auto | `1` forces the queue worker on; `0` disables it even when `DATABASE_URL` is set |
| `RENDER_HTTP_JOBS` | auto | `1` runs `/jobs` in-process; `0` accepts HTTP jobs without scheduling (default `0` when queue worker is enabled) |
| `RENDER_QUEUE_WORKER_ID` | `render-worker-<pid>` | Worker id stored on claimed queue rows |
| `RENDER_QUEUE_POLL_MS` | `3000` | Queue poll interval |
| `RENDER_QUEUE_HEARTBEAT_MS` | `60000` | Heartbeat interval for claimed jobs |
| `RENDER_QUEUE_CLAIM_TIMEOUT_MS` | `1800000` | Reclaim jobs stuck in `claimed` |
| `RENDER_QUEUE_REAP_INTERVAL_MS` | `300000` | How often to scan for stuck claimed jobs |
| `RENDER_QUEUE_RETRY_BACKOFF_MS` | `30000` | Delay before retrying a failed queue row |
| `STORAGE_BACKEND` | inferred | **Set explicitly** to match Vercel: `supabase`, `r2`, or `r2-only`. When unset, defaults to `r2-only` if `R2_PRIVATE_BUCKET` (or `R2_BUCKET_NAME`) and `R2_SECRET_ACCESS_KEY` are set, otherwise `supabase`. |
| `R2_ACCOUNT_ID` | _(unset)_ | Cloudflare account id (used to build endpoint if `R2_ENDPOINT` unset) |
| `R2_ENDPOINT` | _(unset)_ | S3 API endpoint, e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID` | _(unset)_ | R2 access key |
| `R2_SECRET_ACCESS_KEY` | _(unset)_ | R2 secret key |
| `R2_PRIVATE_BUCKET` | _(unset)_ | Private bucket for video job artifacts (must match website `R2_PRIVATE_BUCKET`) |
| `TTS_PROVIDER` | `kokoro` | `kokoro`, `elevenlabs`, `google`, etc. Passed to `build-plan --provider`. Set `elevenlabs` for cloud TTS (no Kokoro models required). |
| `ELEVENLABS_API_KEY` | _(unset)_ | Required when `TTS_PROVIDER=elevenlabs` |
| `ELEVENLABS_TTS_MODEL` | _(unset)_ | Required when `TTS_PROVIDER=elevenlabs`, e.g. `eleven_flash_v2_5` |
| `ELEVENLABS_TTS_VOICE` | `bIHbv24MWmeRgasZH58o` | Default ElevenLabs voice ID when the job voice is a Kokoro name |
| `LECTUREGEN_URL` | _(unset)_ | LectureGen HTTP service base URL (required for `pipelineVersion=lecturegen` jobs) |
| `LECTUREGEN_WORKER_TOKEN` | _(unset)_ | Bearer token for LectureGen `/v1/jobs/*/transfers` (render worker downloads/uploads intermediates via signed URLs) |

When `DATABASE_URL` is set, the render server starts a background Postgres queue
worker automatically. It claims rows from the website's `RenderQueue` table with
`FOR UPDATE SKIP LOCKED`, runs the same preview/final pipeline, and marks rows
`completed` or retries/`dead` on failure. HTTP `POST /jobs` remains accepted for
compatibility but does not schedule work while the queue worker is active.

## Endpoints

### `GET /health`

Returns JSON with worker readiness (no secrets):

```json
{
  "ok": true,
  "storageBackend": "r2-only",
  "storageConfigured": true,
  "queueConfigured": true,
  "callbackConfigured": true,
  "workerAuthConfigured": true,
  "issues": []
}
```

- Status `200` when `ok` is true; `503` when required env is missing.
- Use after deploy to confirm storage/callback/queue parity with Vercel.

Copy `.env.worker.example` to your VPS env file and set `STORAGE_BACKEND` explicitly to the same value as Vercel.

### `POST /render`

**Headers**

- `Content-Type: application/json`
- `Authorization: Bearer <token>` when `RENDER_WORKER_TOKEN` is set (required in production or when `RENDER_REQUIRE_AUTH=1`)

**Request body**

```json
{
  "sourceHtml": "<full HTML string>",
  "voice": "af_heart",
  "audioWorkers": 1,
  "kokoroDevice": "cpu",
  "chunkWorkers": 1
}
```

- `sourceHtml` (required): lecture HTML to render
- `voice` (optional): TTS voice id (default `af_heart`)
- `audioWorkers` (optional): parallel TTS workers (default `1`)
- `kokoroDevice` (optional): Kokoro device override (default `cpu` or `KOKORO_DEVICE`)
- `chunkWorkers` (optional): per-clip Kokoro chunk synthesis concurrency (default `1`, forwarded as `KOKORO_CHUNK_WORKERS`)

**Success**

- Status `200`
- `Content-Type: video/mp4`
- Body: rendered MP4 bytes

**Failure**

- Non-`200` status
- `Content-Type: application/json`
- Body: `{ "error": "<message>" }`

### `POST /jobs`

Async two-phase render pipeline. Downloads inputs from Supabase Storage,
runs build/render locally, uploads artifacts, and reports status via callback.

Requires Supabase storage env vars (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).

**Headers**

- `Content-Type: application/json`
- `Authorization: Bearer <token>` when `RENDER_WORKER_TOKEN` is set (required in production or when `RENDER_REQUIRE_AUTH=1`)

**Request body**

```json
{
  "jobId": "uuid",
  "userId": "user-id-or-null",
  "phase": "preview",
  "storageBase": "<userId|anon>/<jobId>",
  "voice": "af_heart",
  "audioWorkers": 1,
  "kokoroDevice": "cpu",
  "chunkWorkers": 1,
  "fps": 15,
  "generationId": "lecturegen-uuid",
  "sourceVersion": 1
}
```

- `jobId` (required): unique job identifier
- `userId` (optional): owning user id or `null`
- `phase` (required): `"preview"` or `"final"`
- `storageBase` (required): storage path prefix for this job's artifacts
- `generationId` / `sourceVersion` (optional): when set together, the worker uses LectureGen signed transfers for source/resolved HTML and audio instead of website `raw.html` / `resolved/*` paths
- `voice` (optional): TTS voice id (default `af_heart`)
- `audioWorkers` (optional): parallel TTS workers for preview build (default `1`)
- `kokoroDevice` (optional): Kokoro device override
- `chunkWorkers` (optional): per-clip Kokoro chunk workers
- `fps` (optional): render fps (default `15` for preview, `30` for final)

**Immediate response**

- Status `202`
- Body: `{ "accepted": true }`

Processing continues in the background. When the Postgres queue worker is
disabled, jobs beyond `RENDER_WORKER_MAX_CONCURRENCY` are queued in memory and
started when a slot frees. When the queue worker is enabled (`DATABASE_URL` set),
`POST /jobs` returns `202` but the worker process picks up jobs from Postgres
instead of the in-memory queue.

#### Storage layout

Given `storageBase` (e.g. `"<userId>/<jobId>"`):

| Artifact | Path |
| --- | --- |
| Raw HTML (input) | `${storageBase}/raw.html` |
| Resolved HTML | `${storageBase}/resolved/resolved.html` |
| Resolved audio | `${storageBase}/resolved/audio/<file>` |
| Captions | `${storageBase}/resolved/captions.vtt` |
| Preview video | `${storageBase}/preview.mp4` |
| Final video | `${storageBase}/final.mp4` |

#### Preview phase

1. Download source HTML (website `raw.html` or LectureGen transfer when `generationId` + `sourceVersion` are set).
2. Run `build-plan` to produce resolved HTML, audio, and captions.
3. Render a low-resolution preview (`--max-short-edge 480`, default 15 fps).
4. Upload resolved HTML, audio files, captions (if present), and preview MP4 (resolved intermediates go to LectureGen when configured).
5. POST callback with `status: "preview_ready"`.

#### Final phase

1. Download resolved HTML and audio (website storage or LectureGen transfers; captions best-effort from website storage).
2. Render full-quality video (metadata-driven resolution, default 30 fps).
3. Upload `final.mp4`.
4. POST callback with `status: "ready"`.

#### Callbacks

When `WEBSITE_CALLBACK_URL` is set, the worker POSTs JSON after each job
completes (success or failure). Retries up to 3 times with 1s/2s backoff on
network errors or non-2xx responses.

**Preview success**

```json
{
  "jobId": "uuid",
  "phase": "preview",
  "status": "preview_ready",
  "paths": {
    "resolvedHtmlPath": "<storageBase>/resolved/resolved.html",
    "resolvedAudioPrefix": "<storageBase>/resolved/audio",
    "captionsPath": "<storageBase>/resolved/captions.vtt",
    "previewVideoPath": "<storageBase>/preview.mp4"
  },
  "durationSeconds": 42.5,
  "generationId": "lecturegen-uuid",
  "sourceVersion": 1,
  "idempotencyKey": "<jobId>:preview:1",
  "timestamp": "2026-08-06T12:00:00.000Z"
}
```

**Final success**

```json
{
  "jobId": "uuid",
  "phase": "final",
  "status": "ready",
  "paths": {
    "finalVideoPath": "<storageBase>/final.mp4"
  },
  "durationSeconds": 42.5,
  "generationId": "lecturegen-uuid",
  "sourceVersion": 1,
  "idempotencyKey": "<jobId>:final:1",
  "timestamp": "2026-08-06T12:00:00.000Z"
}
```

LectureGen pipeline callbacks include `generationId`, `sourceVersion`, `idempotencyKey`, and `timestamp` on every status (including `rendering_preview` and `failed`) so the website can ignore stale work.

**Failure (any phase)**

```json
{
  "jobId": "uuid",
  "phase": "preview",
  "status": "failed",
  "error": "Build plan failed"
}
```

`durationSeconds` is parsed from render stdout (`Timeline duration: …s`) when
available; omitted otherwise.

If `WEBSITE_CALLBACK_URL` is unset, the worker logs a warning and skips the
callback (the job still runs).

## Renderer flag: `--max-short-edge`

The `render:video` CLI accepts `--max-short-edge <pixels>` to cap the encoded
MP4 short edge after metadata auto-detection. Dimensions are scaled
proportionally and rounded to the nearest even integers (H.264 yuv420p
requirement). **Frame capture stays at the full metadata viewport**; only the
ffmpeg encode step downscales the output video. Preview jobs use
`--max-short-edge 480`.

## Docker

Requires **Node.js 22+** in the image (AWS SDK v3 will drop Node 20 support after
January 2027). The Dockerfile uses `node:22-bookworm`.

```bash
docker build -t mylecture-render-worker .
docker run -d --name render-worker --restart unless-stopped -p 8787:8787 \
  --env-file /opt/mylecture/.env \
  -e RENDER_WORKER_TOKEN=your-secret \
  -e STORAGE_BACKEND=r2-only \
  -e R2_ACCOUNT_ID=... \
  -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... \
  -e R2_PRIVATE_BUCKET=mylecture-private \
  -e DATABASE_URL=postgresql://...:5432/... \
  -e WEBSITE_CALLBACK_URL=https://your-site/api/video-agent/callback \
  -e RENDER_CALLBACK_TOKEN=... \
  -v /opt/mylecture/models:/app/models \
  mylecture-render-worker
```

Or pass a single env file (see `.env.worker.example`):

```bash
docker run -d --name render-worker --restart unless-stopped -p 8787:8787 \
  --env-file /opt/mylecture/.env \
  -v /opt/mylecture/models:/app/models \
  mylecture-render-worker
```

Mount or bake Kokoro assets under `models/` before expecting narration to succeed.

## Hardening

- The container runs as a non-root `renderworker` user.
- `build-plan` / `render-video` subprocesses do not inherit `DATABASE_URL`,
  `RENDER_*_TOKEN`, or storage secret env vars.
- Subprocess wall clock is capped by `RENDER_WORKER_SUBPROCESS_TIMEOUT_MS`
  (default 30 minutes).
- Queue failures store the sanitized stderr summary (e.g. `Set ELEVENLABS_TTS_MODEL
  in .env`) instead of a generic `Render job failed`.
