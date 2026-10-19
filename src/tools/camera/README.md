# Máy ảnh cổ trên kệ cao (`lib3d/world/camera.js`)

Mẫu: "Vintage Camera ~ Asahi Pentax H2" của Robin Vandenberghe (Sketchfab, CC BY 4.0).

## Dựng `camera.glb`

`node make.mjs <source.glb> <out.glb> [size]`. Script cần `@gltf-transform` 4.2, `meshoptimizer` và `sharp`. Bản trong trang dùng `size` 512.

- Texture thu về tối đa `size` px, đổi sang WebP q88.
- Kính ống kính bỏ `KHR_materials_transmission`, chỉ còn trong suốt thường. Nếu giữ, trang phải vẽ thêm một hình của cả phòng.
- Hàn đỉnh, quantize, nén meshopt: 7,8 MB còn 581 KB.

## Trong trang

- Máy ảnh đứng ở ô của đồng hồ để bàn `mantelClock` (`decor/build.js`, `DECOR.camera`). Các lần rút số ngẫu nhiên vẫn giữ nguyên, nên các ô khác không đổi.
- Bỏ dây đeo (`Ribbon_LP`) và hai mẩu kim loại ở đầu dây (`Pins_LP`, `IronPieces_LP`). Trong mẫu, dây buông thẳng xuống như treo trên móc, đặt lên kệ thì xuyên qua ván.
- Kích thước: thân rộng 0,2 m, bằng 1,4 lần máy thật (143 mm).
- Hướng: ống kính xoay ra phòng, nghiêng thêm 0,42 rad cho thấy hông máy.
- Màu nước 10 % (`paintLightly(g, 0.9)`).
