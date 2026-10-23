# Performance tools

Headless Chrome with the Mac's real GPU (ANGLE Metal), through the Playwright found in
`~/.npm/_npx/0b9ff77863cb6e9f/node_modules/playwright` (change the path at the top of each script if it moves).

| script | what it tells |
|---|---|
| `node load.cjs URL` | load timing (DCL, FCP, room shown), long tasks, every resource with its size; `--profile out.cpuprofile` also records a CPU profile (the profiler slows the page several times: use it for *where*, not *how long*) |
| `node prof.cjs out.cpuprofile [N]` | self and total time per function from that profile |
| `node chains.cjs out.cpuprofile fnName [line]` | the heaviest call chains into a function, and its hot lines |
| `node progs.cjs URL` | shader programs at first draw and after the background precompile, and the network table |
| `node marks.cjs URL` | the start-up phases, on a build instrumented with `performance.mark('l3-…')` (see below) |
| `node smoke.cjs URL` | desktop shows the room with no errors; a phone never fetches lib3d.js, lib.glb or three.js |
| `node shelfshots.cjs URL prefix` | four views of the tall shelf's decor, by day (15:00) and by night (20:00) |
| `node memab.cjs DIR_A DIR_B [runs]` | memory of two builds (`build.py --pages DIR --dev`), each served from its folder by the script: the GL allocations (textures, renderbuffers, buffers, through a hook on the WebGL calls), the JS heap, and the phys footprint of only the browser it opened. Other Playwright browsers that are running (another session's) are left out, so the footprint is not inflated by them |
| `BASE=URL node occlusion.cjs` | what no view ever shows: each mesh and each instance drawn in its own colour from every view (home, each section, Research; the view raised and lowered) at eight window shapes, by day and by night (672 views, ~25 min); prints the meshes with no pixel and, for instanced meshes, how many instances never showed. Run it on a build served by you (`python3 -m http.server`); `OUT=` names the JSON (counts per `mesh:instance`, and each mesh's size, place and material, to tell them apart) |

The page marks its own start-up (since 17/10/2026, `core/loop.js`): `l3-room` (built), `l3-reveal0` and `l3-first-draw`
(the room shown), `l3-reveal1` (the garden), `l3-reveal2` (the sky), `l3-reveal3` (the weather and the words) and
`l3-precompiled` (the other light states compiled); `marks.cjs` waits for the last one.

Measured 17/10/2026, same setup: room built 1.1–1.2 s, first draw 1.3–1.4 s (earlier that day: 2.9–4.1 s), garden
+0.6 s, sky +1.25 s, words +1.9 s, light states compiled ~3.7 s; no long task over 160 ms after the first draw.

Measured 13/10/2026 on the M4 (1512×900 at 2×, cold browser, fast network):
- room shown 2.3–2.4 s after navigation; FCP 0.5–0.6 s; 1.21 MB over the wire (2.5 MB decoded).
- start-up: three.js modules ready at 0.58 s; building the room in JS 1.3 s (textures, shelves and books 0.47 s,
  trees 0.23 s, furniture, decor and garden 0.56 s); shader compile 0.2–0.5 s; first draw 0.13 s; then 0.5–0.9 s
  more of precompiling the other light states, during which the room does not redraw.
- 80 shader programs at first draw, 144 after the precompile (the night/dusk light states add 64).
