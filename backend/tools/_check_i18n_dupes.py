# Duplicate-key check for the flat ar_strings dictionary in i18n.ts.
# A TS object literal silently keeps the LAST duplicate, so tsc/vite never
# flag them — this script does. Run: python tools\_check_i18n_dupes.py
import io, os, re, collections, sys

path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), 'frontend', 'src', 'i18n.ts')
s = io.open(path, encoding='utf-8').read()
body = s[s.index('const ar_strings'):s.index('i18n.use(')]
keys = re.findall(r"^\s*'((?:[^'\\]|\\.)*)'\s*:", body, re.M)
c = collections.Counter(keys)
dupes = sorted(k for k, v in c.items() if v > 1)
print('total keys:', len(keys))
print('duplicates:', dupes if dupes else 'NONE')
sys.exit(1 if dupes else 0)
