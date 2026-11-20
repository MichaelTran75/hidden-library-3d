# Máy ảnh cổ trên kệ cao (`lib3d/world/camera.js`, `lib3d/world/camparts.js`)

Mẫu: "Vintage Camera ~ Asahi Pentax H2" của Robin Vandenberghe (Sketchfab, CC BY 4.0).

## Dựng `camera.glb`

`node make.mjs <source.glb> <out.glb> [size]`. Script cần `@gltf-transform` 4.2, `meshoptimizer` và `sharp`. Bản trong trang dùng `size` 512.

- Texture thu về tối đa `size` px, đổi sang WebP q88.
- Kính ống kính bỏ `KHR_materials_transmission`, chỉ còn trong suốt thường. Nếu giữ, trang phải vẽ thêm một hình của cả phòng.
- Hàn đỉnh, quantize, nén meshopt: 7,8 MB còn 581 KB.

## Trong trang

- Máy ảnh đứng ở ô của đồng hồ để bàn `mantelClock` (`decor/build.js`, `DECOR.camera`). Các lần rút số ngẫu nhiên vẫn giữ nguyên, nên các ô khác không đổi.
- Bỏ dây đeo (`Ribbon_LP`) và hai mẩu kim loại ở đầu dây (`Pins_LP`, `IronPieces_LP`). Trong mẫu, dây buông thẳng xuống như treo trên móc, đặt lên kệ thì xuyên qua ván.
- Kích thước: thân rộng 0,24 m, bằng 1,7 lần máy thật (143 mm).
- Hướng: ống kính xoay ra phòng, nghiêng thêm 0,42 rad cho thấy hông máy.
- Màu nước 10 %.

## Phần trong (`camparts.js`)

Mẫu là vỏ rỗng. Thấu kính, màng khẩu, hộp gương, kính lấy nét, lăng kính, màn trập, đường phim, bánh răng dựng bằng mã theo milimét (xem đầu `camparts.js`: căn cứ từng phần, chỗ lệch với máy thật).

Số đo của vỏ (mm, khung của máy: gốc trên trục ống kính, x về phía núm tua, y lên, z ra theo ống kính), lấy bằng cách cắt lưới của mẫu:

| | |
|---|---|
| thân | x −76,8 … 66,2; y −34,2 … 36,2 (nóc lăng kính 61,0); z −5,9 … 25,8 |
| mặt ngàm | z 40,46; hộp gương rộng ±25,9 |
| đường nối nắp đáy / nắp trên | y −29,4 / 26,9 |
| trục cần lên phim | x −62, z 10 |
| trục núm tốc độ | x −36,5, z 8,3 |
| nút chụp | x −45,3, z 20,3 |
| trục núm tua | x 50,4, z 9,95 |
| thị kính | y 28 … 45, tâm x 0 |

Đổi mẫu khác thì đo lại các số này (`CP` trong `camparts.js`) và các ngưỡng cắt vỏ trong `vcShell` (`camera.js`).

## Tấm X-quang (`camxray.js`)

Hình chiếu bên hông của mọi lưới, dò mép thành đường viền SVG. Chạy lại sau khi đổi `camparts.js` hoặc đổi mẫu (cần `numpy`, `Pillow`):

1. `PLAYWRIGHT=<thư mục module> node xray_dump.cjs URL meshes.json`
2. `python3 xray.py meshes.json` → `xray.json` và `xray-check.png` cạnh `meshes.json`
3. `python3 xray_put.py xray.json ../../lib3d/world/camxray.js`, rồi dựng lại trang

Kiểm: `node xray.cjs URL OUT`.

## Kiểm

`PLAYWRIGHT=<thư mục module> node apart.cjs URL OUT [cảnh,…]` trên một bản dựng tự phục vụ (`build.py … --pages DIR`): mở máy ảnh, tách, chỉ hiện các bộ phận của từng cảnh, chụp từ phía đã chọn và cắt ảnh quanh chúng. Cảnh: `top`, `back`, `front`, `bottom`, `mbox`, `lens`, `inside`, `all`, `all2`, `all3` … (xem `SCENES` trong tệp). In lỗi shader nếu có.
