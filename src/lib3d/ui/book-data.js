import './library.js';   // build order: the module before this one runs first

/* ---- the page's books in both languages, with their page counts
   The page lists its books under their Vietnamese titles (a few under their English ones). Here each also has its
   original English title (a Vietnamese book: a translation), its author and year where the page gives none, and its
   page count: the median over the work's editions on Open Library (looked up 13/10/2026), else the publisher's or a
   bookseller's listing. The spines, covers and the card follow the page's language switch; a book's thickness
   follows its pages (see spineOf), so a long book stands out on the shelf as it would. A book the page adds later
   and this table lacks keeps the page's title and the shelf book it was given. */
const BOOK_INFO = [
  // the title as the page has it, the English title (and the full one), author · year when the page lacks them, pages
  // (t: a thickness in metres where there are no pages to go by; h: a height, for a book of a larger format; cover:
  // its cover image, see BOOK_COVERS)
  { page: 'Nguyên lý Pareto: 80/20', en: 'The 80/20 Principle', full: 'The 80/20 Principle: The Secret to Achieving More with Less', by: 'Richard Koch · 1997', pages: 283, cover: '80-20-principle' },
  { page: 'Lịch Sử Mô Hình DISC. Từ Lý Thuyết Đến Ứng Dụng', en: 'The DISC Model: From Theory to Practice', pages: null, t: 0.012 },   // a talk: no printed edition found; a slim booklet
  { page: '"Damn Right!" Bí Ẩn Charlie Munger', en: 'Damn Right!', full: 'Damn Right! Behind the Scenes with Berkshire Hathaway Billionaire Charlie Munger', pages: 304, cover: 'damn-right' },
  { page: 'Paths to Wealth Through Common Stocks', en: 'Paths to Wealth Through Common Stocks', pages: 214, cover: 'paths-to-wealth' },
  { page: 'Money Masters of Our Time', en: 'Money Masters of Our Time', pages: 400, cover: 'money-masters' },
  { page: "The Innovator's Dilemma", en: "The Innovator's Dilemma", full: "The Innovator's Dilemma: When New Technologies Cause Great Firms to Fail", pages: 286, cover: 'innovators-dilemma' },
  { page: 'Phong cách NVIDIA: Chiến lược và Văn hóa dẫn đầu AI', en: 'The Nvidia Way', full: 'The Nvidia Way: Jensen Huang and the Making of a Tech Giant', by: 'Tae Kim · 2024', pages: 272, cover: 'nvidia-way' },   // W. W. Norton
  { page: 'A. Charlie Munger: Poor Charlie’s Almanack Tư Duy Đa Chiều', en: "Poor Charlie's Almanack", full: "Poor Charlie's Almanack: The Wit and Wisdom of Charles T. Munger", by: 'Charles T. Munger, ed. Peter D. Kaufman · 2005', pages: 512, h: 0.31, cover: 'poor-charlies-almanack' },   // a large-format book
  { page: 'Khuyến Học', en: 'An Encouragement of Learning', pages: 192, cover: 'encouragement-of-learning' },   // Fukuzawa's Gakumon no susume, tr. David A. Dilworth
  { page: 'Động lực và Nhân cách', en: 'Motivation and Personality', pages: 400, cover: 'motivation-and-personality' },
  { page: 'Phi Lý Trí', en: 'Predictably Irrational', full: 'Predictably Irrational: The Hidden Forces That Shape Our Decisions', pages: 368, cover: 'predictably-irrational' },
  { page: 'Tâm lý học Hài hước', en: 'Quirkology', full: 'Quirkology: How We Discover the Big Truths in Small Things', pages: 322, cover: 'quirkology' },
  { page: 'Tư duy như một kẻ lập dị', en: 'Think Like a Freak', pages: 274, cover: 'think-like-a-freak' },
  { page: 'Khi nào cướp nhà băng', en: 'When to Rob a Bank', full: 'When to Rob a Bank: …And 131 More Warped Suggestions and Well-Intended Rants', pages: 400, cover: 'when-to-rob-a-bank' },
  { page: 'Quy Luật Bản Chất Con Người', en: 'The Laws of Human Nature', pages: 617, cover: 'laws-of-human-nature' },
  { page: 'Tâm lý học về tiền', en: 'The Psychology of Money', full: 'The Psychology of Money: Timeless Lessons on Wealth, Greed, and Happiness', pages: 288, cover: 'psychology-of-money' },
  { page: 'Think Again', en: 'Think Again', full: "Think Again: The Power of Knowing What You Don't Know", pages: 320, cover: 'think-again' },
  // a heading on the page with the page's notes on five economies under it: a book of them, read in the room (ui/leaves.js:
  // G, 17/10/2026), of a reference book's format
  { page: '[Mô hình kinh tế]', en: '[Economic models]', pages: null, read: true, t: 0.028, h: 0.275, d: 0.18 },
  { page: 'Súng, Vi Trùng và Thép', en: 'Guns, Germs, and Steel', full: 'Guns, Germs, and Steel: The Fates of Human Societies', pages: 528, cover: 'guns-germs-and-steel' },
  { page: 'Sự giàu có và nghèo đói của các Quốc gia', en: 'The Wealth and Poverty of Nations', full: 'The Wealth and Poverty of Nations: Why Some Are So Rich and Some So Poor', pages: 650, cover: 'wealth-and-poverty-of-nations' },
  { page: 'Những Tù Nhân Của Địa Lý', en: 'Prisoners of Geography', full: 'Prisoners of Geography: Ten Maps That Explain Everything About the World', pages: 291, cover: 'prisoners-of-geography' },
  { page: 'Quốc Gia Thăng Trầm', en: 'The Rise and Fall of Nations', full: 'The Rise and Fall of Nations: Forces of Change in the Post-Crisis World', pages: 466, cover: 'rise-and-fall-of-nations' },
  { page: 'Trò chơi quyền lực', en: 'The Power Game', full: 'The Power Game: The Past, Present and Future of the World Order', pages: 370, cover: 'power-game' },   // Omega+ 2024 (no English edition)
  { page: 'Người thợ đồng hồ mù', en: 'The Blind Watchmaker', pages: 368, cover: 'blind-watchmaker' },
  { page: 'Lược Sử Thời Gian', en: 'A Brief History of Time', pages: 241, cover: 'brief-history-of-time' },
  { page: 'Deep Simplicity', en: 'Deep Simplicity', full: 'Deep Simplicity: Bringing Order to Chaos and Complexity', pages: 304, cover: 'deep-simplicity' },
  // the Geography topic's two pages, as atlases of one format: taken out, one opens on its map (ui/atlas.js), and the
  // map leads to the page (G, 16/10/2026)
  { page: 'Việt Nam', en: 'Vietnam', map: 'vn', t: 0.034, h: 0.3 },
  { page: 'Phú Quốc', en: 'Phú Quốc', map: 'phuquoc', t: 0.034, h: 0.3 },
];
const isMapItem = it => { const b = bookInfo(it); return !!(b && b.map && it.href); };
// a book of the page's notes (its chips open dialogs): taken out, it opens on its contents and its leaves turn (ui/leaves.js)
const isReadItem = it => { const b = bookInfo(it); return !!(b && b.read && it.chips && it.chips.some(c => c.el && c.el.dataset && c.el.dataset.dialog)); };
const opensFlat = it => isMapItem(it) || isReadItem(it);   // (taken out, it opens in front of the camera)
const bookKey = s => String(s || '').normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
const BOOK_BY_TITLE = new Map(BOOK_INFO.map(b => [bookKey(b.page), b]));
const bookInfo = it => (it && BOOK_BY_TITLE.get(bookKey(it.title))) || null;
const pageLang = () => document.documentElement.getAttribute('data-lang') === 'vi' ? 'vi' : 'en';
// the title in a language: Vietnamese as the page writes it, English from the table (else the page's)
const titleIn = (it, lang = pageLang()) => { const b = bookInfo(it); return lang === 'en' && b ? b.en : it.title; };
// as printed on a spine, a cover or a title page: without the brackets the page marks a heading with
const printTitle = (it, lang) => titleIn(it, lang).replace(/^\[(.+)\]$/, '$1');
// the page's author · year, or the table's where the page has none (or only the year)
const byOf = it => { const b = bookInfo(it); return b && b.by && (!it.by || /^\d{3,4}$/.test(it.by.trim())) ? b.by : it.by || ''; };
// a book's cover, where there is one: the original English edition's, from Open Library (The Nvidia Way's from its
// publisher, Trò chơi quyền lực's, the Vietnamese edition's, from Goodreads; tools/covers/make.py; the covers are their
// publishers'). The page carries where each is (#book-covers: a file next to the page on GitHub Pages,
// the image itself in the one-file build)
const BOOK_COVERS = (() => { try { return JSON.parse(document.getElementById('book-covers').textContent); } catch (e) { return {}; } })();
const coverOf = it => { const b = bookInfo(it); return (b && b.cover && BOOK_COVERS[b.cover]) || null; };
// the cover pictures' shapes (width over height, of src/covers): a book with a cover is made the shape of its cover (the
// board as wide as the picture is for the book's height), so the picture covers its board (G, 17/10/2026)
const COVER_AR = { '80-20-principle': 0.66, 'blind-watchmaker': 0.647, 'brief-history-of-time': 0.653, 'damn-right': 0.676, 'deep-simplicity': 0.662, 'encouragement-of-learning': 0.674, 'guns-germs-and-steel': 0.633, 'innovators-dilemma': 0.658, 'laws-of-human-nature': 0.662, 'money-masters': 0.651, 'motivation-and-personality': 0.629, 'nvidia-way': 0.66, 'paths-to-wealth': 0.649, 'poor-charlies-almanack': 0.968, 'power-game': 0.671, 'predictably-irrational': 0.658, 'prisoners-of-geography': 0.667, 'psychology-of-money': 0.638, 'quirkology': 0.622, 'rise-and-fall-of-nations': 0.664, 'think-again': 0.662, 'think-like-a-freak': 0.616, 'wealth-and-poverty-of-nations': 0.647, 'when-to-rob-a-bank': 0.658 };
const coverAr = it => { const b = bookInfo(it); return b && b.cover && COVER_AR[b.cover] || 0; };
// a book's thickness from its pages: ~0.06 mm a page (about 420 pages to the inch, common book paper) and ~4 mm of covers
const spineOf = pages => 0.004 + pages * 0.00006;

export { BOOK_INFO, bookInfo, byOf, coverAr, coverOf, isMapItem, isReadItem, opensFlat, pageLang, printTitle, spineOf, titleIn };
