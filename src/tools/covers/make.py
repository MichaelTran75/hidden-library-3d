"""Book covers for the books that leave the shelf: the original English editions' covers from Open Library
(openlibrary.org; the covers are their publishers'), fetched by cover id (no rate limit that way), resized to fit
300 x 450 px and saved as WebP in src/covers/<slug>.webp. The slugs are the ones ui/book-data.js names (cover: '...').
    python3 make.py <dir for the downloads>          (downloads, then writes ../../covers/*.webp)
Chosen 14/10/2026: the most-edition work's cover (Open Library search), except where that was a translation, a large-
print or an abridged edition (then an English edition's: A Brief History of Time, Think Again, Poor Charlie's)."""
import os, sys, time, urllib.request
from PIL import Image
COVERS = {   # slug: Open Library cover id
  '80-20-principle': 241591, 'damn-right': 302474, 'paths-to-wealth': 1239919, 'money-masters': 684239,
  'innovators-dilemma': 9274687, 'poor-charlies-almanack': 14315500, 'encouragement-of-learning': 9042679,
  'motivation-and-personality': 25771, 'predictably-irrational': 2314080, 'quirkology': 10146110,
  'think-like-a-freak': 10309170, 'when-to-rob-a-bank': 8462173, 'laws-of-human-nature': 10170095,
  'psychology-of-money': 10389354, 'think-again': 10470268, 'guns-germs-and-steel': 7884018,
  'wealth-and-poverty-of-nations': 247065, 'prisoners-of-geography': 8900233, 'rise-and-fall-of-nations': 8876132,
  'blind-watchmaker': 95763, 'brief-history-of-time': 7888152, 'deep-simplicity': 746400,
}
# two covers Open Library lacks, from where the book is published or catalogued (15/10/2026): The Nvidia Way from its
# publisher W. W. Norton, Trò chơi quyền lực (Omega+, 2024; ISBN 978-604-392-480-0) from its Goodreads record
URLS = {
  'nvidia-way': 'https://cdn2.wwnorton.com/wwnproducts/TRADE/0/1/9781324086710/9781324086710_300.jpg',
  'power-game': 'https://m.media-amazon.com/images/S/compressed.photo.goodreads.com/books/1738583097i/225931052.jpg',
}
raw = sys.argv[1]; out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'covers'); os.makedirs(out, exist_ok=True)
for slug, cid in list(COVERS.items()) + list(URLS.items()):
    src = os.path.join(raw, ('%d.jpg' % cid) if isinstance(cid, int) else slug + '.jpg')
    if not os.path.exists(src):
        req = urllib.request.Request(('https://covers.openlibrary.org/b/id/%d-L.jpg' % cid) if isinstance(cid, int) else cid, headers={'User-Agent': 'Mozilla/5.0 (HiddenLibrary3D)'})
        open(src, 'wb').write(urllib.request.urlopen(req, timeout=30).read()); time.sleep(0.4)
    im = Image.open(src).convert('RGB'); im.thumbnail((300, 450), Image.LANCZOS)
    dst = os.path.join(out, slug + '.webp'); im.save(dst, 'WEBP', quality=80, method=6)
    print('%-32s %dx%d %5.1f KB' % (slug, *im.size, os.path.getsize(dst) / 1024))
