# Performance tools

Headless Chrome on the real GPU (ANGLE Metal) through Playwright: set `PLAYWRIGHT=<path to the playwright package>`
(default `require('playwright')`).

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
| `node ftime.cjs URL [HH:MM]` | the GPU time of one whole frame (a draw, then a 1-pixel read that waits for it; median of 40, the picture at its full 0.8 scale) in the home view, the low view, Research, the clock out, a book presented and a book being read; the start-up marks and the shader programs. Run it twice on each build: two runs of one build differ by up to ~1.7 ms |
| `CHROME=… node cold.cjs URL [runs]` | a first visit (the shader cache emptied, every fragment shader salted so none was compiled before): start-up marks, long tasks, the worst and the total time the page's thread was held after the first picture, shaders first made while a picture was drawn, pictures over 80 ms, first uses that waited on the GPU. `WARM=1` for a later visit. Numbers move with the machine's load: compare two builds in one sitting |
| `PLAYWRIGHT=… node timeline.cjs URL [Mbps latencyMs]` | 45 s of a visit: the start-up marks, every file with when it was asked for and when it was in, long tasks, gaps between frames over 50 ms; with a line speed, the network held to it (cache off) |
| `PLAYWRIGHT=… CHROME=… node stage.cjs URL` | a first visit (as cold.cjs), stage by stage: marks, frame gaps of 100 ms and more, shaders as they are made, the lights each time one is shown or hidden, first uses that waited; `HAND=1` moves the pointer throughout |
| `PLAYWRIGHT=… CHROME=… node coldgap.cjs URL [runs]` | cold.cjs with a hand on the mouse for `MOVE_S` seconds (25) after the words come in: the gaps between frames in that time and after |
| `PLAYWRIGHT=… node crawl.cjs URL OUT` | the picture's scale against multisampling: a frame's GPU time, and how much a patch of the shelves and one of the sofa flicker under a slow pan (mean second difference in time; pixels per thousand that jump over 12 levels) |
| `node define.cjs URL HH:MM CASE…` | what a part of the shaders costs, on one page: a frame's GPU time in the home and low views with a define added to (`+NAME`) or taken off (`-NAME`) every lit material, or a kind of mesh left out (`hide:velvet`), each case four times in turn with the page as it is; tells 0.3 ms, where two pages side by side differ by ±1.5 ms |
| `node switch.cjs URL OUT` | day to night and back once the page is all made: long tasks and shaders made late during each switch, a shot after each |
| `BASE=URL node occlusion.cjs` | what no view ever shows: each mesh and each instance drawn in its own colour from every view (home, each section, Research; the view raised and lowered) at eight window shapes, by day and by night (672 views, ~25 min); prints the meshes with no pixel and, for instanced meshes, how many instances never showed. Run it on a build served by you (`python3 -m http.server`); `OUT=` names the JSON (counts per `mesh:instance`, and each mesh's size, place and material, to tell them apart) |

The page marks its own start-up (`core/loop.js`): `l3-room` (built), `l3-reveal0` and `l3-first-draw`
(the room shown), `l3-reveal1` (the garden), `l3-reveal2` (the sky), `l3-reveal3` (the weather and the words) and
`l3-precompiled` (the other light states compiled); `marks.cjs` waits for the last one. A visitor's page makes the other light states only when one is coming; under automation it makes them all at once, so `l3-precompiled` comes. Add `lights=lazy` to the URL to measure a visitor's way.

