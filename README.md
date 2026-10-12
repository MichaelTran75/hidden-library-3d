# Hidden Library 3D

The Hidden Library audiobook page as a 3D reading room: shelf sections with labels, a card per section, books that come off the shelf while they play, day and night with stars and the moon.

**Live:** https://michaeltran75.github.io/hidden-library-3d/

- `index.html`: the page (three.js 0.170 from jsDelivr); `lib.glb`: the room's models, loaded next to it.
- Built from `3D Library ver 01/src` (`build.py --pages`); publish with `./publish.sh "message"`.
- Phones (≤ 768 px) and browsers without WebGL 2 get the original card layout.

## Credits

3D models (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/), modified (re-assembled, re-materialled, decimated, compressed):

- "Large Corner Sectional Sofa" by VR.Space: https://sketchfab.com/3d-models/large-corner-sectional-sofa-1680cc4638ba4902ada718b8b03f6a4b
- "Modern Sofa" by 3dimentionalben: https://sketchfab.com/3d-models/modern-sofa-ac92f6e97eaa43c4ad6cb8f7c65ac43f
- "Coffee table" by borrealis: https://sketchfab.com/3d-models/coffee-table-74c6c897299242d297e4582a87d58c1d
- "Books and magazines" by Naira: https://sketchfab.com/3d-models/books-and-magazines-d0b76eada5bd495abcdfb2b20e6f7ee6
- "Isometric Library" by Kenti Sanchez: https://sketchfab.com/3d-models/isometric-library-a575e54efff54ad0b495ac7c2b1f6a91
- "Tree" by SomeKevin: https://sketchfab.com/3d-models/tree-66a8d0ef9b49415a9eaf6af216cb9bce
- "Stylized Tree" by yonimantz: https://sketchfab.com/3d-models/stylized-tree-6d1aeea748f147789004bc03e1930d32
- "Platano Tree" by gelmi.com.br: https://sketchfab.com/3d-models/platano-tree-ef48485b7c534acc905c0d9964c5fe7c

Architecture, shelves and shelf books, pouf, bolsters, rug, lamps and plants are built in code.
