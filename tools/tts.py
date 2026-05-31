"""
Unified TTS helpers.

Single public API:
    tts(text, provider, voice, output_path, speed)

Providers available via this module:
1) openai
   - Provider key: "openai"
   - Default model: gpt-4o-mini-tts-2025-12-15
   - Available voices:
     alloy, ash, ballad, coral, cedar, echo, fable, marin, nova,
     onyx, sage, shimmer, verse

2) google (Gemini TTS)
   - Provider keys: "google", "gemini" (alias)
   - Allowed models in this module:
     gemini-3-flash-preview-tts
     gemini-3-flash-lite-preview-tts
     gemini-3-pro-tts
     gemini-2.5-flash-preview-tts
   - Voice parameter maps to Google prebuilt voice_name.
   - Common Gemini voice names used in practice include:
     Achernar, Achird, Algenib, Algieba, Alnilam, Aoede, Autonoe,
     Callirrhoe, Charon, Despina, Enceladus, Erinome, Fenrir, Gacrux,
     Iapetus, Kore, Laomedeia, Leda, Orus, Puck, Pulcherrima, Rasalgethi,
     Sadachbia, Sadaltager, Schedar, Sulafat, Umbriel, Vindemiatrix,
     Zephyr, Zubenelgenubi.
   - Important: Google may add/remove voices over time; this wrapper forwards
     voice names directly and does not hard-validate them.

3) kokoro (local via ONNX Runtime CUDA, with kokoro-js fallback)
   - Provider key: "kokoro"
   - Default model: onnx-community/Kokoro-82M-ONNX
   - Default engine: Python ONNX Runtime with CUDAExecutionProvider.
   - Set KOKORO_ENGINE=kokoro-js to force the old Node.js path.
   - Available voices (from installed kokoro-js package):
     af_heart, af_alloy, af_aoede, af_bella, af_jessica, af_kore,
     af_nicole, af_nova, af_river, af_sarah, af_sky,
     am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael,
     am_onyx, am_puck, am_santa,
     bf_emma, bf_isabella, bf_alice, bf_lily,
     bm_george, bm_lewis, bm_daniel, bm_fable

Note:
- ElevenLabs TTS exists in this repo as a separate utility
  (src/utils/tts_11labs.py) and is not part of this unified tts(...) API.
"""

from __future__ import annotations

import os
import json
import re
import subprocess
import sys
import tempfile
import time
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
for _p in (PROJECT_ROOT, SRC_ROOT):
    _sp = str(_p)
    if _sp not in sys.path:
        sys.path.insert(0, _sp)

try:
    from logger import Logger
except Exception:  # pragma: no cover - standalone fallback
    class Logger:
        def info(self, message: str) -> None:
            print(message)

        def warning(self, message: str) -> None:
            print(message)

        def error(self, message: str) -> None:
            print(message)

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional dependency
    OpenAI = None

try:
    from google import genai
    from google.genai import types
except Exception:  # pragma: no cover - optional dependency
    genai = None
    types = None

load_dotenv()
log = Logger()

DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs/tts"
DEFAULT_KOKORO_OUTPUT_DIR = PROJECT_ROOT / "outputs/tts_kokoro"

DEFAULT_OPENAI_MODEL = os.getenv("OPENAI_TTS_MODEL") or "gpt-4o-mini-tts-2025-12-15"
DEFAULT_OPENAI_VOICE = os.getenv("OPENAI_TTS_VOICE") or "cedar"

DEFAULT_GEMINI_MODEL = os.getenv("GOOGLE_TTS_MODEL") or "gemini-2.5-flash-preview-tts"
DEFAULT_GEMINI_VOICE = os.getenv("GOOGLE_TTS_VOICE") or "Vindemiatrix"
_ALLOWED_GEMINI_MODELS = {
    "gemini-3-flash-preview-tts",
    "gemini-3-flash-lite-preview-tts",
    "gemini-3-pro-tts",
    "gemini-2.5-flash-preview-tts",
}

DEFAULT_KOKORO_MODEL = os.getenv("KOKORO_MODEL") or "onnx-community/Kokoro-82M-ONNX"
DEFAULT_KOKORO_VOICE = os.getenv("KOKORO_VOICE") or "am_puck"
DEFAULT_KOKORO_ENGINE = (os.getenv("KOKORO_ENGINE") or "onnxruntime").strip().lower()
DEFAULT_KOKORO_ONNX_MODEL = os.getenv("KOKORO_ONNX_MODEL") or "model.onnx"
DEFAULT_KOKORO_ONNX_MODEL_DIR = Path(
    os.getenv("KOKORO_ONNX_MODEL_DIR") or PROJECT_ROOT / "models" / "kokoro-onnx"
)


def _default_kokoro_device() -> str:
    explicit = os.getenv("KOKORO_DEVICE")
    if explicit is not None:
        return explicit.strip()
    if sys.platform in {"win32"} or sys.platform.startswith("linux"):
        return "cuda"
    return "cpu"


DEFAULT_KOKORO_DEVICE = _default_kokoro_device()


def _default_kokoro_dtype() -> str:
    explicit = os.getenv("KOKORO_DTYPE")
    if explicit:
        return explicit
    return "fp32" if DEFAULT_KOKORO_DEVICE in {"dml", "cuda", "webgpu"} else "q8"


DEFAULT_KOKORO_DTYPE = _default_kokoro_dtype()

KOKORO_JS = r"""
import { KokoroTTS } from "kokoro-js";

const model = process.env.KOKORO_MODEL ?? "onnx-community/Kokoro-82M-ONNX";
const dtype = process.env.KOKORO_DTYPE ?? "q8";
const cpuFallbackDtype = process.env.KOKORO_CPU_FALLBACK_DTYPE ?? "q8";
const voice = process.env.KOKORO_VOICE ?? "am_puck";
const speedRaw = process.env.KOKORO_SPEED ?? "1";
const speed = Number(speedRaw);
const deviceRaw = (process.env.KOKORO_DEVICE ?? "").trim();
const device = deviceRaw || null;
const text = process.env.KOKORO_TEXT ?? "";
const outputPath = process.env.KOKORO_OUTPUT ?? "audio.wav";

if (!text.trim()) {
  throw new Error("Input text is empty.");
}
if (!Number.isFinite(speed) || speed <= 0) {
  throw new Error(`Invalid KOKORO_SPEED: ${speedRaw}`);
}

const initOpts = { dtype };
if (device) initOpts.device = device;

let tts;
try {
  console.error(`Kokoro loading model=${model} dtype=${dtype} device=${device ?? "default"}`);
  tts = await KokoroTTS.from_pretrained(model, initOpts);
  console.error(`Kokoro ready device=${device ?? "default"}`);
} catch (err) {
  if (device && device !== "cpu") {
    console.warn(`Kokoro device '${device}' failed; falling back to cpu. ${err?.message ?? err}`);
    tts = await KokoroTTS.from_pretrained(model, { dtype: cpuFallbackDtype, device: "cpu" });
    console.error(`Kokoro ready device=cpu dtype=${cpuFallbackDtype}`);
  } else {
    throw err;
  }
}

const synthesize = async (engine) => {
  const audio = await engine.generate(text, { voice, speed });
  await audio.save(outputPath);
};

try {
  await synthesize(tts);
} catch (err) {
  if (device && device !== "cpu") {
    console.warn(`Kokoro synthesis failed on '${device}'; retrying on cpu.`);
    const cpuTts = await KokoroTTS.from_pretrained(model, { dtype: cpuFallbackDtype, device: "cpu" });
    await synthesize(cpuTts);
  } else {
    throw err;
  }
}

console.log(outputPath);
"""


def _resolve_output_path(output_path: str | None, provider: str) -> Path:
    base = DEFAULT_KOKORO_OUTPUT_DIR if provider == "kokoro" else DEFAULT_OUTPUT_DIR
    if not output_path:
        base.mkdir(parents=True, exist_ok=True)
        return base / f"tts_{provider}_{int(time.time() * 1000)}.wav"

    path = Path(output_path)
    if path.suffix.lower() != ".wav":
        path.mkdir(parents=True, exist_ok=True)
        return path / f"tts_{provider}_{int(time.time() * 1000)}.wav"

    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _save_wave(filename: str, pcm: bytes, channels: int = 1, rate: int = 24000, sample_width: int = 2) -> None:
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm)


def _concat_wavs(input_paths: list[Path], output_path: Path) -> None:
    if not input_paths:
        raise ValueError("No WAV chunks provided for concatenation.")

    def _read_wav_chunks(path: Path) -> tuple[int, int, int, int, bytes]:
        raw = path.read_bytes()
        if len(raw) < 44 or raw[0:4] != b"RIFF" or raw[8:12] != b"WAVE":
            raise RuntimeError(f"Invalid WAV file: {path}")

        offset = 12
        audio_format = None
        channels = None
        sample_rate = None
        bits_per_sample = None
        data = None

        while offset + 8 <= len(raw):
            chunk_id = raw[offset : offset + 4]
            chunk_size = int.from_bytes(raw[offset + 4 : offset + 8], "little")
            chunk_start = offset + 8
            chunk_end = chunk_start + chunk_size
            if chunk_end > len(raw):
                break

            if chunk_id == b"fmt ":
                if chunk_size < 16:
                    raise RuntimeError(f"Corrupt fmt chunk in WAV: {path}")
                audio_format = int.from_bytes(raw[chunk_start : chunk_start + 2], "little")
                channels = int.from_bytes(raw[chunk_start + 2 : chunk_start + 4], "little")
                sample_rate = int.from_bytes(raw[chunk_start + 4 : chunk_start + 8], "little")
                bits_per_sample = int.from_bytes(raw[chunk_start + 14 : chunk_start + 16], "little")
            elif chunk_id == b"data":
                data = raw[chunk_start:chunk_end]

            # WAV chunks are word-aligned.
            offset = chunk_end + (chunk_size % 2)

        if (
            audio_format is None
            or channels is None
            or sample_rate is None
            or bits_per_sample is None
            or data is None
        ):
            raise RuntimeError(f"Missing fmt/data chunk in WAV: {path}")

        if audio_format not in (1, 3):
            raise RuntimeError(f"Unsupported WAV format tag {audio_format} in {path}")

        return audio_format, channels, sample_rate, bits_per_sample, data

    def _write_wav(path: Path, audio_format: int, channels: int, sample_rate: int, bits_per_sample: int, data: bytes) -> None:
        byte_rate = sample_rate * channels * bits_per_sample // 8
        block_align = channels * bits_per_sample // 8
        fmt_chunk_size = 16
        data_chunk_size = len(data)
        riff_size = 4 + (8 + fmt_chunk_size) + (8 + data_chunk_size)

        with path.open("wb") as f:
            f.write(b"RIFF")
            f.write(riff_size.to_bytes(4, "little"))
            f.write(b"WAVE")

            f.write(b"fmt ")
            f.write(fmt_chunk_size.to_bytes(4, "little"))
            f.write(audio_format.to_bytes(2, "little"))
            f.write(channels.to_bytes(2, "little"))
            f.write(sample_rate.to_bytes(4, "little"))
            f.write(byte_rate.to_bytes(4, "little"))
            f.write(block_align.to_bytes(2, "little"))
            f.write(bits_per_sample.to_bytes(2, "little"))

            f.write(b"data")
            f.write(data_chunk_size.to_bytes(4, "little"))
            f.write(data)

    expected: tuple[int, int, int, int] | None = None
    all_data = bytearray()
    for wav_path in input_paths:
        fmt, ch, sr, bps, data = _read_wav_chunks(wav_path)
        current = (fmt, ch, sr, bps)
        if expected is None:
            expected = current
        elif current != expected:
            raise RuntimeError(
                f"WAV format mismatch while concatenating chunks: expected {expected}, got {current} at {wav_path}"
            )
        all_data.extend(data)

    assert expected is not None
    _write_wav(
        output_path,
        audio_format=expected[0],
        channels=expected[1],
        sample_rate=expected[2],
        bits_per_sample=expected[3],
        data=bytes(all_data),
    )


def _split_text_into_sentence_chunks(
    text: str, target_words: int = 27, min_words: int = 25, max_words: int = 30
) -> list[str]:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    if not clean:
        return []

    # Sentence-preserving split: break only at sentence boundaries.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", clean) if s.strip()]
    if not sentences:
        return [clean]

    chunks: list[str] = []
    current_sentences: list[str] = []
    current_words = 0

    for sentence in sentences:
        sentence_words = len(sentence.split())
        if not current_sentences:
            current_sentences = [sentence]
            current_words = sentence_words
            continue

        # If current chunk is already near target, close it before adding more.
        if current_words >= min_words:
            projected = current_words + sentence_words
            if projected > max_words:
                chunks.append(" ".join(current_sentences))
                current_sentences = [sentence]
                current_words = sentence_words
                continue

        current_sentences.append(sentence)
        current_words += sentence_words

        # If we're close to target, flush to keep chunk sizes around 25-30 words.
        if abs(current_words - target_words) <= 2 or current_words >= max_words:
            chunks.append(" ".join(current_sentences))
            current_sentences = []
            current_words = 0

    if current_sentences:
        chunks.append(" ".join(current_sentences))

    return chunks


def _openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY environment variable")
    if OpenAI is None:
        raise RuntimeError("OpenAI SDK is not available")
    return OpenAI(api_key=api_key)


def _google_client() -> genai.Client:
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Set GOOGLE_API_KEY environment variable")
    if genai is None:
        raise RuntimeError("Google GenAI SDK is not available")
    return genai.Client(api_key=api_key)


def _run_kokoro_onnxruntime(text: str, output_path: Path, voice: str, speed: float) -> None:
    try:
        import numpy as np
        import scipy.io.wavfile as wavfile
        import onnxruntime as ort
        from huggingface_hub import snapshot_download
        from misaki import en
    except Exception as exc:
        raise RuntimeError(
            "Python Kokoro CUDA backend requires numpy, scipy, onnxruntime-gpu, "
            "huggingface_hub, and misaki[en]."
        ) from exc

    model_dir = DEFAULT_KOKORO_ONNX_MODEL_DIR
    if not (model_dir / "tokenizer.json").is_file() or not (model_dir / "onnx" / DEFAULT_KOKORO_ONNX_MODEL).is_file():
        snapshot_download(
            "onnx-community/Kokoro-82M-v1.0-ONNX",
            local_dir=str(model_dir),
            allow_patterns=["onnx/model.onnx", "voices/*", "tokenizer.json"],
        )

    tokenizer_path = model_dir / "tokenizer.json"
    voice_path = model_dir / "voices" / f"{voice}.bin"
    model_path = model_dir / "onnx" / DEFAULT_KOKORO_ONNX_MODEL
    if not voice_path.is_file():
        raise RuntimeError(f"Kokoro voice file not found: {voice_path}")
    if not model_path.is_file():
        raise RuntimeError(f"Kokoro ONNX model not found: {model_path}")

    with tokenizer_path.open("r", encoding="utf-8") as f:
        tokenizer = json.load(f)
    vocab = tokenizer["model"]["vocab"]

    g2p = en.G2P(trf=False, british=voice.startswith("b"), fallback=None)
    phonemes, _ = g2p(text)
    missing_phonemes = sorted({p for p in phonemes if p not in vocab})
    if missing_phonemes:
        log.warning(f"Kokoro skipped tokenizer-missing phoneme(s): {''.join(missing_phonemes)}")
    tokens = [vocab[p] for p in phonemes if p in vocab]
    if not tokens:
        raise RuntimeError("Kokoro phonemizer produced no tokenizer-compatible phonemes.")
    if len(tokens) > 510:
        raise RuntimeError(f"Kokoro input is too long for one ONNX call: {len(tokens)} tokens")

    voices = np.fromfile(voice_path, dtype=np.float32).reshape(-1, 1, 256)
    ref_s = voices[len(tokens)]
    input_ids = np.array([[0, *tokens, 0]], dtype=np.int64)
    speed_input = np.array([speed], dtype=np.float32)

    requested_device = (DEFAULT_KOKORO_DEVICE or "cuda").lower()
    if requested_device == "cpu":
        providers = ["CPUExecutionProvider"]
    elif requested_device == "cuda":
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    else:
        raise RuntimeError(
            f"Python Kokoro ONNX backend supports KOKORO_DEVICE=cuda or cpu, got {requested_device!r}."
        )

    available = ort.get_available_providers()
    if providers[0] not in available:
        raise RuntimeError(f"ONNX Runtime provider {providers[0]} is not available. Available: {available}")

    sess = ort.InferenceSession(str(model_path), providers=providers)
    active = sess.get_providers()
    print(f"Kokoro ONNX Runtime providers={active} model={DEFAULT_KOKORO_ONNX_MODEL} voice={voice}")
    if requested_device == "cuda" and (not active or active[0] != "CUDAExecutionProvider"):
        raise RuntimeError(f"CUDAExecutionProvider was requested but session providers are {active}")

    audio = sess.run(None, {"input_ids": input_ids, "style": ref_s, "speed": speed_input})[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(output_path, 24000, audio[0])


def _run_kokoro_js(text: str, output_path: Path, voice: str, speed: float) -> None:
    env = os.environ.copy()
    env.update(
        {
            "KOKORO_TEXT": text,
            "KOKORO_OUTPUT": str(output_path),
            "KOKORO_MODEL": DEFAULT_KOKORO_MODEL,
            "KOKORO_DTYPE": DEFAULT_KOKORO_DTYPE,
            "KOKORO_VOICE": voice,
            "KOKORO_SPEED": str(speed),
            "KOKORO_DEVICE": DEFAULT_KOKORO_DEVICE,
        }
    )

    tmp_path: Path | None = None
    try:
        tmp_dir = PROJECT_ROOT / ".tmp"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".mjs",
            delete=False,
            encoding="utf-8",
            dir=str(tmp_dir),
        ) as tmp:
            tmp.write(KOKORO_JS)
            tmp_path = Path(tmp.name)

        result = subprocess.run(
            ["node", str(tmp_path)],
            cwd=str(PROJECT_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Node.js not found on PATH. Install Node.js and retry.") from exc
    finally:
        if tmp_path and tmp_path.exists():
            try:
                tmp_path.unlink(missing_ok=True)
            except PermissionError:
                # Windows can briefly lock temp files after process exit.
                pass

    def _summarize_process_output(output: str) -> str:
        lines = []
        for line in output.splitlines():
            clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            if not clean:
                continue
            if clean.startswith(("Kokoro ", "RuntimeError:", "Error:", "An error occurred")):
                lines.append(clean)
            elif "Status Message:" in clean:
                lines.append(clean[:500])
            elif "failed" in clean.lower() or "unsupported device" in clean.lower():
                lines.append(clean[:500])
        return "\n".join(lines[-20:]) or output.strip()[:1000] or "Unknown error"

    if result.returncode != 0:
        detail = _summarize_process_output(result.stderr or result.stdout or "")
        raise RuntimeError(f"kokoro-js failed: {detail}")
    if result.stderr.strip():
        detail = _summarize_process_output(result.stderr)
        if detail:
            print(detail)


def _run_kokoro(text: str, output_path: Path, voice: str, speed: float) -> None:
    if DEFAULT_KOKORO_ENGINE in {"onnxruntime", "onnx", "ort", "cuda"}:
        try:
            _run_kokoro_onnxruntime(text, output_path, voice, speed)
            return
        except Exception as exc:
            if os.getenv("KOKORO_STRICT_GPU", "").strip() in {"1", "true", "yes"}:
                raise
            log.warning(f"Kokoro ONNX Runtime backend failed; falling back to kokoro-js. {exc}")
    elif DEFAULT_KOKORO_ENGINE not in {"kokoro-js", "node", "js"}:
        raise RuntimeError("KOKORO_ENGINE must be one of: onnxruntime, kokoro-js")

    _run_kokoro_js(text, output_path, voice, speed)


def _run_kokoro_chunked(text: str, output_path: Path, voice: str, speed: float) -> None:
    chunks = _split_text_into_sentence_chunks(text)
    if len(chunks) <= 1:
        _run_kokoro(text, output_path, voice, speed)
        return

    tmp_root = PROJECT_ROOT / ".tmp"
    tmp_root.mkdir(parents=True, exist_ok=True)

    chunk_paths: list[Path] = []
    with tempfile.TemporaryDirectory(dir=str(tmp_root), prefix="kokoro_chunks_") as td:
        chunk_dir = Path(td)
        chunk_paths = [chunk_dir / f"chunk_{idx:04d}.wav" for idx in range(len(chunks))]
        configured_workers = os.getenv("KOKORO_CHUNK_WORKERS")
        if configured_workers:
            max_workers = int(configured_workers)
        elif DEFAULT_KOKORO_ENGINE in {"onnxruntime", "onnx", "ort", "cuda"} and DEFAULT_KOKORO_DEVICE == "cuda":
            max_workers = 1
        else:
            max_workers = min(len(chunks), max(1, os.cpu_count() or 4), 8)
        max_workers = max(1, min(len(chunks), max_workers))

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {
                executor.submit(_run_kokoro, chunk_text, chunk_paths[idx], voice, speed): idx
                for idx, chunk_text in enumerate(chunks)
            }
            for future in as_completed(future_map):
                idx = future_map[future]
                try:
                    future.result()
                except Exception as exc:
                    raise RuntimeError(f"Kokoro chunk {idx + 1}/{len(chunks)} failed: {exc}") from exc

        _concat_wavs(chunk_paths, output_path)


def tts(
    text: str,
    provider: str = "openai",
    voice: str | None = None,
    output_path: str | None = None,
    speed: float | None = None,
) -> str:
    """
    Generate speech audio and return the output file path.

    Args:
        text: Input text to synthesize.
        provider: One of "openai", "google", "gemini", "kokoro".
        voice: Provider voice name/id. If omitted, provider default is used.
        output_path: Output WAV file path or directory. If omitted, a timestamped
            file is created in provider-specific default output directories.
        speed: Optional speaking speed. Currently applied only for provider="kokoro".
            Must be greater than 0.

    Provider voices:
        openai:
            alloy, ash, ballad, coral, cedar, echo, fable, marin, nova,
            onyx, sage, shimmer, verse
        google/gemini:
            Accepts Google prebuilt voice_name values (catalog may change).
            Common names include Achernar, Achird, Algenib, Algieba, Alnilam,
            Aoede, Autonoe, Callirrhoe, Charon, Despina, Enceladus, Erinome,
            Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus, Puck,
            Pulcherrima, Rasalgethi, Sadachbia, Sadaltager, Schedar, Sulafat,
            Umbriel, Vindemiatrix, Zephyr, Zubenelgenubi.
        kokoro:
            af_heart, af_alloy, af_aoede, af_bella, af_jessica, af_kore,
            af_nicole, af_nova, af_river, af_sarah, af_sky,
            am_adam, am_echo, am_eric, am_fenrir, am_liam, am_michael,
            am_onyx, am_puck, am_santa,
            bf_emma, bf_isabella, bf_alice, bf_lily,
            bm_george, bm_lewis, bm_daniel, bm_fable

            kokoro voices demo: https://gregr.org/tts-samples/
    """
    clean_text = (text or "").strip()
    if not clean_text:
        raise ValueError("Text content is empty.")

    chosen_provider = (provider or "openai").strip().lower()
    if chosen_provider == "gemini":
        chosen_provider = "google"
    if chosen_provider not in {"openai", "google", "kokoro"}:
        raise ValueError("provider must be one of: openai, google, gemini, kokoro")

    out_path = _resolve_output_path(output_path, chosen_provider)
    log.info(f"TTS provider={chosen_provider} -> {out_path}")

    if chosen_provider == "openai":
        client = _openai_client()
        chosen_voice = (voice or DEFAULT_OPENAI_VOICE).strip()
        with client.audio.speech.with_streaming_response.create(
            model=DEFAULT_OPENAI_MODEL,
            voice=chosen_voice,
            input=clean_text,
            response_format="wav",
        ) as response:
            response.stream_to_file(str(out_path))
        return str(out_path)

    if chosen_provider == "google":
        if types is None:
            raise RuntimeError("Google GenAI SDK types are not available")

        client = _google_client()
        chosen_model = DEFAULT_GEMINI_MODEL
        if chosen_model not in _ALLOWED_GEMINI_MODELS:
            chosen_model = "gemini-2.5-flash-preview-tts"
        chosen_voice = (voice or DEFAULT_GEMINI_VOICE).strip()

        response = client.models.generate_content(
            model=chosen_model,
            contents=clean_text,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=chosen_voice
                        )
                    )
                ),
            ),
        )
        pcm_data = response.candidates[0].content.parts[0].inline_data.data
        _save_wave(str(out_path), pcm_data)
        return str(out_path)

    if chosen_provider == "kokoro":
        chosen_voice = (voice or DEFAULT_KOKORO_VOICE).strip()
        chosen_speed = float(speed) if speed is not None else 1.0
        if chosen_speed <= 0:
            raise ValueError("speed must be greater than 0")
        log.info(
            f"Kokoro config model={DEFAULT_KOKORO_MODEL} dtype={DEFAULT_KOKORO_DTYPE} "
            f"device={DEFAULT_KOKORO_DEVICE or 'default'} voice={chosen_voice} speed={chosen_speed}"
        )
        _run_kokoro_chunked(clean_text, out_path, chosen_voice, chosen_speed)
        return str(out_path)


if __name__ == "__main__":
    sample = """
When we want to add data to a Red-Black tree, we don’t just throw a node in and hope for the best. We follow a very, very specific strategy to ensure the tree remains balanced without, you know... causing a massive structural headache.
So, let's talk about the first rule: The Red Insertion Policy. Whenever you insert a new pair into the tree, you follow the standard binary search tree path until you find the correct spot. But—and here is the critical rule—you must always color the new node red.
Now, why red? Well, think about the two main rules we discussed earlier. First, no two red nodes can be consecutive. And second, every path must have the same number of black nodes.
If you insert a black node, you immediately violate that second rule. I repeat, you violate the black-depth rule. Every single path going through that new node now has one extra black node compared to all the other paths in the tree. This black node deficiency is a global problem, and it's notoriously difficult to fix. In fact, it would basically require restructuring almost every single time.
However, if you insert a red node, you don’t change the black node count at all! The only rule you risk breaking is the "no consecutive red nodes" rule. This is a local problem. It only happens right where you inserted the node, and as we’ll see, local problems are much, much easier to patch up.
"""
    print(tts(sample, provider="kokoro", voice="am_liam", output_path="outputs/tts/kokoro_sample.wav", speed=0.9))
