# Split and equivalence tools

Used on 13/10/2026 to cut `library3d-bg.js` (now `backup/library3d-bg.v7-before-split.js`) into `lib3d/`.

- `analyze.cjs FILE out.json`: the top-level statements of the old one-file module's `if (LIB) { … }` block. For each statement it lists the names it declares, reads and writes, resolved with TypeScript's checker (`~/.npm/_npx/5a9d879542beca3a/node_modules/typescript`).
- `parts.cjs`: which statement lines went into which module, in build order.
- `gen.cjs FILE outDir`: writes the modules. It adds imports, exports and the first-line build-order import, and turns cross-module writes into setters.
- `compare.cjs URL…` (with `AT=15:00,20:00`): for each build and hour, a hash of the scene and of the picture, with the clock held at 10 s. It also writes `sig_*.txt` and `pic_*.png` for diffs. Use it for any refactor: build the old and the new with `build.py --pages`, serve both, compare.
- `devcheck.cjs URL…`: loads `dev.html` (modules unjoined) and the joined build, then compares the day picture.
