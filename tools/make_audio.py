"""Record every text the app can speak with free, offline Piper voices (all CC0).

Usage (from the repo root):  python3 tools/make_audio.py --models /path/to/models
Needs: pip install piper-tts, ffmpeg, and the .onnx + .onnx.json voice files from
huggingface.co/rhasspy/piper-voices (de_DE: kerstin-medium, thorsten-high, thorsten_emotional-medium).
Only missing clips are made, so run it again after adding a deck. Writes audio/<voice>/<key>.mp3
and audio/index.json. See SPEC.md Part D.
"""
import argparse, json, os, subprocess, sys, tempfile, wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"

# voice id -> (model file, speaker name or None, label shown in the app)
VOICES = {
    "kerstin": ("de_DE-kerstin-medium", None, "Kerstin"),
    "thorsten": ("de_DE-thorsten-high", None, "Thorsten"),
    "amused": ("de_DE-thorsten_emotional-medium", "amused", "Thorsten, amused"),
    "surprised": ("de_DE-thorsten_emotional-medium", "surprised", "Thorsten, surprised"),
    "whisper": ("de_DE-thorsten_emotional-medium", "whisper", "Thorsten, whispering"),
    "sleepy": ("de_DE-thorsten_emotional-medium", "sleepy", "Thorsten, sleepy"),
}


def texts():
    out = subprocess.run(["node", str(ROOT / "tools" / "audio-texts.mjs")], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True, help="folder with the .onnx and .onnx.json files")
    ap.add_argument("--voices", default=",".join(VOICES), help="comma list of voice ids")
    args = ap.parse_args()
    items = texts()
    index_path = AUDIO / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"voices": {}}
    loaded = {}
    for vid in args.voices.split(","):
        model, speaker, label = VOICES[vid]
        if model not in loaded:
            loaded[model] = PiperVoice.load(os.path.join(args.models, model + ".onnx"))
        voice = loaded[model]
        cfg = SynthesisConfig(speaker_id=voice.config.speaker_id_map[speaker] if speaker else None)
        folder = AUDIO / vid
        folder.mkdir(parents=True, exist_ok=True)
        made = 0
        for it in items:
            mp3 = folder / f"{it['key']}.mp3"
            if mp3.exists():
                continue
            with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
                with wave.open(tmp.name, "wb") as wf:
                    voice.synthesize_wav(it["text"], wf, cfg)
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp.name, "-ac", "1", "-ar", "22050",
                                "-codec:a", "libmp3lame", "-q:a", "7", str(mp3)], check=True)
            made += 1
        keys = sorted(p.stem for p in folder.glob("*.mp3"))
        index["voices"][vid] = {"label": label, "keys": keys}
        print(f"{vid}: {made} new, {len(keys)} total", file=sys.stderr)
    index_path.write_text(json.dumps(index, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
