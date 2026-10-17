# summaries/books.json from part1..part5.py: each book's overview and parts, in English and Vietnamese, checked
# against the page's books (lib3d/ui/book-data.js: a book's English title is its key)
#   python3 make.py
import importlib.util, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.normpath(os.path.join(HERE, '..', '..'))
books = {}
for k in range(1, 6):
    spec = importlib.util.spec_from_file_location(f'part{k}', os.path.join(HERE, f'part{k}.py')); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for t, b in m.BOOKS.items():
        assert t not in books, 'twice: ' + t
        for lang in ('en', 'vi'):
            s = b[lang]; assert s['over'].strip() and s['ch'], (t, lang)
            for c in s['ch']: assert len(c) == 3 and all(x.strip() for x in c), (t, lang, c[:1])
        assert len(b['en']['ch']) == len(b['vi']['ch']), ('parts differ', t)
        books[t] = {lang: {'over': b[lang]['over'].strip(), 'ch': [[x.strip() for x in c] for c in b[lang]['ch']]} for lang in ('en', 'vi')}
data = open(os.path.join(SRC, 'lib3d', 'ui', 'book-data.js'), encoding='utf-8').read()
known = set(re.findall(r"en: '((?:[^'\\]|\\.)*)'", data)) | set(re.findall(r'en: "((?:[^"\\]|\\.)*)"', data))
known = {k.replace("\\'", "'") for k in known}
missing = [t for t in books if t not in known]
assert not missing, 'not in book-data.js: ' + ', '.join(missing)
out = os.path.join(SRC, 'summaries', 'books.json'); os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(books, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
words = {lang: sum(len((b[lang]['over'] + ' ' + ' '.join(c[2] for c in b[lang]['ch'])).split()) for b in books.values()) for lang in ('en', 'vi')}
print(len(books), 'books ->', out, os.path.getsize(out) // 1024, 'KB; words', words)
print('without a summary:', sorted(k for k in known if k not in books))
