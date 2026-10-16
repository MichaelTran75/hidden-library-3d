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

Instrumenting a build for `marks.cjs`: build with `build.py --pages DIR`, then add marks around `main()`,
`compileFor(scene)`, the first `draw()` and the end of `precompileLightStates()` in `DIR/lib3d.js`.

Measured 13/10/2026 on the M4 (1512×900 at 2×, cold browser, fast network):
- room shown 2.3–2.4 s after navigation; FCP 0.5–0.6 s; 1.21 MB over the wire (2.5 MB decoded).
- start-up: three.js modules ready at 0.58 s; building the room in JS 1.3 s (textures, shelves and books 0.47 s,
  trees 0.23 s, furniture, decor and garden 0.56 s); shader compile 0.2–0.5 s; first draw 0.13 s; then 0.5–0.9 s
  more of precompiling the other light states, during which the room does not redraw.
- 80 shader programs at first draw, 144 after the precompile (the night/dusk light states add 64).
