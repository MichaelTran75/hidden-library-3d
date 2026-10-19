"""Hidden Library as a 3D library (ver 01) -> one self-contained HTML.

    python3 build.py [path/to/Hidden Library.html] [--pages DIR [--dev]]

With --pages DIR it also writes DIR/index.html for GitHub Pages, with the 3D module in DIR/lib3d.js and the models in
DIR/lib.glb next to it instead of inline (a smaller page; phones fetch neither; each is cached on its own). --dev also
copies the modules to DIR/lib3d and writes DIR/dev.html, which runs them unjoined (for working on them).

Without an argument it uses the live Hidden Library file in WATCHLIST/WIX, falling back to the snapshot
src/hidden-library.base.html. The page's own markup and script are left as they are, except small patches to its
YouTube player so a YouTube record starts by itself (its record player stays in the sidebar, hidden until the deck on
the room's floor is clicked) and to its day, which runs from sunrise to sunset where the visitor is (src/sun) instead
of from 6:22 to 17:30: a capability check (which also drops the old painted backgrounds) and a style block go in
before </head>, the record-player model is copied for the 3D deck, and the three.js import map, the GLB (base64) and
the 3D module (src/lib3d/, its ES modules joined in build order: see bundle_lib3d) go in before </body>.
"""
import base64, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
pages_dir = None
if '--pages' in args:
    k = args.index('--pages'); pages_dir = os.path.abspath(args[k + 1]); del args[k:k + 2]
dev = '--dev' in args
if dev: args.remove('--dev')
sys.argv = sys.argv[:1] + args
LIVE = os.path.expanduser('~/Desktop/B. Ebook & Audio Book/⭕/Nexus Antigravity/CORE FILES (ROOT)/JADE/WATCHLIST/WIX/Hidden Library.html')
base_path = sys.argv[1] if len(sys.argv) > 1 else (LIVE if os.path.exists(LIVE) else os.path.join(HERE, 'hidden-library.base.html'))
out_path = os.path.join(os.path.dirname(HERE), 'Hidden Library 3D.html')

page = open(base_path, encoding='utf-8').read()


def bundle_lib3d():
    """The 3D library's ES modules (src/lib3d) joined into the one module the page ships.

    The build order is the chain the modules keep: main.js imports the last one, and every module's first plain import
    (`import './x.js';`) is the one built before it. The modules are joined in that order into one scope, as one file;
    their imports and exports are dropped, and three.js comes in through dynamic imports behind the capability check
    (phones never fetch it; a failed fetch leaves the page its own layout). Top-level names must therefore be unique
    across the modules: `node --check` on the result catches a clash."""
    import re, subprocess, tempfile
    root = os.path.join(HERE, 'lib3d')
    read = lambda rel: open(os.path.join(root, rel), encoding='utf-8').read()
    side = re.compile(r"^import\s+'([^']+)';", re.M)
    first = side.search(read('main.js'))
    assert first, 'main.js imports no module'
    chain, cur = [], os.path.normpath(first.group(1))
    while cur:
        assert cur not in chain, 'build order loops at ' + cur
        chain.append(cur)
        m = side.search(read(cur))
        cur = os.path.normpath(os.path.join(os.path.dirname(cur), m.group(1))) if m else None
    order = chain[::-1]
    on_disk = sorted(os.path.relpath(os.path.join(d, f), root) for d, _, fs in os.walk(root) for f in fs if f.endswith('.js') and f != 'main.js')
    missing = [f for f in on_disk if f not in order]
    assert not missing, 'modules outside the build order (import them in the chain): ' + ', '.join(missing)
    imp = re.compile(r"^import\s+(?:([^'\n]+?)\s+from\s+)?'([^']+)';[^\n]*\n?", re.M)
    ext = {}   # three.js and its addons: specifier -> names
    parts = []
    for rel in order:
        t = read(rel)
        for clause, spec in imp.findall(t):
            if clause and not spec.startswith('.'):
                names = ext.setdefault(spec, set())
                names.update(['* as THREE'] if clause.startswith('* as') else [n.strip() for n in clause.strip('{} ').split(',')])
        t = imp.sub('', t)
        t = re.sub(r"^export\s*\{[^}]*\};?[^\n]*\n?", '', t, flags=re.M)
        t = re.sub(r"^export\s+(?=(?:async\s+)?function|const|let|class)", '', t, flags=re.M)
        parts.append(t.strip('\n'))
    specs = sorted(ext, key=lambda x: (x != 'three', x))
    assert specs and specs[0] == 'three' and ext['three'] == {'* as THREE'}, 'three.js must be imported as * as THREE'
    head = ("// three.js is fetched only where the room is shown (wide screens with WebGL 2): phones never download it. If it cannot\n"
            "// be fetched (offline, a blocked CDN) the page gets lib3d-failed and keeps its own card layout.\n"
            "const LIB = innerWidth > 768 && window.WebGL2RenderingContext ? await Promise.all([\n  "
            + ', '.join(f"import('{x}')" for x in specs) + "\n"
            "]).catch(e => { console.warn('3D library unavailable', e); document.documentElement.classList.add('lib3d-failed'); return null; }) : null;\n"
            "if (LIB) {\n"
            "const [" + ', '.join('THREE' if x == 'three' else '{ ' + ', '.join(sorted(ext[x])) + ' }' for x in specs) + "] = LIB;\n")
    out = head + '\n'.join(parts) + '\n}\n'
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False, encoding='utf-8') as f:
        f.write(out)
    r = subprocess.run(['node', '--check', f.name], capture_output=True, text=True)
    os.unlink(f.name)
    assert r.returncode == 0, 'the joined module does not parse (a name declared in two modules?):\n' + r.stderr[-800:]
    print('lib3d:', len(order), 'modules joined,', round(len(out) / 1e3), 'KB')
    return out


module = bundle_lib3d()
glb = base64.b64encode(open(os.path.join(HERE, 'lib.glb'), 'rb').read()).decode()
cat_bin = base64.b64encode(open(os.path.join(HERE, 'cat.bin'), 'rb').read()).decode()   # the cat (tools/pets: rig_cat.py, pack.mjs)
hen = base64.b64encode(open(os.path.join(HERE, 'hen.glb'), 'rb').read()).decode()   # the chicken (tools/pets/pack.mjs)
clock = base64.b64encode(open(os.path.join(HERE, 'clock.glb'), 'rb').read()).decode()   # the medieval clock, its moving parts apart (tools/clock)
iss = base64.b64encode(open(os.path.join(HERE, 'iss.glb'), 'rb').read()).decode()
camglb = base64.b64encode(open(os.path.join(HERE, 'camera.glb'), 'rb').read()).decode()   # the vintage camera on the tall shelf (tools/camera)
gcover = base64.b64encode(open(os.path.join(HERE, 'garden-cover.webp'), 'rb').read()).decode()   # the 3D garden's book's cover (G's screenshot of the garden)   # the ISS over the Geography bay, one mesh and an atlas (tools/iss)
import json   # the books' covers (tools/covers/make.py): the images themselves in the one-file page, files next to it on Pages
COVER_DIR = os.path.join(HERE, 'covers'); cover_files = sorted(f for f in os.listdir(COVER_DIR) if f.endswith('.webp')) if os.path.isdir(COVER_DIR) else []
covers_inline = json.dumps({f[:-5]: 'data:image/webp;base64,' + base64.b64encode(open(os.path.join(COVER_DIR, f), 'rb').read()).decode() for f in cover_files}, separators=(',', ':'))
covers_files = json.dumps({f[:-5]: 'covers/' + f for f in cover_files}, separators=(',', ':'))
# the books' summaries, read when a book being listened to is opened (ui/leaves.js): inline in the one-file page, a file
# next to it on Pages (fetched then)
SUMS_PATH = os.path.join(HERE, 'summaries', 'books.json')
sums_json = json.dumps(json.load(open(SUMS_PATH, encoding='utf-8')) if os.path.exists(SUMS_PATH) else {}, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')

THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/'
IMPORTMAP = ('<script type="importmap">{"imports":{"three":"' + THREE_CDN + 'build/three.module.min.js",'
  + '"three/addons/":"' + THREE_CDN + 'examples/jsm/"}}</script>\n')
STYLE = IMPORTMAP + """<script>
  // wide screens with WebGL 2 get the 3D library; phones keep the page as it was (and never download three.js)
  if (window.innerWidth > 768 && window.WebGL2RenderingContext) {
    document.documentElement.classList.add('lib3d-capable', 'l3-wait');   // (l3-wait: the words over the room come in once it is all there: loop.js reveal)
    // fetch three.js (and the room's models) now, while the rest of the page loads
    ['build/three.module.min.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/libs/meshopt_decoder.module.js',
     'examples/jsm/lights/RectAreaLightUniformsLib.js', 'examples/jsm/lights/RectAreaLightTexturesLib.js',
     'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/postprocessing/Pass.js'].forEach(function (u) {
      var l = document.createElement('link'); l.rel = 'modulepreload'; l.href = '""" + THREE_CDN + """' + u; document.head.appendChild(l);
    });
    /*GLB_PRELOAD*/
  }
  // the room replaces the painted backgrounds: drop them before anything paints, so they are never downloaded
  (function () {
    var s = document.documentElement.style;
    for (var i = s.length - 1; i >= 0; i--) if (s[i].indexOf('--bg-') === 0) s.removeProperty(s[i]);
    window.__hlSetBg = function () {};
  })();
</script>
<style id="lib3d-style">
  /* ---- the accent: black by day, the page's beige by night, where it was blue (G, 17/10/2026: "trong light theme: em
     thay tất cả màu xanh dương thành màu đen, dark theme thì xanh thành màu #E2D6C0"), on every screen; what stands on
     it (words, icons) turns dark by night. The day/night switch keeps its sky. */
  :root { --accent: #000; --accent-rgb: 0, 0, 0; --accent-hover: #3a3a3a; --on-accent: #E2D6C0; --on-accent-rgb: 226, 214, 192; }
  body.dark-mode { --accent: #E2D6C0; --accent-rgb: 226, 214, 192; --accent-hover: #efe6d5; --on-accent: #1d1913; --on-accent-rgb: 29, 25, 19;
    --chip-hover: rgba(var(--accent-rgb), .38); }
  body.dark-mode .chip:hover { border-color: rgba(var(--accent-rgb), .6); }
  .lang-switch button[aria-pressed="true"], .subtab[aria-current="page"], .np .np-play { color: var(--on-accent); }
  .np .np-play:hover { background: var(--accent-hover); }
  /* the sky clock's moon as it is seen where the visitor is: turned over south of the equator (src/sun: html.hl-south) */
  html.hl-south .sky .moon img { transform: rotate(180deg); }
  /* by day the sky clock in the sun's yellow, its words edged in black (G, 18/10/2026: "đưa về màu vàng với black
     border"; the lines yellow too, but plain) */
  .sky:not(.is-night) { --sky-y: #ffd21f; --sky-edge: 0 0 1px #000, 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 0 0 3px rgba(0, 0, 0, .55); color: var(--sky-y); }
  .sky:not(.is-night) .orb-time, .sky:not(.is-night) .mk, .sky:not(.is-night) .sky-labels, .sky:not(.is-night) .sky-label, .sky:not(.is-night) .wx { color: var(--sky-y); text-shadow: var(--sky-edge); opacity: 1; }
  .sky:not(.is-night) .wx svg { filter: drop-shadow(1px 0 0 #000) drop-shadow(-1px 0 0 #000) drop-shadow(0 1px 0 #000) drop-shadow(0 -1px 0 #000); }
  .sky:not(.is-night) .sky-arc path { stroke: var(--sky-y); opacity: 1; }   /* (the lines yellow, without the edge: only the words have it) */
  .sky:not(.is-night) .ruler { background: var(--sky-y); }
  .sky:not(.is-night) .drop { background: repeating-linear-gradient(to bottom, var(--sky-y) 0 3px, transparent 3px 6px); }
  .sky:not(.is-night) .tick { background: var(--sky-y); box-shadow: 0 0 5px var(--sky-y); }
  /* ---- 3D library: the room is the interface on wide screens (the old cards stay in the DOM, hidden) */
  #lib3d { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; display: block; opacity: 0; transition: opacity 1.6s var(--ease); touch-action: none; }
  body.lib3d-on #lib3d { opacity: 1; }
  body::before, body::after { content: none !important; }   /* no painted background any more */
  #off-toggle { display: none !important; }                    /* no OFF (minimal) mode in this version */
  @media (min-width: 769px) {
    body.dark-mode { background: #10151e; }
    html.lib3d-capable:not(.lib3d-failed) .page .cats, html.lib3d-capable:not(.lib3d-failed) .page .page-head,
    html.lib3d-capable:not(.lib3d-failed) .page .footer { display: none !important; }
    html.lib3d-capable:not(.lib3d-failed) .pages { pointer-events: none; }
    html.lib3d-capable:not(.lib3d-failed) .sky a, html.lib3d-capable:not(.lib3d-failed) .sky button { pointer-events: auto; }
    /* the sky clock and its weather line on the room's middle: over the bulb that hangs above the sofa (G, 17/10/2026:
       "align the clock to the middle", a line from the bulb up through the clock), not the middle of the page beside the
       sidebar. The room's first view is its painting cropped like a cover, and the bulb stands 39.92 of the painting's
       pixels right of its middle (1562 × 2000: lib3d/core/views.js homeView; measured): on the window at 50vw plus
       max(2.556vw, 1.996vh). The page the clock sits in is centred at 50vw + sidebar / 2. On a narrow window it stops
       clear of the sidebar. (Moving the bulb, world/furnish.js, moves this.) */
    html.lib3d-capable:not(.lib3d-failed) .page .sky { left: calc(max(50vw + max(2.556vw, 1.996vh), var(--sidebar-w) + 16px + min(21vw, 210px)) - 50vw - var(--sidebar-w) / 2); }
    /* the now-playing bar (an audiobook) half see-through over the room, by day and by night (G, 17/10/2026: "make
       background 50% transparent"; it was 0.96 and 0.93). Phones and the page without the room keep it as it was: the
       page's own words would show through it there. */
    html.lib3d-capable:not(.lib3d-failed) .np { background: rgba(226, 214, 192, .5); }
    html.lib3d-capable:not(.lib3d-failed) body.dark-mode .np { background: rgba(16, 13, 10, .5); }
    /* the sidebar floats on the room: no panel, a soft halo keeps the words readable */
    html.lib3d-capable:not(.lib3d-failed) .toc { background: none; border-right-color: transparent; text-shadow: var(--halo); --ink-soft: rgba(0, 0, 0, .8); }
    html.lib3d-capable:not(.lib3d-failed) body.dark-mode .toc { --ink-soft: rgba(226, 214, 192, .84); }
    /* the page's record player waits in the left corner until the deck on the room's floor is clicked */
    html.lib3d-capable:not(.lib3d-failed) body:not(.l3-player-open) .dock .player { position: absolute; left: 22px; bottom: 14px; width: calc(var(--sidebar-w) - 44px);
      visibility: hidden; opacity: 0; pointer-events: none; }   /* out of the way but laid out, so its deck is drawn and ready */
    html.lib3d-capable:not(.lib3d-failed) body:not(.l3-player-open) .dock { border-top-color: transparent; padding-top: 0; }
    html.lib3d-capable:not(.lib3d-failed) body.l3-player-open .dock .player { animation: l3player-in .45s var(--ease) both; transform-origin: 30% 100%; }
    html.lib3d-capable:not(.lib3d-failed) body.l3-player-closing .dock .player { animation: l3player-out .28s ease-in both; }
  }
  @keyframes l3player-in { from { opacity: 0; transform: translateY(18px) scale(.94); } to { opacity: 1; transform: none; } }
  @keyframes l3player-out { to { opacity: 0; transform: translateY(12px) scale(.96); } }
  @media (max-width: 768px) { #lib3d, #l3-ui, #lib3d-loader { display: none !important; } }
  #lib3d-loader { position: fixed; left: 50%; bottom: 30px; width: 160px; height: 3px; margin-left: -80px; border-radius: 2px; background: rgba(60, 45, 25, .15); overflow: hidden; z-index: 6; display: none; }
  #lib3d-loader i { position: absolute; top: 0; bottom: 0; width: 38%; background: #8a6a40; border-radius: 2px; animation: l3load 1.3s ease-in-out infinite; }
  @keyframes l3load { from { left: -40%; } to { left: 100%; } }
  html.lib3d-capable:not(.lib3d-failed) body:not(.lib3d-on) #lib3d-loader { display: block; }

  /* ---- the medieval clock out of its shelf (clock.js): its panel and the names of its parts */
  .ck-out-ui { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .35s ease; }
  .ck-out-ui.is-on { opacity: 1; }
  .ck-head { position: absolute; top: 18px; left: calc(var(--sidebar-w) + (100vw - var(--sidebar-w)) / 2); transform: translateX(-50%); display: flex; align-items: center; gap: 12px;
    padding: 8px 10px 8px 16px; border-radius: 999px; background: rgba(226, 214, 192, .92); color: #2a2118; box-shadow: 0 8px 26px rgba(20, 14, 8, .28); font: 13px/1.3 var(--font); white-space: nowrap; }
  .ck-head b { font-size: 14px; } .ck-head small { opacity: .7; }
  .ck-x { pointer-events: auto; width: 28px; height: 28px; border: 0; border-radius: 50%; background: rgba(60, 45, 25, .12); color: inherit; font-size: 18px; line-height: 1; cursor: pointer; }
  .ck-x:hover { background: var(--accent); color: var(--on-accent); }
  .ck-name { position: absolute; left: 0; top: 0; padding: 4px 10px 5px; border-radius: 999px; background: rgba(226, 214, 192, .9); color: #2a2118; font: 600 12.5px/1.25 var(--font);
    box-shadow: 0 5px 16px rgba(20, 14, 8, .25); white-space: nowrap; opacity: 0; transition: opacity .3s ease; }
  .ck-name.is-on { opacity: 1; }
  .ck-lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  .ck-lines g { opacity: 0; transition: opacity .3s ease; } .ck-lines g.is-on { opacity: 1; }
  .ck-lines line { stroke: rgba(226, 214, 192, .78); stroke-width: 1.2; } .ck-lines circle { fill: rgba(226, 214, 192, .95); stroke: rgba(30, 22, 14, .55); stroke-width: 1; }
  body.dark-mode .ck-head, body.dark-mode .ck-name { background: rgba(22, 18, 14, .9); color: #E2D6C0; }
  body.dark-mode .ck-x { background: rgba(226, 214, 192, .12); }
  body.ck-out #l3-lines, body.ck-out .l3-label, body.ck-out .l3-cap { opacity: 0 !important; pointer-events: none !important; }
  /* ---- the view up or down: a scroll bar on the right edge (lib3d core/views.js LIFT; G, 19/10/2026) */
  #l3-lift { position: absolute; right: 6px; top: 14vh; bottom: 14vh; width: 9px; border-radius: 6px; background: rgba(42, 33, 24, .1); pointer-events: auto; cursor: pointer; transition: width .15s ease, background-color .15s ease, opacity .3s ease; }
  #l3-lift:hover, #l3-lift.is-drag { width: 12px; background: rgba(42, 33, 24, .16); }
  .l3-lift-thumb { position: absolute; left: 0; right: 0; border-radius: 6px; background: rgba(42, 33, 24, .42); cursor: grab; }
  #l3-lift.is-drag .l3-lift-thumb { cursor: grabbing; background: rgba(42, 33, 24, .6); }
  body.dark-mode #l3-lift { background: rgba(226, 214, 192, .12); } body.dark-mode .l3-lift-thumb { background: rgba(226, 214, 192, .45); }
  body.ck-out #l3-lift { opacity: 0; pointer-events: none; }
  /* ---- labels and leader lines */
  #l3-ui { position: fixed; inset: 0; z-index: 5; pointer-events: none; font-family: var(--font); }
  body.off-mode #l3-ui { display: none; }
  #l3-lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
  #l3-lines path { fill: none; stroke: rgba(43, 33, 22, .62); stroke-width: 1.6; }
  #l3-lines .l3-card-line { stroke-dasharray: 4 3; }
  #l3-lines .l3-outline { fill: none; stroke: #E2D6C0; stroke-width: 2; stroke-linejoin: round; opacity: .95; filter: drop-shadow(0 0 1.5px rgba(20, 14, 8, .6)); }
  #l3-lines .l3-outline.is-open { opacity: .5; stroke-width: 1.5; }
  #l3-lines circle { fill: #E2D6C0; stroke: rgba(43, 33, 22, .75); stroke-width: 1.2; }
  body.dark-mode #l3-lines path { stroke: rgba(226, 214, 192, .62); }
  body.dark-mode #l3-lines circle { fill: #ffd9a0; stroke: rgba(30, 22, 14, .8); }
  /* the section labels and group names over the room: twice their first size (G, 15/10/2026), a little smaller on a
     narrower window (1.5 % of its width, 15 to 23 px); every measure in em, so they keep their shape at any size */
  .l3-label { position: absolute; left: 0; top: 0; pointer-events: auto; display: inline-flex; align-items: center; gap: .5em; max-width: 25em;
    padding: .43em .6em .43em .95em; border-radius: 999px; border: 1px solid rgba(60, 45, 25, .28); background: rgba(226, 214, 192, .9); color: #2a2118;
    font: 600 clamp(12px, 1.2vw, 18.4px)/1.25 var(--font); box-shadow: 0 7px 24px rgba(60, 40, 15, .18); cursor: pointer; white-space: nowrap;
    transition: opacity .35s ease, background-color .2s ease, color .2s ease, border-color .2s ease; }
  .l3-label.l3-books { font-size: calc(clamp(12px, 1.2vw, 18.4px) * var(--l3-k, 1)); }   /* (20 % smaller: G, 17/10/2026) */   /* (smaller only where the shelf's frame is too narrow: overlay.js) */
  .l3-label > span { overflow: hidden; text-overflow: ellipsis; }
  .l3-label i { font-style: normal; font-weight: 700; font-size: .91em; min-width: 1.6em; text-align: center; padding: .14em .5em; border-radius: 999px; background: rgba(60, 45, 25, .1); }
  .l3-label:hover, .l3-label.is-hover { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .l3-label:hover i, .l3-label.is-hover i { background: rgba(var(--on-accent-rgb), .25); }
  .l3-label.is-off { opacity: 0; pointer-events: none; }
  .l3-cap { position: absolute; left: 0; top: 0; pointer-events: none; white-space: nowrap; color: #2a2118; text-shadow: var(--halo);
    font: 700 clamp(22.4px, 2.19vw, 33.6px)/1 var(--font); letter-spacing: .26em; text-transform: uppercase; transition: opacity .35s ease, color .35s ease, text-shadow .35s ease; }   /* (twice their first size: G, 15/10/2026) */
  .l3-cap { pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 0; }   /* (a click: that part of the room, close) */
  /* a little painted (30 %: overlay.js #l3-wc), and under the pointer a soft warm glow round the letters (G, 18/10/2026) */
  .l3-cap { filter: url(#l3-wc); --cap-glow: 0 0 2px rgba(255, 248, 232, 1), 0 0 .45em rgba(255, 238, 205, .95), 0 0 1.1em rgba(255, 220, 160, .7); }
  body.dark-mode .l3-cap { --cap-glow: 0 0 2px rgba(0, 0, 0, .55), 0 0 .4em rgba(255, 226, 170, .62), 0 0 1.1em rgba(255, 204, 132, .42); }
  .l3-defs { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }
  .l3-cap:hover, .l3-cap:focus-visible { color: var(--accent); outline: none; text-shadow: var(--cap-glow); }
  .l3-cap.is-off { opacity: 0; pointer-events: none; }
  #l3-ui, .page .wx { transition: opacity .6s ease; }   /* the words over the room and the weather line come in last (loop.js reveal) */
  html.l3-wait:not(.lib3d-failed) #l3-ui, html.l3-wait:not(.lib3d-failed) .page .wx { opacity: 0 !important; }
  body.dark-mode .l3-cap { color: #E2D6C0; }
  /* a book under the pointer, named beside it */
  .l3-tip { position: absolute; left: 0; top: 0; max-width: 300px; padding: 7px 11px 8px; border-radius: 10px; pointer-events: none; opacity: 0; transition: opacity .15s ease;
    background: rgba(226, 214, 192, .96); color: #2a2118; border: 1px solid rgba(60, 45, 25, .24); box-shadow: 0 8px 22px rgba(50, 35, 15, .22); font: 13px/1.3 var(--font); }
  .l3-tip.is-on { opacity: 1; }
  .l3-tip b { display: block; font-weight: 700; }
  .l3-tip small { display: block; margin-top: 3px; font-size: 11.5px; opacity: .68; }
  body.dark-mode .l3-tip { background: rgba(22, 18, 14, .94); color: #E2D6C0; border-color: rgba(226, 214, 192, .18); }
  body.dark-mode .l3-label { background: rgba(22, 18, 14, .86); color: #E2D6C0; border-color: rgba(226, 214, 192, .2); }
  body.dark-mode .l3-label i { background: rgba(226, 214, 192, .12); }
  body.dark-mode .l3-label:hover, body.dark-mode .l3-label.is-hover { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }   /* (chosen: the accent by night too) */
  body.dark-mode .l3-label:hover i, body.dark-mode .l3-label.is-hover i { background: rgba(var(--on-accent-rgb), .25); }

  /* ---- the section card */
  .l3-card { position: absolute; left: calc(var(--sidebar-w) + 22px); top: 118px; width: min(400px, calc(100vw - var(--sidebar-w) - 44px)); max-height: calc(100vh - 220px);
    display: flex; flex-direction: column; pointer-events: auto; border-radius: 14px; background: rgba(226, 214, 192, .94); color: #2a2118;
    border: 1px solid rgba(60, 45, 25, .22); box-shadow: 0 18px 50px rgba(50, 35, 15, .25);
    opacity: 0; transform: translateX(-14px); transition: opacity .3s var(--ease), transform .3s var(--ease); }
  .l3-card.is-in { opacity: 1; transform: none; }
  body.dark-mode .l3-card { background: rgba(20, 16, 12, .92); color: #E2D6C0; border-color: rgba(226, 214, 192, .14); }
  .l3-card-head { display: flex; align-items: center; gap: 10px; padding: 14px 10px 10px 18px; border-bottom: 1px solid rgba(60, 45, 25, .14); }
  body.dark-mode .l3-card-head { border-bottom-color: rgba(226, 214, 192, .1); }
  .l3-card-head h3 { flex: 1; font: 700 15px/1.3 Georgia, 'Times New Roman', serif; }
  .l3-count { font: 700 11px/1 var(--font); padding: 4px 8px; border-radius: 999px; background: rgba(60, 45, 25, .1); }
  body.dark-mode .l3-count { background: rgba(226, 214, 192, .12); }
  .l3-close { width: 30px; height: 30px; border-radius: 50%; font-size: 20px; line-height: 1; opacity: .65; transition: opacity .2s ease, background-color .2s ease; }
  .l3-close:hover { opacity: 1; background: rgba(0, 0, 0, .06); }
  .l3-items { overflow: auto; padding: 6px 8px 10px; overscroll-behavior: contain; }
  .l3-item { display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 10px; }
  .l3-item.has-audio, .l3-item.is-atlas { cursor: pointer; }
  .l3-map { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--accent); background: rgba(var(--accent-rgb), .1); }   /* an atlas: opens on its map */
  .l3-map svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
  .l3-item.is-current .l3-map { background: var(--accent); color: var(--on-accent); }
  .l3-item:hover { background: rgba(60, 45, 25, .07); }
  body.dark-mode .l3-item:hover { background: rgba(226, 214, 192, .07); }
  .l3-item.is-current { background: rgba(var(--accent-rgb), .12); box-shadow: inset 2px 0 0 var(--accent); }
  .l3-item.is-hot { background: rgba(var(--accent-rgb), .2); box-shadow: inset 0 0 0 1px rgba(var(--accent-rgb), .55); }   /* its book is under the pointer */
  .l3-play { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: rgba(60, 45, 25, .08); transition: background-color .2s ease, color .2s ease; }
  body.dark-mode .l3-play { background: rgba(226, 214, 192, .1); }
  .l3-play .i { width: 15px; height: 15px; }
  .l3-play .ic-pause, .l3-item.is-playing .l3-play .ic-play { display: none; }
  .l3-item.is-playing .l3-play .ic-pause { display: block; }
  .l3-item.is-current .l3-play, .l3-play:hover { background: var(--accent); color: var(--on-accent); }
  .l3-item.is-loading .l3-play { animation: pulse 1s ease-in-out infinite; }
  .l3-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .l3-t { font: 600 13px/1.35 var(--font); }
  .l3-t.is-bold { font-weight: 800; }
  .l3-t a { text-decoration: none; }
  .l3-t a:hover { text-decoration: underline; }
  .l3-by { font: 12px/1.3 var(--font); opacity: .62; }
  .l3-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; }
  .l3-chip { font: 600 11px/1 var(--font); padding: 5px 9px; border-radius: 999px; border: 1px solid rgba(60, 45, 25, .25); text-decoration: none; transition: background-color .2s ease; }
  .l3-chip:hover { background: rgba(60, 45, 25, .09); }
  body.dark-mode .l3-chip { border-color: rgba(226, 214, 192, .22); }
  body.dark-mode .l3-chip:hover { background: rgba(226, 214, 192, .1); }
  .l3-time { font: 500 11.5px/1 var(--font); font-variant-numeric: tabular-nums; opacity: .7; white-space: nowrap; }
  .l3-sub { display: flex; align-items: center; gap: 8px; margin: 14px 10px 4px; padding-bottom: 6px; border-bottom: 1px solid rgba(60, 45, 25, .16);
    font: 700 10.5px/1.3 var(--font); letter-spacing: .08em; text-transform: uppercase; opacity: .7; transition: opacity .3s ease, color .3s ease; }
  .l3-sub:first-child { margin-top: 6px; }
  .l3-sub i { font-style: normal; font-weight: 700; letter-spacing: 0; padding: 2px 6px; border-radius: 999px; background: rgba(60, 45, 25, .1); }
  .l3-sub.is-target { opacity: 1; color: var(--accent); }
  body.dark-mode .l3-sub { border-bottom-color: rgba(226, 214, 192, .14); }
  body.dark-mode .l3-sub i { background: rgba(226, 214, 192, .12); }
  .l3-sep { height: 1px; margin: 6px 10px; background: rgba(60, 45, 25, .14); }
  body.dark-mode .l3-sep { background: rgba(226, 214, 192, .1); }
</style>
"""

CREDITS = """<!--
  3D background models (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), modified (re-assembled, re-materialled, decimated, compressed):
  - "Large Corner Sectional Sofa" by VR.Space - https://sketchfab.com/3d-models/large-corner-sectional-sofa-1680cc4638ba4902ada718b8b03f6a4b
  - "Modern Sofa" by 3dimentionalben - https://sketchfab.com/3d-models/modern-sofa-ac92f6e97eaa43c4ad6cb8f7c65ac43f
  - "Coffee table" by borrealis - https://sketchfab.com/3d-models/coffee-table-74c6c897299242d297e4582a87d58c1d
  - "Books and magazines" by Naira - https://sketchfab.com/3d-models/books-and-magazines-d0b76eada5bd495abcdfb2b20e6f7ee6
  - "Isometric Library" by Kenti Sanchez - https://sketchfab.com/3d-models/isometric-library-a575e54efff54ad0b495ac7c2b1f6a91
  The garden's trees are rebuilt in code from measurements of these CC BY 4.0 models (adapted: their skeletons traced
  and thinned, leaf densities and card sizes measured, leaf textures redrawn; their meshes and textures are not shipped):
  - "Tree" by SomeKevin - https://sketchfab.com/3d-models/tree-66a8d0ef9b49415a9eaf6af216cb9bce
  - "Stylized Tree" by yonimantz - https://sketchfab.com/3d-models/stylized-tree-6d1aeea748f147789004bc03e1930d32
  - "Platano Tree" by gelmi.com.br - https://sketchfab.com/3d-models/platano-tree-ef48485b7c534acc905c0d9964c5fe7c
  The Boeing 747-8 on the Research shelf is built in code from measurements of "Boeing 747-8i" by OUTPISTON -
  https://sketchfab.com/3d-models/boeing-747-8i-61b531546bb242f690f87028e333aa5c (CC BY-NC-SA 4.0): its sections,
  planforms and where its paint changes colour were measured; no mesh or picture of it is shipped. Its paint is the
  747-8's rollout scheme in plain colours, without lettering or emblem.
  The medieval clock on the tall shelf: "Ardavin's Medieval Clock. Model Completorium" by Miguel Garcia -
  https://sketchfab.com/3d-models/ardavin-s-medieval-clock-model-completorium-108445a998254c2590ded1b7f900b5dd (CC BY 4.0;
  modified: its moving parts cut apart and turned in code, the rest simplified, re-materialled, compressed; clock.glb)
  The space station over the Geography bay: "ISS" by uperesito - https://sketchfab.com/3d-models/iss-813f5b296e584c26bf386ca39de6c3d4
  (CC BY 4.0; modified: made one mesh, its textures packed into one atlas, normals left out, compressed; iss.glb)
  The camera on the tall shelf: "Vintage Camera ~ Asahi Pentax H2" by Robin Vandenberghe -
  https://sketchfab.com/3d-models/vintage-camera-asahi-pentax-h2-a2d73560b1a841b59875cf2581ffd8cf (CC BY 4.0; modified:
  its maps made smaller, its lens glass made plain, compressed; camera.glb)
  The cat and the chicken:
  - "cat" by artofaria - https://sketchfab.com/3d-models/cat-7e8cbcad506041dc9c3a0cb74edb3360 (Sketchfab Free Standard
    licence, https://sketchfab.com/licenses; rigged, re-materialled, posed and animated in code). Under that licence the
    model may not be extracted from this page, republished, retransmitted or reproduced; cat.bin is not a model file.
  - "Chicken" by pooiloui2 - https://sketchfab.com/3d-models/chicken-98830a78e8c54354a7fbe5ca8346fbf9 (CC BY 4.0;
    decimated, re-materialled, compressed; hen.glb)
  Book covers (shown on a book as it leaves the shelf): the original English editions' covers from Open Library,
  https://openlibrary.org; The Nvidia Way's from its publisher, W. W. Norton; Tro choi quyen luc's (Omega+, 2024) from
  Goodreads. The covers are their publishers'; resized.
  The stars: the Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren, Yale University Observatory / NASA ADC), via
  github.com/brettonw/YaleBrightStarCatalog (MIT licence).
  The Geography atlases' map of Vietnam: the coastline and the border from OpenStreetMap, (c) OpenStreetMap contributors
  (ODbL, https://www.openstreetmap.org/copyright), and the bands of height and depth from AWS Terrain Tiles (terrarium),
  as G's own map of Vietnam has them, simplified; Hoang Sa's islands placed by hand.
  Sunrise and sunset: NOAA's solar equations (after Meeus, "Astronomical Algorithms"); each time zone's place from the
  IANA time zone database's zone.tab (public domain).
  The bulb hanging over the sofa is rebuilt in code from the measurements of this CC BY 4.0 model (its mesh is not shipped):
  - "Incandescent Light Bulb" by AleixoAlonso - https://sketchfab.com/3d-models/incandescent-light-bulb-217c6b059c584243893b36ab76472ddd
  Architecture, shelves and shelf books, pouf, bolsters, rug, lamps, plants and trees are built in code.
-->
"""

# live weather on the page's sky clock (all screens, phones too: it is not part of the 3D layer)
WX_CSS = open(os.path.join(HERE, 'weather', 'sky-weather.css'), encoding='utf-8').read()
WX_JS = open(os.path.join(HERE, 'weather', 'sky-weather.js'), encoding='utf-8').read()
STYLE += '<style id="sky-weather">\n' + WX_CSS + '</style>\n'
# the sun where the visitor is (src/sun: window.HL_SUN; all screens too), in the head so the theme is right from the
# first paint; the zones' table and the script share one closure
SUN_JS = ''.join(open(os.path.join(HERE, 'sun', f), encoding='utf-8').read() for f in ('zones.js', 'sun-clock.js'))
STYLE += '<script id="sun-clock">\n(function () {\n' + SUN_JS + '})();\n</script>\n'
SCRIPTS = (CREDITS + '<script id="sky-weather-js">\n' + WX_JS + '</script>\n'
  + f'<script id="lib-glb" type="application/octet-stream">{glb}</script>\n'
  + f'<script id="cat-bin" type="application/octet-stream">{cat_bin}</script>\n'
  + f'<script id="hen-glb" type="application/octet-stream">{hen}</script>\n'
  + f'<script id="clock-glb" type="application/octet-stream">{clock}</script>\n'
  + f'<script id="iss-glb" type="application/octet-stream">{iss}</script>\n'
  + f'<script id="camera-glb" type="application/octet-stream">{camglb}</script>\n'
  + f'<script id="garden-cover" type="application/octet-stream">{gcover}</script>\n'
  + f'<script id="book-covers" type="application/json">{covers_inline}</script>\n'
  + f'<script id="book-summaries" type="application/json">{sums_json}</script>\n'
  + '<script type="module">\n' + module + '</script>\n')

assert page.count('</head>') == 1 and page.rstrip().endswith('</html>') and page.count('</body>') == 1, 'unexpected page structure'
assert 'id="lib3d' not in page, 'page already contains the 3D layer'
page = page.replace('</head>', STYLE + '</head>', 1)
assert page.count('<body class="no-anim">') == 1
page = page.replace('<body class="no-anim">', '<body class="no-anim">\n<div id="lib3d-loader" aria-hidden="true"><i></i></div>', 1)
# YouTube records start by themselves when the deck moves on to them. If the browser holds the sound back (Safari, or
# an embed without autoplay rights) the record starts muted and its sound comes on at the visitor's next tap or key; if
# YouTube refuses to play it at all, the deck moves on to the next record instead of standing still.
YT_PATCHES = [
  ("""    function mount() {
      mounted = true;""",
   """    let muted = false;
    const unmuteNow = () => {
      if (!muted || !ready) return;
      muted = false; player.unMute(); player.setVolume(Math.round(vol * 100)); if (wantPlay) player.playVideo();
      $('#yt-title').textContent = song.title || 'YouTube';
    };
    function mutedStart(my) {
      if (my !== gen || !ready || !wantPlay || muted) return;
      muted = true; player.mute(); player.playVideo();
      $('#yt-title').textContent = '🔇 ' + (song.title || 'YouTube');
      for (const t of ['pointerdown', 'keydown']) addEventListener(t, unmuteNow, { capture: true, once: true });
    }
    function guard(my) {   // still not started a few seconds after play: autoplay was refused
      setTimeout(() => { if (my === gen && ready && wantPlay && [-1, 5].includes(player.getPlayerState())) mutedStart(my); }, 3000);
    }
    function mount() {
      mounted = true;"""),
  ("""          playerVars: Object.assign({ playsinline: 1, rel: 0 }, song.list""",
   """          playerVars: Object.assign({ playsinline: 1, rel: 0, autoplay: 1 }, song.list"""),
  ("""              if (wantPlay) player.playVideo();
            },""",
   """              if (wantPlay) { player.playVideo(); guard(my); }
            },
            onAutoplayBlocked: () => { if (my === gen) mutedStart(my); },"""),
  ("""            onError: e => console.warn('YouTube player error', e.data)""",
   """            onError: e => { console.warn('YouTube player error', e.data); if (my === gen && wantPlay) { unmount(); fire('ended'); } }"""),
  ("""      mounted = ready = wantPlay = false;""", """      mounted = ready = wantPlay = muted = false;"""),
  ("""        else if (ready) player.playVideo();
        return Promise.resolve();""", """        else if (ready) { player.playVideo(); guard(gen); }
        return Promise.resolve();"""),
]
# the page's record-player model also feeds the 3D deck on the floor: keep a copy of it before the page parses and drops it
assert page.count('id="tt-asset"') == 1, 'record player asset not found'
i = page.index('id="tt-asset"'); j = page.index('</script>', i) + len('</script>')
page = page[:j] + "\n<script>if (document.documentElement.classList.contains('lib3d-capable')) window.__lib3dTT = document.getElementById('tt-asset').textContent;</script>" + page[j:]
for a, b in YT_PATCHES:
    assert page.count(a) == 1, 'YouTube code not found: ' + a[:60]
    page = page.replace(a, b, 1)
# The page's day runs from sunrise to sunset where the visitor is (window.HL_SUN), not from its fixed 6:22 to 17:30 (G,
# 17/10/2026): its theme before the first paint and each minute after, and its sky clock (sunrise and sunset marks,
# taken again each day; noon marked where 12:00 falls between them, as midnight is by night).
SUN_PATCHES = [
  ("""  (function () { var d = new Date(), m = d.getHours() * 60 + d.getMinutes(); if (m < 382 || m >= 1050) document.body.classList.add('dark-mode'); })();""",
   """  (function () { if (!window.HL_SUN.isDay()) document.body.classList.add('dark-mode'); })();"""),
  ("""  const SUNRISE = 6 * 60 + 22, SUNSET = 17 * 60 + 30;      // local minutes
  const DAY_LEN = SUNSET - SUNRISE, NIGHT_LEN = 1440 - DAY_LEN;""",
   """  let SUNRISE = 382, SUNSET = 1050, DAY_LEN = 668, NIGHT_LEN = 772, SUN_DAY = null;   // local minutes: today's, where the visitor is
  function sunDay(now) {
    const m = HL_SUN.minutes(now);
    if (m === SUN_DAY) return;
    SUN_DAY = m; SUNRISE = m.rise; SUNSET = m.set; DAY_LEN = SUNSET - SUNRISE; NIGHT_LEN = 1440 - DAY_LEN;
  }"""),
  ("""    if (!s) return;
    const mins = now.getHours() * 60 + now.getMinutes();
    const isDay = mins >= SUNRISE && mins < SUNSET;""",
   """    if (!s) return;
    sunDay(now);
    const mins = now.getHours() * 60 + now.getMinutes();
    const isDay = mins >= SUNRISE && mins < SUNSET;"""),
  ("""    if (s.isDay !== isDay) {
      s.isDay = isDay;""",
   """    if (s.isDay !== isDay || s.sunDay !== SUN_DAY) {
      s.isDay = isDay; s.sunDay = SUN_DAY;"""),
  ("""[[hm(SUNRISE), 0], ['12:00', 50], [hm(SUNSET), 100]]""",
   """[[hm(SUNRISE), 0], ['12:00', Math.max(0, Math.min(100, (720 - SUNRISE) / DAY_LEN * 100))], [hm(SUNSET), 100]]"""),
  ("""    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const isDay = mins >= SUNRISE && mins < SUNSET;""",
   """    const now = new Date();
    sunDay(now);
    const mins = now.getHours() * 60 + now.getMinutes();
    const isDay = mins >= SUNRISE && mins < SUNSET;"""),
]
for a, b in SUN_PATCHES:
    assert page.count(a) == 1, 'sky clock code not found: ' + a[:60]
    page = page.replace(a, b, 1)
page = page.replace('</body>', SCRIPTS + '</body>', 1)
open(out_path, 'w', encoding='utf-8').write(page)
if pages_dir:   # the same page with the models as a separate file
    import shutil
    inline = f'<script id="lib-glb" type="application/octet-stream">{glb}</script>'
    assert page.count(inline) == 1
    os.makedirs(pages_dir, exist_ok=True)
    # the 3D module is a file of its own too: only screens that show the room fetch it (phones never do), and it stays
    # cached when only the page changes. Its name carries a hash of its content so a new page never runs an old module.
    import hashlib
    mod_name = 'lib3d.js?v=' + hashlib.sha1(module.encode()).hexdigest()[:10]
    mod_inline = '<script type="module">\n' + module + '</script>\n'
    assert page.count(mod_inline) == 1
    loader = ("<script>if (document.documentElement.classList.contains('lib3d-capable')) { var m = document.createElement('script'); m.type = 'module'; "
              "m.src = '" + mod_name + "'; document.body.appendChild(m); }</script>\n")
    preload = ("var g = document.createElement('link'); g.rel = 'preload'; g.as = 'fetch'; g.href = 'lib.glb'; g.crossOrigin = 'anonymous'; document.head.appendChild(g);"
               " var p = document.createElement('link'); p.rel = 'modulepreload'; p.href = '" + mod_name + "'; document.head.appendChild(p);")
    assert page.count('/*GLB_PRELOAD*/') == 1
    cat_inline = f'<script id="cat-bin" type="application/octet-stream">{cat_bin}</script>'
    hen_inline = f'<script id="hen-glb" type="application/octet-stream">{hen}</script>'
    clock_inline = f'<script id="clock-glb" type="application/octet-stream">{clock}</script>'
    iss_inline = f'<script id="iss-glb" type="application/octet-stream">{iss}</script>'
    cam_inline = f'<script id="camera-glb" type="application/octet-stream">{camglb}</script>'
    gc_inline = f'<script id="garden-cover" type="application/octet-stream">{gcover}</script>'
    assert page.count(cat_inline) == 1 and page.count(hen_inline) == 1
    covers_el = f'<script id="book-covers" type="application/json">{covers_inline}</script>'
    sums_el = f'<script id="book-summaries" type="application/json">{sums_json}</script>'
    assert page.count(covers_el) == 1
    out = (page.replace(inline, '<script id="lib-glb" type="application/octet-stream" data-src="lib.glb"></script>', 1)
               .replace(cat_inline, '<script id="cat-bin" type="application/octet-stream" data-src="cat.bin"></script>', 1)
               .replace(hen_inline, '<script id="hen-glb" type="application/octet-stream" data-src="hen.glb"></script>', 1)
               .replace(clock_inline, '<script id="clock-glb" type="application/octet-stream" data-src="clock.glb"></script>', 1)
               .replace(iss_inline, '<script id="iss-glb" type="application/octet-stream" data-src="iss.glb"></script>', 1)
               .replace(cam_inline, '<script id="camera-glb" type="application/octet-stream" data-src="camera.glb"></script>', 1)
               .replace(gc_inline, '<script id="garden-cover" type="application/octet-stream" data-src="garden-cover.webp"></script>', 1)
               .replace(covers_el, f'<script id="book-covers" type="application/json">{covers_files}</script>', 1)
               .replace(sums_el, '<script id="book-summaries" type="application/json" data-src="summaries.json"></script>', 1)
               .replace('/*GLB_PRELOAD*/', preload, 1).replace(mod_inline, loader, 1))
    open(os.path.join(pages_dir, 'index.html'), 'w', encoding='utf-8').write(out)
    open(os.path.join(pages_dir, 'lib3d.js'), 'w', encoding='utf-8').write(module)
    if dev:   # for working on the modules: DIR/dev.html runs DIR/lib3d/main.js and its modules as they are, unjoined
        shutil.rmtree(os.path.join(pages_dir, 'lib3d'), ignore_errors=True)
        shutil.copytree(os.path.join(HERE, 'lib3d'), os.path.join(pages_dir, 'lib3d'))
        open(os.path.join(pages_dir, 'dev.html'), 'w', encoding='utf-8').write(out.replace("'" + mod_name + "'", "'lib3d/main.js'"))
        print('dev  :', os.path.join(pages_dir, 'dev.html'), '(the modules unjoined)')
    shutil.copyfile(os.path.join(HERE, 'lib.glb'), os.path.join(pages_dir, 'lib.glb'))
    for f in ('cat.bin', 'hen.glb', 'clock.glb', 'iss.glb', 'camera.glb', 'garden-cover.webp'): shutil.copyfile(os.path.join(HERE, f), os.path.join(pages_dir, f))
    open(os.path.join(pages_dir, 'summaries.json'), 'w', encoding='utf-8').write(sums_json.replace('<\\/', '</'))
    os.makedirs(os.path.join(pages_dir, 'covers'), exist_ok=True)
    for f in cover_files: shutil.copyfile(os.path.join(COVER_DIR, f), os.path.join(pages_dir, 'covers', f))
    if os.path.exists(os.path.join(pages_dir, 'pets.glb')): os.remove(os.path.join(pages_dir, 'pets.glb'))   # (the cat and hen were one file until 14/10)
    print('pages:', pages_dir, round(os.path.getsize(os.path.join(pages_dir, 'index.html')) / 1e6, 2), 'MB + lib3d.js',
          round(os.path.getsize(os.path.join(pages_dir, 'lib3d.js')) / 1e6, 2), 'MB + lib.glb')
print('base :', base_path)
print('wrote:', out_path, round(os.path.getsize(out_path) / 1e6, 2), 'MB')
