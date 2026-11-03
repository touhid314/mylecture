"""Persistent local OmniVoice worker. JSON lines on stdout, model logs on stderr."""
import contextlib
import json
import os
from pathlib import Path
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def emit(value):
    print(json.dumps(value), flush=True)


try:
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import soundfile as sf
        from omnivoice import OmniVoice
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        model = OmniVoice.from_pretrained(
            "k2-fsa/OmniVoice", device_map=device,
            dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        )
    emit({"type": "ready", "device": device})
except Exception as exc:
    emit({"type": "init-error", "message": str(exc)})
    sys.exit(1)

for line in sys.stdin:
    job = {}
    try:
        job = json.loads(line)
        folder = Path(os.environ["ML_OMNIVOICE_VOICES"]) / job["voice"]
        if not re.fullmatch(r"[\w-]+", job["voice"]):
            raise ValueError("Invalid reference voice")
        audio = folder / "reference.wav"
        ref_text = (folder / "transcript.txt").read_text(encoding="utf-8").strip()
        text = job["text"]
        language = "Bengali" if re.search(r"[\u0980-\u09ff]", text) else "English"
        if language == "English":
            text = re.sub(r"\s*([.,?!])", r" \1", text)
            ref_text = re.sub(r"\s*([.,?!])", r" \1", ref_text)
        with contextlib.redirect_stdout(sys.stderr):
            samples = model.generate(text=text, language=language, speed=job["speed"],
                                     postprocess_output=False, ref_audio=str(audio), ref_text=ref_text)
            sf.write(job["file"], samples[0], 24000, subtype="PCM_16")
        emit({"type": "done", "id": job["id"]})
    except Exception as exc:
        emit({"type": "error", "id": job.get("id"), "message": str(exc)})
