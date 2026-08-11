"""
Unified TTS helpers.

Single public API:
    tts(text, provider, voice, output_path, speed, alignment, alignment_output_path)

All providers write WAV files. Cloud providers generate speech remotely;
OmniVoice generates speech locally.

Providers available via this module:
1) openai
   - Provider key: "openai"
   - Model and default voice are required via OPENAI_TTS_MODEL and
     OPENAI_TTS_VOICE.
   - Available voices:
     alloy, ash, ballad, coral, cedar, echo, fable, marin, nova,
     onyx, sage, shimmer, verse

2) google (Gemini TTS)
   - Provider keys: "google", "gemini" (alias)
   - Model and default voice are required via GOOGLE_TTS_MODEL and
     GOOGLE_TTS_VOICE.
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

3) omnivoice (local zero-shot voice cloning)
   - Provider key: "omnivoice"
   - Loads k2-fsa/OmniVoice with PyTorch on CUDA when available, otherwise CPU.
   - Voice names resolve to folders under <project>/voices, case-insensitively.
   - Each voice folder must contain a reference WAV and may contain a reference
     transcript TXT file.
   - Defaults to voice "american-male-1" and speed 0.85.
   - Automatically selects Bengali when the input contains Bengali Unicode
     characters; otherwise it selects English.
   - Writes 24 kHz WAV through soundfile.

4) elevenlabs
   - Provider keys: "elevenlabs", "11labs" (alias)
   - API key and model are required via ELEVENLABS_API_KEY and
     ELEVENLABS_TTS_MODEL. There is no model fallback.
   - Voice is an ElevenLabs voice ID.
   - Voice selection order is: explicit voice argument, ELEVENLABS_TTS_VOICE,
     ELEVENLABS_VOICE_ID, then the built-in Will voice.
   - Optional ELEVENLABS_STABILITY (default 0.7) and ELEVENLABS_SIMILARITY_BOOST
     (default 0.75) tune delivery consistency on Flash and other models.
   - previous_text / next_text (optional tts() args) improve cadence across cues.
   - Requests 24 kHz signed 16-bit PCM and wraps it in a WAV container without
     audio transcoding.
   - Optional alignment writes normalized character timings and derived word
     start/end timings to JSON.
"""

from __future__ import annotations

import argparse
import base64
import os
import json
import re
import sys
import unicodedata

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import time
import wave
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
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

def _require_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        raise RuntimeError(f"Set {name} in .env")
    return value.strip()


_ALLOWED_GEMINI_MODELS = {
    "gemini-3-flash-preview-tts",
    "gemini-3-flash-lite-preview-tts",
    "gemini-3-pro-tts",
    "gemini-2.5-flash-preview-tts",
}

ELEVENLABS_OUTPUT_FORMAT = "pcm_24000"


@lru_cache(maxsize=1)
def _openai_settings() -> tuple[str, str]:
    return _require_env("OPENAI_TTS_MODEL"), _require_env("OPENAI_TTS_VOICE")


@lru_cache(maxsize=1)
def _gemini_settings() -> tuple[str, str]:
    return _require_env("GOOGLE_TTS_MODEL"), _require_env("GOOGLE_TTS_VOICE")


@lru_cache(maxsize=1)
def _elevenlabs_settings() -> tuple[str, str]:
    model = _require_env("ELEVENLABS_TTS_MODEL")
    voice = os.getenv(
        "ELEVENLABS_TTS_VOICE",
        os.getenv("ELEVENLABS_VOICE_ID", "bIHbv24MWmeRgasZH58o"),
    ).strip()  # Will
    return model, voice


def _clamp_elevenlabs_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _optional_elevenlabs_unit_env(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return _clamp_elevenlabs_unit(float(raw))
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number between 0 and 1.") from exc


@lru_cache(maxsize=1)
def _elevenlabs_voice_settings_base() -> dict[str, float]:
    return {
        "stability": _optional_elevenlabs_unit_env("ELEVENLABS_STABILITY", 0.7),
        "similarity_boost": _optional_elevenlabs_unit_env(
            "ELEVENLABS_SIMILARITY_BOOST", 0.75
        ),
    }


ELEVENLABS_CONTEXT_MAX_CHARS = 500


def _truncate_elevenlabs_previous_text(text: str | None) -> str | None:
    trimmed = (text or "").strip()
    if not trimmed:
        return None
    if len(trimmed) <= ELEVENLABS_CONTEXT_MAX_CHARS:
        return trimmed
    return trimmed[-ELEVENLABS_CONTEXT_MAX_CHARS:]


def _truncate_elevenlabs_next_text(text: str | None) -> str | None:
    trimmed = (text or "").strip()
    if not trimmed:
        return None
    if len(trimmed) <= ELEVENLABS_CONTEXT_MAX_CHARS:
        return trimmed
    return trimmed[:ELEVENLABS_CONTEXT_MAX_CHARS]


@lru_cache(maxsize=1)
def _resolve_output_path(output_path: str | None, provider: str) -> Path:
    base = DEFAULT_OUTPUT_DIR
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


def _elevenlabs_word_alignment(character_alignment: dict[str, Any]) -> list[dict[str, Any]]:
    """Derive punctuation-excluding word boundaries from character timings."""
    characters = character_alignment.get("characters")
    starts = character_alignment.get("character_start_times_seconds")
    ends = character_alignment.get("character_end_times_seconds")
    if not all(isinstance(values, list) for values in (characters, starts, ends)):
        raise RuntimeError("ElevenLabs returned incomplete character alignment data.")
    if not (len(characters) == len(starts) == len(ends)):
        raise RuntimeError("ElevenLabs returned mismatched character alignment arrays.")

    def _is_word_character(value: str) -> bool:
        return any(unicodedata.category(part)[0] in {"L", "M", "N"} for part in value)

    words: list[dict[str, Any]] = []
    current_characters: list[str] = []
    current_start: float | None = None
    current_end: float | None = None

    def _finish_word() -> None:
        nonlocal current_characters, current_start, current_end
        if not current_characters:
            return
        words.append(
            {
                "word": "".join(current_characters),
                "start_seconds": current_start,
                "end_seconds": current_end,
            }
        )
        current_characters = []
        current_start = None
        current_end = None

    for index, (character, start, end) in enumerate(zip(characters, starts, ends)):
        character = str(character)
        next_character = str(characters[index + 1]) if index + 1 < len(characters) else ""
        is_internal_joiner = (
            character in {"'", "\N{RIGHT SINGLE QUOTATION MARK}", "-"}
            and bool(current_characters)
            and _is_word_character(next_character)
        )
        if not _is_word_character(character) and not is_internal_joiner:
            _finish_word()
            continue
        if current_start is None:
            current_start = float(start)
        current_characters.append(character)
        current_end = float(end)

    _finish_word()
    return words


def _run_elevenlabs(
    text: str,
    output_path: Path,
    voice: str,
    speed: float,
    alignment: bool,
    alignment_output_path: str | None,
    previous_text: str | None = None,
    next_text: str | None = None,
) -> None:
    """
    Request 24 kHz PCM from ElevenLabs and write WAV plus optional timing JSON.

    The PCM is placed in a WAV container locally; it is not decoded, resampled,
    or transcoded. Alignment uses normalized character timing when available and
    falls back to timing for the original text.
    """
    elevenlabs_model, _ = _elevenlabs_settings()
    endpoint = (
        "https://api.elevenlabs.io/v1/text-to-speech/"
        + quote(voice, safe="")
    )
    if alignment:
        endpoint += "/with-timestamps"
    endpoint += "?" + urlencode({"output_format": ELEVENLABS_OUTPUT_FORMAT})

    voice_settings = dict(_elevenlabs_voice_settings_base())
    voice_settings["speed"] = speed

    payload: dict[str, Any] = {
        "text": text,
        "model_id": elevenlabs_model,
        "voice_settings": voice_settings,
    }
    prev = _truncate_elevenlabs_previous_text(previous_text)
    nxt = _truncate_elevenlabs_next_text(next_text)
    if prev:
        payload["previous_text"] = prev
    if nxt:
        payload["next_text"] = nxt

    request = Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json" if alignment else "application/octet-stream",
            "Content-Type": "application/json",
            "xi-api-key": _require_env("ELEVENLABS_API_KEY"),
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            response_body = response.read()
            request_id = response.headers.get("request-id")
            character_cost = response.headers.get("character-cost")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.dumps(json.loads(detail), ensure_ascii=False)
        except json.JSONDecodeError:
            detail = detail[:1000]
        raise RuntimeError(f"ElevenLabs request failed ({exc.code}): {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Could not reach ElevenLabs: {exc.reason}") from exc

    if not alignment:
        _save_wave(str(output_path), response_body, rate=24000)
        return

    try:
        response_json = json.loads(response_body)
        audio_bytes = base64.b64decode(response_json["audio_base64"], validate=True)
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise RuntimeError("ElevenLabs returned an invalid timing response.") from exc

    _save_wave(str(output_path), audio_bytes, rate=24000)
    chosen_alignment = (
        response_json.get("normalized_alignment") or response_json.get("alignment")
    )
    if not isinstance(chosen_alignment, dict):
        raise RuntimeError("ElevenLabs returned no alignment data.")

    timing_path = (
        Path(alignment_output_path)
        if alignment_output_path
        else output_path.with_suffix(".alignment.json")
    )
    timing_path.parent.mkdir(parents=True, exist_ok=True)
    timing_data = {
        "text": text,
        "alignment_source": (
            "normalized_alignment"
            if response_json.get("normalized_alignment")
            else "alignment"
        ),
        "voice_id": voice,
        "model_id": elevenlabs_model,
        "request_id": request_id,
        "character_cost": character_cost,
        "words": _elevenlabs_word_alignment(chosen_alignment),
        "characters": chosen_alignment,
    }
    timing_path.write_text(
        json.dumps(timing_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _openai_client() -> OpenAI:
    api_key = _require_env("OPENAI_API_KEY")
    if OpenAI is None:
        raise RuntimeError("OpenAI SDK is not available")
    return OpenAI(api_key=api_key)


def _google_client() -> genai.Client:
    api_key = _require_env("GOOGLE_API_KEY")
    if genai is None:
        raise RuntimeError("Google GenAI SDK is not available")
    return genai.Client(api_key=api_key)


_OMNIVOICE_MODEL = None


def _get_omnivoice_model():
    """Load and cache OmniVoice on CUDA when available, otherwise on CPU."""
    global _OMNIVOICE_MODEL
    if _OMNIVOICE_MODEL is None:
        import torch
        from omnivoice import OmniVoice
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        print("[+] Loading OmniVoice model...", flush=True)
        _OMNIVOICE_MODEL = OmniVoice.from_pretrained(
            "k2-fsa/OmniVoice",
            device_map=device,
            dtype=dtype
        )
    return _OMNIVOICE_MODEL


def _run_omnivoice(text: str, output_path: Path, voice: str, speed: float) -> None:
    """
    Clone a local reference voice with OmniVoice and write a 24 kHz WAV.

    ``voice`` names a directory under ``<project>/voices``. The directory must
    contain a reference WAV and may contain a TXT transcript for that audio.
    """
    import soundfile as sf

    # Resolve the requested reference-voice folder case-insensitively.
    voices_root = PROJECT_ROOT / "voices"
    voice_dir = voices_root / voice
    if not voice_dir.is_dir():
        # Try case-insensitive lookup
        found_dir = None
        if voices_root.is_dir():
            for item in voices_root.iterdir():
                if item.is_dir() and item.name.lower() == voice.lower():
                    found_dir = item
                    break
        if found_dir:
            voice_dir = found_dir
        else:
            raise RuntimeError(f"OmniVoice voice directory not found: {voice_dir}")

    # Use the first reference WAV and, when present, its TXT transcript.
    ref_audio = None
    ref_text = None

    for item in voice_dir.iterdir():
        if item.is_file():
            if item.suffix.lower() == ".wav":
                ref_audio = item
            elif item.suffix.lower() == ".txt":
                try:
                    ref_text = item.read_text(encoding="utf-8").strip()
                except Exception:
                    ref_text = item.read_text(encoding="latin-1").strip()

    if not ref_audio:
        raise RuntimeError(f"No reference .wav file found in voice directory: {voice_dir}")

    # OmniVoice is currently routed to Bengali or English from the input script.
    has_bengali = any('\u0980' <= char <= '\u09ff' for char in text)
    language = "Bengali" if has_bengali else "English"

    # Match the punctuation spacing expected by the English OmniVoice tokenizer.
    if language.lower() in ["english", "en"]:
        for punc in [".", ",", "?", "!"]:
            text = text.replace(f" {punc}", f" {punc}").replace(punc, f" {punc}")
            if ref_text:
                ref_text = ref_text.replace(f" {punc}", f" {punc}").replace(punc, f" {punc}")

    # The cached model avoids repeating the expensive local model load.
    model = _get_omnivoice_model()

    gen_kwargs = {
        "text": text,
        "language": language,
        "speed": speed,
        "postprocess_output": False,
        "ref_audio": str(ref_audio),
    }
    if ref_text:
        gen_kwargs["ref_text"] = ref_text

    print(f"[OmniVoice] Generating TTS with voice '{voice}' ({language}, speed={speed})...", flush=True)
    print(f"  Ref Audio: {ref_audio}", flush=True)
    if ref_text:
        print(f"  Ref Text: {ref_text}", flush=True)

    audio = model.generate(**gen_kwargs)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audio[0], 24000)
    print(f"[OmniVoice] Audio successfully saved to: '{output_path}'", flush=True)


def tts(
    text: str,
    provider: str = "openai",
    voice: str | None = None,
    output_path: str | None = None,
    speed: float | None = None,
    alignment: bool = False,
    alignment_output_path: str | None = None,
    previous_text: str | None = None,
    next_text: str | None = None,
) -> str:
    """
    Generate speech audio and return the output file path.

    Args:
        text: Input text to synthesize.
        provider: One of "openai", "google", "gemini", "omnivoice",
            "elevenlabs", or "11labs".
        voice: Provider voice name, voice ID, or local reference-voice folder.
            If omitted, the provider default is used.
        output_path: Output WAV file path or directory. If omitted, a timestamped
            WAV is created in the provider-specific default output directory.
            A path without a ".wav" suffix is treated as a directory.
        speed: Optional speaking speed. Applied to OmniVoice and ElevenLabs and
            ignored by OpenAI and Google. Defaults to 1.0 for ElevenLabs and
            0.85 for OmniVoice. Must be greater than 0.
        alignment: For ElevenLabs only, request timing data and write normalized
            character alignment plus derived word start/end timings to JSON.
        alignment_output_path: Optional ElevenLabs alignment JSON path. Defaults
            to the audio path with an ".alignment.json" suffix.
        previous_text: ElevenLabs only. Tail-truncated prior cue for continuity.
        next_text: ElevenLabs only. Head-truncated following cue for continuity.

    Returns:
        The generated WAV path as a string.

    Raises:
        ValueError: If text, provider, speed, or alignment options are invalid.
        RuntimeError: If required configuration is missing or synthesis fails.

    Provider configuration and voices:
        openai:
            Uses OPENAI_TTS_MODEL and OPENAI_TTS_VOICE. An explicit voice
            overrides the configured default.

            alloy, ash, ballad, coral, cedar, echo, fable, marin, nova,
            onyx, sage, shimmer, verse

        google/gemini:
            Uses GOOGLE_TTS_MODEL and GOOGLE_TTS_VOICE. An explicit voice
            overrides the configured default.

            Accepts Google prebuilt voice_name values (catalog may change).
            Common names include Achernar, Achird, Algenib, Algieba, Alnilam,
            Aoede, Autonoe, Callirrhoe, Charon, Despina, Enceladus, Erinome,
            Fenrir, Gacrux, Iapetus, Kore, Laomedeia, Leda, Orus, Puck,
            Pulcherrima, Rasalgethi, Sadachbia, Sadaltager, Schedar, Sulafat,
            Umbriel, Vindemiatrix, Zephyr, Zubenelgenubi.

        elevenlabs/11labs:
            Requires ELEVENLABS_API_KEY and ELEVENLABS_TTS_MODEL. Accepts an
            ElevenLabs voice ID. Voice selection order is the explicit voice,
            ELEVENLABS_TTS_VOICE, ELEVENLABS_VOICE_ID, then the built-in
            Will voice. Optional ELEVENLABS_STABILITY (default 0.7) and
            ELEVENLABS_SIMILARITY_BOOST (default 0.75) tune delivery consistency.
            previous_text / next_text improve cadence across cues. Alignment is
            available only for this provider.

        omnivoice:
            Accepts the name of a folder under <project>/voices. That folder
            must contain a reference WAV and may contain its transcript as TXT.
            Folder lookup is case-insensitive. Defaults to
            "american-male-1". Input containing Bengali Unicode characters is
            synthesized as Bengali; all other input is synthesized as English.
    """
    clean_text = (text or "").strip()
    if not clean_text:
        raise ValueError("Text content is empty.")

    chosen_provider = (provider or "openai").strip().lower()
    if chosen_provider == "gemini":
        chosen_provider = "google"
    if chosen_provider == "11labs":
        chosen_provider = "elevenlabs"
    if chosen_provider not in {
        "openai",
        "google",
        "omnivoice",
        "elevenlabs",
    }:
        raise ValueError(
            "provider must be one of: openai, google, gemini, "
            "omnivoice, elevenlabs, 11labs"
        )
    if alignment and chosen_provider != "elevenlabs":
        raise ValueError("alignment is supported only for provider='elevenlabs'")
    if alignment_output_path and not alignment:
        raise ValueError("alignment_output_path requires alignment=True")

    out_path = _resolve_output_path(output_path, chosen_provider)
    log.info(f"TTS provider={chosen_provider} -> {out_path}")

    if chosen_provider == "openai":
        openai_model, openai_voice = _openai_settings()
        client = _openai_client()
        chosen_voice = (voice or openai_voice).strip()
        with client.audio.speech.with_streaming_response.create(
            model=openai_model,
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
        chosen_model, gemini_voice = _gemini_settings()
        if chosen_model not in _ALLOWED_GEMINI_MODELS:
            raise RuntimeError(
                "GOOGLE_TTS_MODEL must be one of: "
                + ", ".join(sorted(_ALLOWED_GEMINI_MODELS))
            )
        chosen_voice = (voice or gemini_voice).strip()

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

    if chosen_provider == "elevenlabs":
        elevenlabs_model, elevenlabs_voice = _elevenlabs_settings()
        chosen_voice = (voice or elevenlabs_voice).strip()
        if not chosen_voice:
            raise ValueError(
                "Set an ElevenLabs voice ID with voice=, "
                "ELEVENLABS_TTS_VOICE, or ELEVENLABS_VOICE_ID."
            )
        chosen_speed = float(speed) if speed is not None else 1.0
        if chosen_speed <= 0:
            raise ValueError("speed must be greater than 0")
        voice_settings = _elevenlabs_voice_settings_base()
        log.info(
            f"ElevenLabs config model={elevenlabs_model} "
            f"voice={chosen_voice} speed={chosen_speed} "
            f"stability={voice_settings['stability']} "
            f"similarity_boost={voice_settings['similarity_boost']} "
            f"alignment={alignment} "
            f"previous_text={'yes' if previous_text else 'no'} "
            f"next_text={'yes' if next_text else 'no'}"
        )
        _run_elevenlabs(
            clean_text,
            out_path,
            chosen_voice,
            chosen_speed,
            alignment,
            alignment_output_path,
            previous_text,
            next_text,
        )
        return str(out_path)

    if chosen_provider == "omnivoice":
        chosen_voice = (voice or "american-male-1").strip()
        chosen_speed = float(speed) if speed is not None else 0.85
        if chosen_speed <= 0:
            raise ValueError("speed must be greater than 0")
        _run_omnivoice(clean_text, out_path, chosen_voice, chosen_speed)
        return str(out_path)


def _legacy_sample() -> None:
    sample = """
When we want to add data to a Red-Black tree, we don’t just throw a node in and hope for the best. We follow a very, very specific strategy to ensure the tree remains balanced without, you know... causing a massive structural headache.
So, let's talk about the first rule: The Red Insertion Policy. Whenever you insert a new pair into the tree, you follow the standard binary search tree path until you find the correct spot. But—and here is the critical rule—you must always color the new node red.
Now, why red? Well, think about the two main rules we discussed earlier. First, no two red nodes can be consecutive. And second, every path must have the same number of black nodes.
If you insert a black node, you immediately violate that second rule. I repeat, you violate the black-depth rule. Every single path going through that new node now has one extra black node compared to all the other paths in the tree. This black node deficiency is a global problem, and it's notoriously difficult to fix. In fact, it would basically require restructuring almost every single time.
However, if you insert a red node, you don’t change the black node count at all! The only rule you risk breaking is the "no consecutive red nodes" rule. This is a local problem. It only happens right where you inserted the node, and as we’ll see, local problems are much, much easier to patch up.
"""
    print(tts(sample, provider="omnivoice", voice="maruf", output_path="outputs/tts/omnivoice_sample.wav", speed=1.2))


def _parse_cli_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate WAV speech with OpenAI, Google, OmniVoice, "
            "or ElevenLabs."
        )
    )
    parser.add_argument("--text", required=True, help="Text to synthesize.")
    parser.add_argument(
        "--provider",
        default="openai",
        help=(
            "Provider: openai, google/gemini, omnivoice, "
            "or elevenlabs/11labs (default: openai)."
        ),
    )
    parser.add_argument(
        "--voice",
        default=None,
        help="Provider voice name/ID or OmniVoice reference-folder name.",
    )
    parser.add_argument("--output", default=None, help="Output WAV path or directory.")
    parser.add_argument(
        "--speed",
        type=float,
        default=None,
        help="OmniVoice or ElevenLabs speaking speed.",
    )
    parser.add_argument(
        "--alignment",
        action="store_true",
        help="For ElevenLabs, save word and character timing JSON.",
    )
    parser.add_argument(
        "--alignment-output",
        default=None,
        help="ElevenLabs alignment JSON path.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_cli_args(argv)
    started_at = time.perf_counter()
    try:
        audio_path = tts(
            args.text,
            provider=args.provider,
            voice=args.voice,
            output_path=args.output,
            speed=args.speed,
            alignment=args.alignment,
            alignment_output_path=args.alignment_output,
        )
    except (RuntimeError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(audio_path)
    if args.alignment:
        timing_path = (
            Path(args.alignment_output)
            if args.alignment_output
            else Path(audio_path).with_suffix(".alignment.json")
        )
        print(timing_path)
    print(f"Generation time: {time.perf_counter() - started_at:.3f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
