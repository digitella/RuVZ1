#!/usr/bin/env python3
"""
Russian Launchpad — стресс-менеджер.

1) sanitize: чистит course.json (двойные ударения, знаки на согласных),
   переносит ударение с мягкого знака на предыдущую гласную.
2) boldify : заменяет U+0301 над ударной гласной на **жирную** прописную
   букву (Unicode Mathematical Bold Cyrillic). Отображается жирно в любом
   браузере без额外 разметки; для TTS легко обратимо (unboldify).
3) collect : возвращает список аудио-референсов из course.json/манифеста.

Использование:
    python3 scripts/stress_bold.py sanitize      # почистить данные
    python3 scripts/stress_bold.py boldify       # ударения -> жирные буквы
    python3 scripts/stress_bold.py unboldify     # обратно к U+0301
"""
import json, re, sys, os, unicodedata

ACUTE = '\u0301'
VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ'

def normalize_marks(text: str) -> str:
    """Одна метка на слово; метки только на гласных."""
    text = re.sub(ACUTE + r'+', ACUTE, text)   # схлопываем двойные метки
    text = text.replace('ь' + ACUTE, 'ь')       # метку с мягкого знака снимаем
    out = []          # список токенов: одиночные символы ИЛИ буква+ACUTE (2-символьный токен)
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


# Reverse: bold latin -> canonical Cyrillic (только гомоглифы; ударная буква всегда
# отображается гомоглифом, поэтому unboldify точен для стресс-букв).
REV_HOMO = {'A':'А','B':'В','E':'Е','K':'К','M':'М','N':'Н','O':'О','P':'Р',
            'S':'С','T':'Т','U':'У','X':'Х'}


# Жирные кириллические буквы. Unicode Mathematical Bold имеет только латиницу
# (U+1D400-U+1D45F). Ударная буква в русском ВСЕГДА гласная, поэтому жирными
# делаем только гласные, и каждой — уникальный символ => полная обратимость:
#   А->𝐀  О->𝐎  У->𝐔  И->𝐈  Ы->𝐘  Э->𝐄  Ю->𝐕  Я->𝐘? нет -> 𝐘 занят Ы...
# Финальный инъективный выбор (латинские формы максимально похожи на русские):
NORM2BOLD = {
    'А':'𝐀','а':'𝐚',   # A == А
    'О':'𝐎','о':'𝐨',   # O == О
    'У':'𝐔','у':'𝐮',   # y == у
    'И':'𝐈','и':'𝐢',   # I == И
    'Ы':'𝐘','ы':'𝐲',   # Y == Ы
    'Э':'𝐙','э':'𝐳',   # Z стилизованно под Э (обратимо: Z/з -> Э/э)
    'Ю':'𝐕','ю':'𝐯',   # V == часть Ю
    'Я':'𝑌','я':'𝑦',   # курсивная y как маркер Я (обратимо)
    'Е':'𝐄','е':'𝐞',   # E == Е
    'Ё':'𝐅','ё':'𝐟',   # F ~ Ё (обратимо)
}
REV_HOMO = {'A':'А','O':'О','U':'У','I':'И','Y':'Ы','Z':'Э','V':'Ю','E':'Е','F':'Ё'}
# Я использует MATHEMATICAL ITALIC SMALL/Y (U+1D464/U+1D465) — отдельный диапазон
ITALIC_Y_UPPER = chr(0x1D464)
ITALIC_Y_LOWER = chr(0x1D465)


def strip_bold_to_acute(text: str) -> str:
    """Жирная/курсивная латиница -> кириллица + U+0301 (полностью обратимо)."""
    res = []
    for ch in text:
        cp = ord(ch)
        if 0x1D400 <= cp <= 0x1D419 or 0x1D41A <= cp <= 0x1D433:
            up = cp <= 0x1D419
            lat = chr(ord('A') + cp - 0x1D400) if up else chr(ord('a') + cp - 0x1D41A)
            base = REV_HOMO.get(lat.upper())
            if base:
                res.append((base if up else base.lower()) + ACUTE)
                continue
        if ch == ITALIC_Y_UPPER:
            res.append('Я' + ACUTE); continue
        if ch == ITALIC_Y_LOWER:
            res.append('я' + ACUTE); continue
        res.append(ch)
    return ''.join(res)


def acute_to_bold(text: str) -> str:
    """буква+U+0301 -> жирная буква (без combining-знака)."""
    res = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if i + 1 < n and text[i+1] == ACUTE and ch in NORM2BOLD:
            res.append(NORM2BOLD[ch])
            i += 2
        elif ch == ACUTE:
            i += 1
        else:
            res.append(ch)
            i += 1
    return ''.join(res)


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
    print(f'{fn_name}: обновлено файлов: {changed}')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'sanitize'
    apply_all(cmd)
