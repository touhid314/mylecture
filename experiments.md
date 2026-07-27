# Rendering Experiments

## One-minute render benchmark

Date: 2026-07-27

This benchmark measures rendering and MP4 encoding on the local machine. TTS
generation was disabled by using an already resolved lecture:

[`gens/12-00-09-27-06-2026-lunhmu/resolved1.html`](gens/12-00-09-27-06-2026-lunhmu/resolved1.html)

The source timeline is 59.9 seconds long and has a portrait 9:16 aspect ratio.
Resolution labels therefore mean:

- 1080p: 1080x1920
- 720p: 720x1280
- 480p: 480x854

### Machine and common settings

- CPU: AMD Ryzen 9 8945HS, 8 cores / 16 logical processors
- GPU: NVIDIA GeForce RTX 4060 Laptop GPU
- RAM: 15.3 GB usable
- Renderer: 16 Playwright workers, stateful mode
- Temporary frames: JPEG quality 90
- Encoder: `h264_nvenc`
- Audio: seven existing audio cues were mixed into each MP4; no TTS was run

### Results and quality-comparison videos

| Resolution | FPS | Frames rendered | Frame rendering | Audio mix | MP4 encoding | Total time | Real-time factor | Output size | Video |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1080x1920 | 60 | 3,594 | 72.30s | 0.08s | 27.60s | **101.78s** | 1.70x | 13.62 MB | [View MP4](.render/benchmarks/render-quality/60fps-1080x1920.mp4) |
| 1080x1920 | 30 | 1,797 | 37.25s | 0.06s | 14.16s | **52.48s** | 0.88x | 10.10 MB | [View MP4](.render/benchmarks/render-quality/30fps-1080x1920.mp4) |
| 1080x1920 | 15 | 899 | 18.88s | 0.06s | 7.85s | **27.53s** | 0.46x | 7.20 MB | [View MP4](.render/benchmarks/render-quality/15fps-1080x1920.mp4) |
| 720x1280 | 24 | 1,438 | 16.16s | 0.06s | 9.77s | **26.80s** | 0.45x | 6.18 MB | [View MP4](.render/benchmarks/render-quality/24fps-720x1280.mp4) |
| 720x1280 | 10 | 599 | 9.40s | 0.06s | 4.34s | **14.58s** | 0.24x | 6.31 MB | [View MP4](.render/benchmarks/render-quality/10fps-720x1280.mp4) |
| 480x854 | 10 | 599 | 6.42s | 0.06s | 4.35s | **11.60s** | 0.19x | 4.75 MB | [View MP4](.render/benchmarks/render-quality/10fps-480x854.mp4) |
| 480x854 | 30 | 1,797 | 18.77s | 0.07s | 13.82s | **33.73s** | 0.56x | 5.01 MB | [View MP4](.render/benchmarks/render-quality/30fps-480x854.mp4) |

`Real-time factor` is total render time divided by the 59.9-second output
duration. Values below 1.0 mean the MP4 was produced faster than real time.

All videos were verified with `ffprobe` as 59.9-second H.264 MP4 files with the
listed dimensions and frame rates.

## Direct ffmpeg pipe experiment

The `--pipe-frames` renderer option streams ordered Playwright screenshots
directly to ffmpeg. It does not create temporary JPEG frame files. NVENC
encoding runs at the same time as the browser workers capture later frames.

All pipe experiments used the same 59.9-second lecture, 16 stateful workers,
JPEG quality 90, existing audio, and H.264 NVENC encoder.

### Pipe-frames results

| Resolution | FPS | Frames rendered | Frame capture | Piped capture + encode | Total time | Disk-staged total | Time saved | Improvement | Real-time factor | Output size | Video |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1080x1920 | 60 | 3,594 | 72.89s | 74.02s | **74.76s** | 101.78s | 27.02s | **26.5% faster** | 1.25x | 13.62 MB | [View piped MP4](.render/benchmarks/render-quality/60fps-1080x1920-piped.mp4) |
| 1080x1920 | 30 | 1,797 | 37.16s | 37.24s | **37.92s** | 52.48s | 14.56s | **27.7% faster** | 0.63x | 10.10 MB | [View piped MP4](.render/benchmarks/render-quality/30fps-1080x1920-piped.mp4) |
| 1080x1920 | 15 | 899 | 18.98s | 19.11s | **19.82s** | 27.53s | 7.71s | **28.0% faster** | 0.33x | 7.19 MB | [View piped MP4](.render/benchmarks/render-quality/15fps-1080x1920-piped.mp4) |
| 720x1280 | 24 | 1,438 | 18.41s | 18.46s | **19.16s** | 26.80s | 7.64s | **28.5% faster** | 0.32x | 6.18 MB | [View piped MP4](.render/benchmarks/render-quality/24fps-720x1280-piped.mp4) |
| 720x1280 | 10 | 599 | 8.20s | 8.27s | **8.96s** | 14.58s | 5.62s | **38.5% faster** | 0.15x | 6.31 MB | [View piped MP4](.render/benchmarks/render-quality/10fps-720x1280-piped.mp4) |
| 480x854 | 10 | 599 | 5.86s | 5.91s | **6.60s** | 11.60s | 5.00s | **43.1% faster** | 0.11x | 4.75 MB | [View piped MP4](.render/benchmarks/render-quality/10fps-480x854-piped.mp4) |
| 480x854 | 30 | 1,797 | 15.52s | 15.58s | **16.28s** | 33.73s | 17.45s | **51.7% faster** | 0.27x | 5.01 MB | [View piped MP4](.render/benchmarks/render-quality/30fps-480x854-piped.mp4) |

Across the complete matrix, disk staging took 268.50 seconds and pipe mode
took 183.50 seconds. Pipe mode saved 85.00 seconds in total, a **31.7%
aggregate reduction**.

All seven piped outputs were verified with `ffprobe` as 59.9-second H.264
videos with the requested dimensions and frame rates. The 30 FPS 1080p output
was also compared against its disk-staged counterpart with ffmpeg SSIM. It
scored `0.999951`, indicating no meaningful visual-quality loss from the
pipeline change.

Piped reproduction command:

```powershell
npm run render:video -- `
  --html "gens\12-00-09-27-06-2026-lunhmu\resolved1.html" `
  --out ".render\benchmarks\render-quality\30fps-1080x1920-piped.mp4" `
  --fps 30 `
  --width 1080 `
  --height 1920 `
  --no-auto-viewport `
  --video-codec h264_nvenc `
  --pipe-frames
```

### Initial 60 FPS observation

The successful 60 FPS run took 101.78 seconds end-to-end. A preceding
frame-capture pass took 62.57 seconds, while the successful run took 72.30
seconds for frame capture. This puts observed 60 FPS frame-capture time on this
machine at roughly 63-72 seconds per minute of lecture.

### Reproduction command

Use the resolved input so the command does not invoke build-plan or TTS. The
`--no-auto-viewport` flag is required when comparing explicit resolutions,
because lecture metadata otherwise selects its default 1080x1920 viewport.

```powershell
npm run render:video -- `
  --html "gens\12-00-09-27-06-2026-lunhmu\resolved1.html" `
  --out ".render\benchmarks\render-quality\30fps-1080x1920.mp4" `
  --fps 30 `
  --width 1080 `
  --height 1920 `
  --no-auto-viewport `
  --video-codec h264_nvenc
```
