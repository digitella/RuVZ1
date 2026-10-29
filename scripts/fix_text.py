#!/usr/bin/env python3
"""Final text cleanup for lessons_data.py / lessons_extra.py:
- latin homoglyphs (plain and accented) inside Russian words -> Cyrillic (+ U+0301 if accented)
- double stress marks within a word -> keep the first
- common ё typos (течëт etc.)
"""
import re, sys

S = '\u0301'
HM = {'a':'а','c':'с','e':'е','o':'о','p':'р','x':'х','y':'у',
      'A':'А','B':'В','C':'С','E':'Е','H':'Н','K':'К','M':'М','N':'Н',
      'O':'О','P':'Р','T':'Т','X':'Х','Y':'У'}
PRE = {'á':'а'+S,'ó':'о'+S,'é':'е'+S,'í':'и'+S,'ú':'у'+S,
       'à':'а'+S,'è':'е'+S,'ò':'о'+S,'ù':'у'+S,
       'Á':'А'+S,'Ó':'О'+S,'É':'Е'+S,'Í':'И'+S,'Ú':'У'+S,
       'Ñ':'Н','ñ':'н','â':'а','ê':'е','î':'и','ô':'о','û':'у'}
ACC_CHARS = ''.join(PRE.keys())

def clean(text):
    # 1. latin letter glued with combining acute -> cyrillic + acute
    text = re.sub(r'[a-zA-Z]\u0301', lambda m: HM.get(m.group(0)[0], m.group(0)[0]) + S, text)
    # 2. accented latin letters anywhere (they are always typos in this corpus)
    text = re.sub('[' + ACC_CHARS + ']', lambda m: PRE[m.group(0)], text)
    # 3. plain latin homoglyphs sandwiched between cyrillic letters
    for _ in range(4):
        text = re.sub(r'(?<=[а-яё])([acopxyABCEHKMNPTXY])(?=[а-яё])',
                      lambda m: HM.get(m.group(1), m.group(1)), text)
    # 4. double stress within one token: keep only the first mark
    def dedup(m):
        tok = m.group(0)
        n = tok.count(S)
        if n > 1:
            first = tok.index(S)
            tok = tok[:first+1] + tok[first+1:].replace(S, '')
        return tok
    text = re.sub(r'\S*\u0301\S*', dedup, text)
    # 5. ё typo fixes
    text = text.replace('течëт', 'течёт').replace('течет ', 'течёт ')
    return text

if __name__ == '__main__':
    for fn in ['scripts/lessons_extra.py', 'scripts/lessons_data.py']:
        t = open(fn, encoding='utf-8').read()
        open(fn, 'w', encoding='utf-8').write(clean(t))
        print('cleaned', fn)
