#!/usr/bin/env python3
"""Russian Launchpad — lesson sync.

Merges the 27 everyday-situation lessons from scripts/lessons_data.py into
rl-content/course.json (single source of truth), converting their compact
format to the full course schema used by the webapp / SCORM / xAPI / cmi5
bundles. Existing lessons (l1..l3) are REPLACED with the enriched versions
from lessons_data.py so stress marks stay consistent everywhere.

Usage:  python3 scripts/sync_lessons.py
Then:   python3 scripts/build_all.py   (regenerates all bundles + manifest)
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import lessons_data as LD  # noqa: E402
try:
    import lessons_extra as LX  # noqa: E402
except Exception:
    LX = None

CONTENT = os.path.join(ROOT, "rl-content", "course.json")

# ---------------------------------------------------------------- helpers --
VOWELS = "аеёиоуыэюя"


def clean_ru(s):
    """Remove quotation marks and stray backslashes from Russian display/TTS text.

    Quotes must never appear on screen and must never be spoken by TTS."""
    if not isinstance(s, str):
        return s
    for q in ('\u00ab', '\u00bb', '\u201c', '\u201d', '\u201e'):
        s = s.replace(q, '')
    s = s.replace('"', '').replace("'", '').replace('\u2019', '').replace('\\', '')
    return re.sub(r'\s{2,}', ' ', s).strip()

def stressed_word(w):
    """True if a Russian word already carries a combining acute (U+0301)."""
    return "\u0301" in w

def auto_stress(word):
    """Fallback: mark last vowel if a phrase needs a stress but has none.
    U+0301 itself is not a vowel, so already-marked letters are skipped."""
    idx = max((i for i, ch in enumerate(word) if ch.lower() in VOWELS), default=-1)
    if idx < 0:
        return word
    return word[:idx] + word[idx] + "\u0301" + word[idx + 1:]

def ensure_stress(text):
    """Make sure every multi-letter Russian word in text has a stress mark.
    Words already marked upstream are left untouched; unmarked ones get the
    fallback so TTS never guesses on content phrases.

    NOTE: U+0301 is a combining mark (category Mn), NOT in the Cyrillic block
    \\u0400-\\u04FF, so it must be kept in `core` when checking for an existing
    stress — otherwise stripped letters like 'а' look unmarked and get a
    second accent (пока́ -> пока́́)."""
    out_words = []
    for tok in text.split(" "):
        core = re.sub(r"[^\u0400-\u04FF\u0301]", "", tok)
        if len(re.sub(r"\u0301", "", core)) > 1 and not stressed_word(core):
            fixed_core = auto_stress(core)
            tok = tok.replace(core, fixed_core, 1)
        out_words.append(tok)
    return " ".join(out_words)

def num_id(prefix, lesson_order, n):
    return f"{prefix}{lesson_order}{n:02d}"

# ------------------------------------------------------------- conversion --
def convert_lesson(l, order):
    lid = l["id"]
    # unique numeric base per lesson ORDER (not digits in id): 'l1b' and 'l1'
    # must not collide on audio ids p101 vs p101.
    base = order

    dialogue = {
        "id": f"d{base}",
        "title": l.get("situation", l["title"]),
        "lines": [
            {"speaker": sp, "ru": clean_ru(ru), "en": en, "hint": ""}
            for (sp, ru, en) in l["dialogue"]
        ],
    }

    gloss_terms = {t[0].strip().lower() for t in l.get("glossary", []) if isinstance(t, (list, tuple)) and t}
    vocabulary = [
        {"id": num_id("v", base, i + 1), "ru": clean_ru(ensure_stress(ru)), "en": en,
         "pos": "word", "hint": "",
         "immigration": ru.strip().lower() in gloss_terms}
        for i, (ru, en) in enumerate(l["vocab"])
    ]

    grammar = [
        {"id": f"g{base}{chr(97 + i)}", "title": t, "summary": s,
         "examples": [{"ru": ex, "en": ""}], "conjugation": None}
        for i, (t, s, ex) in enumerate(l["grammar"])
    ]

    pronunciation = []
    for i, p3 in enumerate([tuple(p) + ("",) * (3 - len(p)) for p in l["pron"]]):
        ru, en, hint = p3[:3]
        pid = num_id("p", base, i + 1)
        pronunciation.append({
            "id": pid, "ru": clean_ru(ensure_stress(ru)), "en": en, "ipa": "",
            "hint": hint, "audio": f"media/audio/{pid}.ogg",
        })

    speechBlanks = []
    for i, (sent, answer, transcript, en, hint) in enumerate(l["blanks"]):
        sid = num_id("s", base, i + 1)
        speechBlanks.append({
            "id": sid, "sentence_ru": clean_ru(sent), "answer": answer,
            "transcript": clean_ru(ensure_stress(transcript)), "en": en, "hint": hint,
            "audio": f"media/audio/{sid}.ogg",
        })

    quiz = [
        {"id": num_id("q", base, i + 1), "question": q, "options": opts.split("|"),
         "correct": c, "explain": e}
        for i, (q, opts, c, e) in enumerate(l["quiz"])
    ]

    return {
        "id": lid,
        "order": order,
        "situation": l.get("situation", ""),
        "title": l["title"],
        "titleRu": l.get("title_ru", ""),
        "objectives": l["objectives"],
        "dialogue": dialogue,
        "vocabulary": vocabulary,
        "grammar": grammar,
        "pronunciation": pronunciation,
        "speechBlanks": speechBlanks,
        "quiz": quiz,
        "immigrationGlossary": l.get("glossary", []) or [],
    }

# ------------------------------------------------------------------- main --
def main():
    with open(CONTENT, encoding="utf-8") as f:
        course = json.load(f)

    old_ids = {l["id"] for l in course["lessons"]}
    converted = {}
    for i, l in enumerate(LD.LESSONS, start=1):
        cl = convert_lesson(l, i)
        converted[cl["id"]] = cl

    all_src = list(LD.LESSONS) + (list(LX.LESSONS_EXTRA) if LX else [])
    converted_all = dict(converted)
    order = len(LD.LESSONS)
    for l in (LX.LESSONS_EXTRA if LX else []):
        order += 1
        converted_all[l["id"]] = convert_lesson(l, order)

    merged = []
    replaced = 0
    for i, l in enumerate(all_src, start=1):
        merged.append(converted_all[l["id"]])
    seen_ids = {l["id"] for l in merged}
    existing_by_id = {l["id"]: l for l in course["lessons"]}
    # keep any legacy lesson ids that lessons_data/lessons_extra don't cover
    # (append after). Skip ids already present to avoid duplicate lessons.
    extra_order = len(merged)
    for lid, l in existing_by_id.items():
        if lid not in converted and lid not in seen_ids:
            extra_order += 1
            l["order"] = extra_order
            merged.append(l)
            replaced += 1
            seen_ids.add(lid)

    course["lessons"] = merged
    course["version"] = "2.1.0"

    # Sanitize pass (single source of truth hygiene): collapse double stress
    # marks, move marks off consonants, convert any legacy Mathematical-Bold
    # codepoints back to canonical 'vowel + U+0301'. No Latin homoglyphs may
    # ever reach the bundles; bold rendering is done in CSS (.stress), not by
    # swapping Unicode codepoints.
    import stress_bold as _sb
    course = _sb.walk_strings(course, lambda t: _sb.normalize_marks(_sb.strip_bold_to_acute(t)))

    with open(CONTENT, "w", encoding="utf-8") as f:
        json.dump(course, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total_audio = sum(len(l["pronunciation"]) + len(l["speechBlanks"]) for l in merged)
    print(f"synced lessons: {len(merged)} (legacy kept: {replaced})")
    print(f"audio slots referenced: {total_audio}")
    print("now run:  python3 scripts/build_all.py")

if __name__ == "__main__":
    main()
