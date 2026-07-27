# ElevenLabs TTS Integration and Experiments

Last tested: July 27, 2026

This document records the current MyLecture ElevenLabs TTS integration and the
latency experiments performed against it. The measurements are specific to the
network, ElevenLabs service load, model, voice, and machine present during the
tests. They should be treated as practical observations rather than guaranteed
service-level performance.

## Current Configuration

The ElevenLabs provider is integrated into `src/utils/tts.py`.

- Provider names: `elevenlabs` and `11labs`
- Model environment variable: `ELEVENLABS_TTS_MODEL`
- Model used in these tests: `eleven_flash_v2_5`
- API key environment variable: `ELEVENLABS_API_KEY`
- Default voice: Will (`bIHbv24MWmeRgasZH58o`)
- Output requested from ElevenLabs: 24 kHz, 16-bit PCM
- Local output: mono PCM WAV
- Test speed: `1.0`

`ELEVENLABS_TTS_MODEL` has no fallback. Importing the TTS module raises an error
if it is missing or empty:

```text
RuntimeError: Set ELEVENLABS_TTS_MODEL in .env
```

The voice can be selected explicitly through the `voice` argument or CLI
`--voice` option. For normal IDE resolve jobs, it can also be selected in the
root `config.yaml`:

```yaml
tts:
  provider: "elevenlabs"
  voice: "bIHbv24MWmeRgasZH58o"
  speed: 1.0
```

## Audio Format and Local Work

ElevenLabs normally defaults to MP3, but this integration explicitly requests
`pcm_24000`. The returned audio is already decoded 24 kHz signed 16-bit PCM.

The local code does not:

- Decode MP3
- Encode WAV audio
- Resample audio
- Invoke ffmpeg
- Perform audio transcoding

It writes a small RIFF/WAV header followed by the PCM bytes received from
ElevenLabs. This is file serialization, not audio conversion. A live integration
test produced a valid `pcm_s16le`, 24 kHz, mono WAV.

When alignment is requested, the JSON response contains base64-encoded PCM.
The code base64-decodes it before writing the same WAV representation. No audio
codec conversion is performed.

## CLI Usage and Timing

Generate audio:

```powershell
python src/utils/tts.py `
  --text "Hello from ElevenLabs." `
  --provider elevenlabs `
  --output outputs/tts/elevenlabs-test.wav
```

Generate audio and alignment:

```powershell
python src/utils/tts.py `
  --text "Hello from ElevenLabs." `
  --provider elevenlabs `
  --output outputs/tts/elevenlabs-test.wav `
  --alignment
```

The CLI reports the time spent inside the `tts(...)` synthesis call:

```text
outputs/tts/elevenlabs-test.wav
Generation time: 0.637s
```

This time includes the API request, complete response download, and negligible
local WAV serialization. It excludes Python module-import and process-startup
time. Because the current endpoint is non-streaming, it measures time until the
complete audio response is available, not time to first audio byte.

## Alignment Data

Passing `alignment=True` or the CLI flag `--alignment` uses ElevenLabs' timed
speech endpoint. The integration writes JSON containing:

- Normalized character start and end times
- Derived word start and end times
- Voice and model IDs
- Request ID and reported character cost, when supplied by ElevenLabs

The default alignment path replaces the audio suffix with
`.alignment.json`. A different path can be supplied through
`alignment_output_path` or `--alignment-output`.

Word timing ends at the final letter or number in the word. Following
punctuation has its own character timing and is not incorrectly included in the
word's end time. Apostrophes and hyphens inside words are retained.

A short live test produced:

| Word | Start | End |
|---|---:|---:|
| Alignment | 0.035s | 0.522s |
| works | 0.580s | 0.987s |

## One Chunk Versus Multiple Chunks

The same approximately ten-second passage was generated as one, two, and three
sequential requests. Alignment was disabled.

Test passage:

> Careful practice builds confidence and makes difficult problems manageable.
> Small ideas connect through steady progress, turning uncertainty into clear
> understanding and lasting skill.

Results:

| Strategy | API-path time | Combined audio | Added latency |
|---|---:|---:|---:|
| 1 chunk | 0.637s | 10.403s | Baseline |
| 2 chunks | 0.984s | 10.542s | +0.347s / 54.5% |
| 3 chunks | 1.174s | 10.031s | +0.537s / 84.3% |

For this run, splitting approximately ten seconds of speech into two sequential
requests added about `0.35s`. Splitting it into three added about `0.54s`.

The combined playback durations changed slightly because independent generation
changes pacing, prosody, and boundary pauses. This experiment measured
sequential requests. Concurrent chunk generation would have different
wall-clock behavior, although it would still create more requests and could
encounter rate or concurrency limits.

## Latency Versus Text Size

Five input sizes were generated twice. The first trial ran from shortest to
longest; the second ran from longest to shortest to reduce ordering bias. The
larger inputs repeated the same sentence so character count increased in a
controlled way.

| Characters | Mean audio duration | Mean API-path latency |
|---:|---:|---:|
| 10 | 0.952s | 0.264s |
| 51 | 3.413s | 0.378s |
| 103 | 7.198s | 0.479s |
| 207 | 15.232s | 0.739s |
| 415 | 30.372s | 1.076s |

Observed individual latency measurements:

| Characters | Trial 1 | Trial 2 |
|---:|---:|---:|
| 10 | 0.286s | 0.242s |
| 51 | 0.358s | 0.398s |
| 103 | 0.477s | 0.481s |
| 207 | 0.664s | 0.815s |
| 415 | 0.952s | 1.201s |

Across these mean values, latency was approximately an affine linear function
of character count:

```text
latency_seconds ~= 0.273 + (0.001997 * characters)
```

The coefficient of determination was approximately:

```text
R^2 ~= 0.990
```

Latency was also approximately linear with resulting audio duration:

```text
latency_seconds ~= 0.276 + (0.0272 * audio_seconds)
```

That fit also had `R^2 ~= 0.989`.

## Interpretation

Latency is not constant for long inputs, but it also does not grow from zero in
direct proportion to character count. Each request has a substantial fixed cost
of roughly `0.27s` in this environment, followed by an observed incremental cost
of roughly `2ms` per character.

Consequences observed in these tests:

- Approximately 100 characters took about `0.48s`.
- Approximately 400 characters took about `1.08s`, not four times as long.
- Approximately 30 seconds of audio was returned in about `1.1s`.
- Short chunks repeatedly pay the fixed per-request overhead.
- Larger chunks minimize total sequential completion latency.

The statement "10 characters take one second, so 20 characters take twenty
seconds" is not a linear relationship. Even doubling latency when characters
double would describe a proportional relationship through zero. The observed
behavior instead includes a fixed intercept, so doubling a short input produces
a much smaller relative increase.

## Limitations

- Only two trials were collected for each character count.
- The chunking comparison used one run per strategy.
- Network latency and ElevenLabs server load introduce noise.
- ElevenLabs generation is nondeterministic, so audio duration and pacing vary.
- The repeated-sentence inputs do not cover every language or speaking style.
- Results apply to `eleven_flash_v2_5`, the Will voice
  (`bIHbv24MWmeRgasZH58o`), and speed `1.0`.
- These are complete-response latency measurements. Streaming time-to-first-byte
  or time-to-first-audio may scale differently.

Benchmark audio files are stored under:

```text
outputs/tts_11labs/
outputs/tts_11labs/latency-scaling/
```
