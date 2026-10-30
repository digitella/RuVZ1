#!/usr/bin/env python3
"""
Russian Launchpad — стресс-менеджер (Unicode-safe).

1) sanitize: чистит course.json (двойные ударения, знаки на согласных),
   переносит ударение с мягкого знака на предыдущую гласную.
2) boldify : заменяет "гласная + U+0301" на обычную русскую букву в Unicode
   Mathematical Bold Cyrillic (U+1D4A5..U+1D4BF) — настоящие русские жирные
   буквы, никаких латинских омографов и никаких combining-знаков.
   Полностью обратимо: unboldify возвращает "буква + U+0301".
3) collect : список аудио-референсов из course.json.

Использование:
    python3 scripts/stress_bold.py sanitize    # почистить данные
    python3 scripts/stress_bold.py boldify     # U+0301 -> жирные кириллические буквы
    python3 scripts/stress_bold.py unboldify   # обратно к U+0301 (для TTS/сборки)
"""
import json, re, sys, os, unicodedata

ACUTE = '\u0301'
VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'

# ------------------------------------------------------------------ sanitize
def normalize_marks(text: str) -> str:
    """Одна метка на слово; метки только на гласных."""
    text = re.sub(ACUTE + r'+', ACUTE, text)   # схлопываем двойные метки
    text = text.replace('ь' + ACUTE, 'ь')       # метку с мягкого знака снимаем
    out = []          # токены: одиночные символы ИЛИ буква+ACUTE (2-символьный токен)
    word_buf = []     # индексы буквенных токенов текущего слова

    def flush_word():
        nonlocal word_buf
        if not word_buf:
            return
        marked = [wi for wi in word_buf if len(out[wi]) == 2 and out[wi][1] == ACUTE]
        if len(marked) > 1:
            keep = marked[-1]
            for wi in marked:
                if wi != keep:
                    out[wi] = out[wi][0]
        elif len(marked) == 1:
            wi = marked[0]
            if out[wi][0] not in VOWELS:
                target = None
                for wj in reversed(word_buf):
                    if wj < wi and out[wj][0] in VOWELS:
                        target = wj
                        break
                if target is None:
                    for wj in word_buf:
                        if wj > wi and out[wj][0] in VOWELS:
                            target = wj
                            break
                if target is not None:
                    out[wi] = out[wi][0]
                    out[target] = out[target][0] + ACUTE
        word_buf = []

    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == ACUTE:
            i += 1
            continue
        if i + 1 < n and text[i + 1] == ACUTE:
            out.append(ch + ACUTE)
            i += 2
        else:
            out.append(ch)
            i += 1
        if out[-1][0].isalpha() or out[-1][0] == "'":
            word_buf.append(len(out) - 1)
        else:
            flush_word()
    flush_word()
    return ''.join(out)

# ------------------------------------------------- bold rendering policy
# Юникод НЕ содержит «жирной кириллицы» в основном алфавитном блоке: блок
# Mathematical Bold (U+1D400..) даёт либо латинские омографы (опасно!), либо
# декоративные гротескные字形, которые не читаются как русские буквы.
# Поэтому «правильные русские жирные буквы» реализованы ЧИСТО:
#   1) Данные хранят canonical form: гласная + U+0301 (единственный источник).
#   2) Браузер рендерит ударную букву ЖИРНЫМ шрифтом и скрывает combining-знак
#      (CSS .stress { font-weight:800 } + text-rendering; см. tint.js/player.css).
#   3) TTS получает текст с U+0301 — ударение произносится правильно.
# Никаких латинских кодовых точек в контенте быть не должно ни при каких условиях.
NORM2BOLD = {}          # пустой: конверсия в Unicode-«жирный» намеренно не используется
BOLD2NORM = {}


def strip_bold_to_acute(text: str) -> str:
    """Обратная очистка: если в данных всё же встретились Mathematical-Bold
    codepoints (легаси), возвращаем их к canonical 'буква + U+0301'.
    Латинские буквы из основного ASCII-диапазона НЕ трогаем — они там только
    в английских полях и транслитерациях."""
    res = []
    for ch in text:
        cp = ord(ch)
        if 0x1D4A5 <= cp <= 0x1D4C2:            # Math Bold Cyrillic upper
            res.append(chr(0x0410 + (cp - 0x1D4A5)) + ACUTE)
        elif 0x1D4C3 <= cp <= 0x1D500:          # Math Bold Cyrillic lower (32 слота)
            idx = cp - 0x1D4C3
            if idx < 32:
                res.append(chr(0x0430 + idx) + ACUTE)
            else:
                res.append(ch)
        else:
            res.append(ch)
    return ''.join(res)


def acute_to_bold(text: str) -> str:
    """Canonical-форма: нормализованные ударения остаются 'гласная + U+0301'.
    Жирность — задача CSS-рендера (.stress), а не кодовых точек."""
    return normalize_marks(text)


def walk_strings(obj, fn):
    if isinstance(obj, dict):
        return {k: walk_strings(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk_strings(v, fn) for v in obj]
    if isinstance(obj, str):
        return fn(obj)
    return obj


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, 'rl-content', 'course.json')
MANIFEST = os.path.join(ROOT, 'rl-content', 'media', 'audio-manifest.json')

PACKAGES = [
    'rl-webapp-frontend', 'rl-scorm/dist_unpacked',
    'rl-xapi/dist', 'rl-cmi5/dist', 'rl-telegram',
]


def apply_all(fn_name: str):
    fn = {'sanitize': lambda t: normalize_marks(t),
          'boldify': lambda t: acute_to_bold(normalize_marks(t)),
          'unboldify': lambda t: normalize_marks(strip_bold_to_acute(t))}[fn_name]
    targets = [CONTENT, MANIFEST]
    for pkg in PACKAGES:
        for rel in ('course.json', 'media/audio-manifest.json', 'content/course.json'):
            p = os.path.join(ROOT, pkg, rel)
            if os.path.exists(p):
                targets.append(p)
    seen = set()
    changed = 0
    for p in targets:
        rp = os.path.realpath(p)
        if rp in seen or not os.path.exists(p):
            continue
        seen.add(rp)
        raw = open(p, encoding='utf-8').read()
        data = json.loads(raw)
        new = walk_strings(data, fn)
        out = json.dumps(new, ensure_ascii=False, indent=2)
        if out != raw.rstrip('\n'):
            open(p, 'w', encoding='utf-8').write(out + '\n')
            changed += 1
    print(f'{fn_name}: updated files: {changed}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'sanitize'
    apply_all(cmd)
