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
| `RENDER_WORKER_TOKEN` | _(unset)_ | When set, `/render` requires `Authorization: Bearer <token>` |
| `KOKORO_DEVICE` | `cpu` | Default Kokoro device when the request omits `kokoroDevice` |
| `RENDER_WORKER_MAX_BODY_BYTES` | `5242880` (5 MB) | Maximum JSON request body size |
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
  "kokoroDevice": "cpu"
}
```

- `sourceHtml` (required): lecture HTML to render
- `voice` (optional): TTS voice id (default `af_heart`)
- `audioWorkers` (optional): parallel TTS workers (default `1`)
- `kokoroDevice` (optional): Kokoro device override (default `cpu` or `KOKORO_DEVICE`)

**Success**

- Status `200`
- `Content-Type: video/mp4`
- Body: rendered MP4 bytes

**Failure**

- Non-`200` status
- `Content-Type: application/json`
- Body: `{ "error": "<message>" }`

## Docker

```bash
docker build -t mylecture-render-worker .
docker run -p 8787:8787 \
  -e RENDER_WORKER_TOKEN=your-secret \
  -v /path/to/models:/app/models \
  mylecture-render-worker
```

Mount or bake Kokoro assets under `models/` before expecting narration to succeed.
