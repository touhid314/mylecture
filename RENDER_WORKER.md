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
| `RENDER_WORKER_TOKEN` | _(unset)_ | When set, `/render` and `/jobs` require `Authorization: Bearer <token>` |
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

## Endpoints

### `GET /health`

Returns `200` with JSON `{ "ok": true }`. Does not require models or ffmpeg.

### `POST /render`

**Headers**

- `Content-Type: application/json`
- `Authorization: Bearer <token>` when `RENDER_WORKER_TOKEN` is set

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
- `Authorization: Bearer <token>` when `RENDER_WORKER_TOKEN` is set

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
  "fps": 15
}
```

- `jobId` (required): unique job identifier
- `userId` (optional): owning user id or `null`
- `phase` (required): `"preview"` or `"final"`
- `storageBase` (required): storage path prefix for this job's artifacts
- `voice` (optional): TTS voice id (default `af_heart`)
- `audioWorkers` (optional): parallel TTS workers for preview build (default `1`)
- `kokoroDevice` (optional): Kokoro device override
- `chunkWorkers` (optional): per-clip Kokoro chunk workers
- `fps` (optional): render fps (default `15` for preview, `30` for final)

**Immediate response**

- Status `202`
- Body: `{ "accepted": true }`

Processing continues in the background. Jobs beyond `RENDER_WORKER_MAX_CONCURRENCY`
are queued in memory and started when a slot frees.

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

1. Download `raw.html` from storage.
2. Run `build-plan` to produce resolved HTML, audio, and captions.
3. Render a low-resolution preview (`--max-short-edge 480`, default 15 fps).
4. Upload resolved HTML, audio files, captions (if present), and preview MP4.
5. POST callback with `status: "preview_ready"`.

#### Final phase

1. Download resolved HTML and audio from storage (captions best-effort).
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
  "durationSeconds": 42.5
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
  "durationSeconds": 42.5
}
```

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

The `render:video` CLI accepts `--max-short-edge <pixels>` to cap the viewport
short edge after metadata auto-detection. Dimensions are scaled proportionally
and rounded to the nearest even integers (H.264 yuv420p requirement). Preview
jobs use `--max-short-edge 480`.

## Docker

```bash
docker build -t mylecture-render-worker .
docker run -p 8787:8787 \
  -e RENDER_WORKER_TOKEN=your-secret \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
  -e WEBSITE_CALLBACK_URL=https://your-site/api/video-agent/callback \
  -v /path/to/models:/app/models \
  mylecture-render-worker
```

Mount or bake Kokoro assets under `models/` before expecting narration to succeed.
