# Hidden Library 3D: mã nguồn

Trang sách nói Hidden Library dựng thành phòng đọc 3D (three.js 0.170). Màn ≤ 768 px hoặc không có WebGL 2 thì giữ bố cục thẻ gốc.

## Dựng

- `python3 build.py <trang gốc.html> --pages <thư mục>`: ra `index.html`, `lib3d.js?v=băm` và mô hình cho Pages, kèm một tệp HTML tự chứa để nhúng.
  - `bundle_lib3d()` lần theo import từ `lib3d/main.js`, ghép mọi mô-đun thành một, bỏ import / export, rồi `node --check`.
  - `--dev`: thêm `dev.html` chạy thẳng các mô-đun, không ghép, không nén. `--no-minify`: không nén.
- Nén (`tools/minify`): terser cho JS với `compress: false, mangle: false`, esbuild chỉ cho CSS. Gói npm cài ngoài cây mã; thiếu thì `build.py` tự `npm ci`.
- Công cụ đo / chụp trong `tools/` dùng Playwright: đặt `PLAYWRIGHT=<đường dẫn gói playwright>` (mặc định `require('playwright')`).

## Bản đồ tệp

```
lib3d/main.js   import mô-đun cuối của chuỗi dựng
  core/   base (DOM, cỡ tệp, tick) · utils (rng, noise, canvas) · renderer (RT_SCALE, bóng PCSS, prime shader)
          views (camera, LIFT) · build (main: dựng phòng) · loop (vẽ, nạp theo phần, đèn) · bake (ánh sáng nướng bằng dò tia)
  world/  room shelves books (sách kệ, atlas gáy) textures timber wood matter materials velvet pouf rug furniture furnish
          lights outside trees bush wind · cat fur pets (mèo, gà) · clock clockxray camera camparts camxray b747 iss showcase
          gardenbook · decor/{kit, atlas, items, build}
  fx/     post (màu nước ngoài trời) night hour sky star-catalog glass rain glow dust fireflies
  ui/     library sections overlay picking hooks (__lib3d) words deck (máy hát)
          flight (sách bay ra / mở, readMode) hero-books (sách cầm tay, atlas) leaves (sách đọc được, chữ HTML) atlas vn-geo
sun/      giờ mặt trời theo múi giờ người xem · weather/ thời tiết trực tiếp · summaries/ tóm tắt sách
tools/    bake camera clock pets perf (đo khung, RAM, nạp) split (kiểm tương đương) trees vnmap wood minify …
```

## Quy ước

- Dòng đầu mỗi mô-đun: `import './<mô-đun đứng trước>.js';` (thứ tự dựng = thứ tự id vật thể và dãy số ngẫu nhiên). Thêm mô-đun: mô-đun đứng sau đổi dòng đầu sang tệp mới; gọi hàm dựng trong `core/build.js` hoặc `core/loop.js`.
- Biến dùng chung bị ghi từ mô-đun khác đi qua setter (`setNeeds`, `setShadowsDirty`, `setRtScale`, `setReady`).
- Import một dòng, đường dẫn tương đối, không `?v=`.

## Nạp trang

- `html.l3-hold` (đặt sẵn trong `build.py`): canvas ẩn, chỉ thanh tải % ở giữa màn. `core/loop.js` `start` dựng hết (kệ, đồ đạc, sách, vườn, trời, mô hình trưng bày, gà mèo, đồ trên kệ) không chờ giờ, không mờ dần từng phần, rồi `gpuIdle` + một lần vẽ, bỏ `l3-hold`: cả phòng hiện một lần (CSS `#lib3d` 1,6 s). Bước dài thì `creep` cho % nhích dần tới mốc kế. `lib3d-slow` (30 s) hiện phòng dù chưa xong. Ba trạng thái đèn còn lại (~195 shader, ~90 MB GPU) chỉ làm khi sắp cần (`lightsSoon`, xét mỗi phút): bấm nút Ngày / Đêm (chờ % ~13 s lần đầu), trời u ám / mưa, hoặc 45 phút nữa trạng thái đèn theo giờ khác bây giờ (chạng vạng, rạng sáng). `?lights=all` làm hết ngay; dưới trình duyệt tự động (`navigator.webdriver`) cũng làm hết để công cụ chờ được `l3-precompiled`, `?lights=lazy` để đo như người xem. `releaseSources` và nhoè hậu cảnh (`warmDof`) không còn chờ đèn.

## Độ nét

- Không phóng hình nào lên: canvas theo điểm ảnh màn hình (tối đa 2), hình phòng `RT_SCALE` tối đa 1 điểm ảnh CSS (`RT_TOP`: màn 2× bớt ~170 MB GPU so với 2, lượt blit kéo lên canvas; 0,5 thì gáy sách vỡ khối; `RT_STEPS` 2 → 1,5 → 1,25 → … ; `adaptQuality` hạ bậc khi khung trung vị > 58 ms, nhớ ở `hiddenLibrary.lib3dScale3`), các lớp nét (`crispPass`: mèo, gà, 747, ISS, đồng hồ, máy ảnh) theo điểm ảnh canvas. Atlas gáy sách 1024×512 (gáy trên kệ chỉ vài điểm ảnh), đồ trên kệ 1024, sơn 747 1774×443.
- Còn mềm có chủ ý: màu nước ngoài kính (`POST.out` 0,75 px CSS + FXAA), nhoè hậu cảnh khi đọc / soi vật (`DOF`).
- Giá so với 1,25 / canvas 1,5: tiến trình GPU +~285 MB, thời gian vẽ một khung ×1,75.

## Sách mở

- `ui/flight.js` `openPose`: sách mở (đang nghe, sách ghi chú, atlas) gần thêm `OPEN_BIG` 1,25 nhưng không gần hơn `fit` (hai trang vừa bề ngang `FIT.w`, chiều cao vừa phần trống trên thanh phát `FIT.h × fh`, cộng 0,42 × bề rộng sách vì bìa mở 155° chồm về camera). `readMode` → `body.bk-read` ẩn mọi giao diện trừ thanh phát; wheel / touchmove / phím cuộn bị chặn (`ui/picking.js`).
- Chữ HTML (`ui/leaves.js` `readText`): sách nằm yên ≥ 3 khung thì các trang đang thấy vẽ lại không chữ (`textual` ghi lại `fillText` / `strokeText`, phép biến đổi, halo), chữ thành `<span>` trong `#l3-read`, mỗi trang một tấm chiếu `matrix3d` lên tứ giác trang. Nguồn trang qua `docOf(bk)` (`leafDoc` cho sách lá, `heroAtlasPage` cho atlas); `textPaint(doc, key, fn)` bọc mọi lần vẽ. Lật, gập, dời: chữ về lại canvas.

## Bẫy

- Bundle gộp một phạm vi: tên cấp cao nhất trùng giữa hai mô-đun làm hỏng build (`node --check` báo).
- Minify: không đổi tên (worker dựng từ mã nguồn hàm và gọi nhau bằng tên; three.js nhận diện shader theo mã nguồn `onBeforeCompile`).
- `.np` là `position: fixed`: `offsetParent` luôn null, kiểm hiện / ẩn bằng `getClientRects().length`.
- Shader: nhánh rẽ đi vào `dFdx` thêm ~2,5 ms; vòng `for` trên mảng uniform thêm ~28 ms (đo bằng `tools/perf/define.cjs`). GLSL chèn sau `<common>` chưa thấy `map` / `vMapUv`: vật biến mất mà console im. `sampler2DShadow` để null làm GL bỏ cả lần vẽ: dùng DepthTexture 1×1.
- Chữ HTML: vùng `clip()` của canvas không theo sang HTML.
- Quầng sáng cộng màu (đèn, ô kệ): đừng vẽ bằng gradient canvas trên WebKit (Safari trộn nhiễu màu thành đốm đỏ / xanh); `core/utils.js` `alphaTex` ghi số, nhân alpha sẵn trên WebKit (WebKit nạp canvas gradient như đã nhân), Chrome giữ gradient. Thử bằng Playwright `webkit`.
- Chụp so trước / sau ban đêm: đom đóm bay sát camera thành vệt vàng lớn; chụp lại trước khi kết luận.
- Dời đồ trong phòng thì nướng lại ánh sáng (`tools/bake`).
- Đèn riêng cho một mô hình (đồng hồ, máy ảnh: đèn rọi ô `world/shelves.js` `cellLight`) đặt trên lớp của mô hình; đèn ở lớp 0 đổi số đèn của cả phòng, mọi shader biên dịch lại. Quầng sáng trên gỗ là mặt phẳng cộng màu, không phải đèn.
- Bản đồ bóng chỉ giữ độ sâu (`core/renderer.js`): `DepthTexture` + màu R8 thế chỗ, đổi chỗ `textures[0]` quanh `renderer.shadowMap.render`; shader đọc `.r`. Tự tạo `shadow.map` thì phải `shadow.camera.updateProjectionMatrix()` (three chỉ gọi khi nó tự tạo). Thêm bóng đèn điểm thì phải trả lại `unpackRGBAToDepth` cho nó.
- Ẩn / hiện đèn đổi số đèn → shader mới cho mọi vật được chiếu (mỗi trạng thái ~200 chương trình, ~90 MB). Để đèn ở 0 thay vì ẩn: một bộ shader nhưng đêm chậm 4–6 ms / khung (shader to hơn), đã thử và bỏ.
- Lớp lông mèo (`world/fur.js`) và lớp tuyết thảm (`world/rug.js`) là instance của cùng một lưới (`InstancedBufferGeometry` / `InstancedMesh`): đừng chép lưới N lần. Thảm bỏ tam giác nằm dưới pouf (`poufR` < 0,8). Cây B (`world/trees.js`, nguồn `tools/trees/treegen.js`) bỏ 30 % que ngắn nhất; `lodLeaves` gọn đỉnh theo lá giữ lại.
