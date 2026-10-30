#!/usr/bin/env python3
"""Russian Launchpad — real TTS audio via edge-tts (free, no API key).

Reads rl-content/course.json, synthesizes every pronunciation phrase and
speech-blank transcript that carries U+0301 stress marks into OGG (Vorbis)
files under rl-content/media/audio/. Falls back to silent placeholder if a
single item fails, so the pipeline never breaks.

Usage:  python3 scripts/generate_audio.py [--voice ru-RU-SvetlanaNeural] [--workers 4]
Then:   python3 scripts/build_all.py
"""
import argparse, asyncio, json, os, re, subprocess, sys, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "rl-content")
AUDIO_DIR = os.path.join(CONTENT, "media", "audio")


def clean_ru(s):
    """Remove quotation marks and stray backslashes from Russian display/TTS text.

    Quotes must never appear on screen and must never be spoken by TTS."""
    if not isinstance(s, str):
        return s
    for q in ('\u00ab', '\u00bb', '\u201c', '\u201d', '\u201e'):
        s = s.replace(q, '')
    s = s.replace('"', '').replace("'", '').replace('\u2019', '').replace('\\', '')
    return re.sub(r'\s{2,}', ' ', s).strip()

def collect_items():
    c = json.load(open(os.path.join(CONTENT, "course.json"), encoding="utf-8"))
    items = []
    for l in c["lessons"]:
        for p in l.get("pronunciation", []):
            if p.get("audio"):
                items.append((p["id"], p["audio"].replace(".wav", ".ogg"), clean_ru(p["ru"])))
        for s in l.get("speechBlanks", []):
            if s.get("audio"):
                items.append((s["id"], s["audio"].replace(".wav", ".ogg"), clean_ru(s.get("transcript", ""))))
    return items

def strip_for_tts(text):
    # edge-tts handles U+0301; remove ellipsis/odd chars that confuse it
    return text.replace("\u2026", "...").strip()

async def synth_one(item_id, rel_path, text, voice, sem):
    async with sem:
        fp = os.path.join(CONTENT, rel_path)
        mp3 = tempfile.mktemp(suffix=".mp3")
        try:
            import edge_tts
            com = edge_tts.Communicate(strip_for_tts(text), voice)
            await com.save(mp3)
            # convert mp3 -> ogg vorbis
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3,
                                "-c:a", "libvorbis", "-q:a", "4", fp],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(r.stderr[:200])
            return True
        except Exception as e:
            print(f"  FAIL {item_id}: {e}")
            return False
        finally:
            if os.path.exists(mp3):
                os.remove(mp3)

async def main_async(voice, workers):
    items = collect_items()
    os.makedirs(AUDIO_DIR, exist_ok=True)
    sem = asyncio.Semaphore(workers)
    ok = fail = 0
    tasks = [synth_one(i, p, t, voice, sem) for i, p, t in items]
    results = await asyncio.gather(*tasks)
    for (i, p, t), res in zip(items, results):
        if res: ok += 1
        else:
            fail += 1
            # fallback: silent ogg placeholder so no 404
            sys.path.insert(0, os.path.join(ROOT, "scripts"))
            from build_all import make_audio_placeholder
            make_audio_placeholder(os.path.join(CONTENT, p), seconds=1.2)
    print(f"generated: {ok} ok, {fail} failed (placeholders)")
    return fail == 0

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="ru-RU-SvetlanaNeural")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    ok = asyncio.run(main_async(args.voice, args.workers))
    sys.exit(0 if ok else 1)
