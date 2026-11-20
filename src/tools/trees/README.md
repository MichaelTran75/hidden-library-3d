# Trees built in code

`makeTrees()` in `lib3d/world/trees.js` builds the garden's three trees. They replace three CC BY 4.0 GLB models
("Tree" by SomeKevin = A, "Stylized Tree" by yonimantz = B, "Platano Tree" by gelmi = C), which were measured and
rebuilt (the old models are in `../../backup/lib.v4-with-glb-trees.glb`).

- `treegen.js`: the generator with tuning knobs (`P.A_*`, `P.B_*`, `P.C_*`), loaded in a test page as `window.makeTrees(THREE, rng, P)`.
  After changing it: `python3 tools/trees/mkmodule.py` (writes `makeTrees` into the module with the knobs fixed), then `python3 build.py`.
- `compare_trees.js`: renders an old tree (left) next to the new one (right) in six views; needs a test copy of the page that
  still has the GLB trees and exposes `THREE` on `window.__lib3d`.
- Measured data embedded in the generator:
  - A, C skeletons: `skel.py` (level sets of the distance over the bark from the root; C's mesh is subdivided twice first), then
    `skelenc.py K 0.03 0.02 0.002` (thinned to 3 cm, varint parent + int8 offsets in 2 cm + uint8 radius in 2 mm, base64).
  - Leaf densities: `vox.py points.npy res 4 out` (cells of 0.4 m for B, 0.6 m for A's sprig stems, 0.5 / 0.8 m for C's leaves and
    sprays; 2 bits a cell).
  - B's twelve limbs: the longest pieces of its bark (PCA ends), in `B_LIMBS`.
  - Card sizes, facing histograms, texture cover and tone: from the old leaf meshes and textures (see the comments in `treegen.js`).
- Inputs for the scripts are the old meshes dumped from the browser as JSON (positions in the tree's own metres: GLB units × 0.82 for
  A, × 23 for B, × 0.024 for C).
