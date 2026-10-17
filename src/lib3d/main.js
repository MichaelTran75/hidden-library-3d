// The 3D library of Hidden Library: on wide screens the reading room is the page's interface (see ../ARCHITECTURE.md).
// The modules run in build order, which is also the order the room's objects are created in (their ids decide the draw
// order of surfaces at equal depth, and the shared random sequence is drawn in that order). Each module first imports
// the one built just before it, so importing the last one here runs them all in this order, whatever else they import
// from each other (a module may use a later one's functions; they are only called once everything has run):
//   1. core/base.js
//   2. core/utils.js
//   3. world/textures.js
//   4. core/renderer.js
//   5. world/materials.js
//   6. world/room.js
//   7. world/books.js
//   8. world/shelves.js
//   9. world/decor/kit.js
//   10. world/decor/atlas.js
//   11. world/decor/items.js
//   12. world/decor/build.js
//   13. world/pouf.js
//   14. world/rug.js
//   15. world/furniture.js
//   16. world/bush.js
//   17. world/outside.js
//   18. world/lights.js
//   19. world/trees.js
//   20. world/assets.js
//   21. world/wind.js
//   22. world/velvet.js
//   23. world/furnish.js
//   24. fx/dust.js
//   25. fx/post.js
//   26. core/views.js
//   27. core/build.js
//   28. fx/night.js
//   29. fx/hour.js
//   30. fx/glass.js
//   31. ui/library.js
//   32. ui/book-data.js
//   33. ui/sections.js
//   34. ui/hero-books.js
//   35. ui/vn-geo.js
//   36. ui/atlas.js
//   37. ui/leaves.js
//   38. ui/words.js
//   39. fx/star-catalog.js
//   40. fx/sky.js
//   41. fx/fireflies.js
//   42. fx/glow.js
//   43. fx/rain.js
//   44. world/cat.js
//   45. world/fur.js
//   46. world/pets.js
//   47. world/b747.js
//   48. world/clock.js
//   49. world/iss.js
//   50. ui/flight.js
//   51. ui/deck.js
//   52. ui/overlay.js
//   53. ui/picking.js
//   54. core/loop.js
//   55. ui/hooks.js
// A new part goes in where it belongs in that order: it imports the module before it, and the module after it (or this
// file, at the end) imports it instead.
import './ui/hooks.js';
