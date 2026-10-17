# Mô hình ISS trên nóc kệ Geography (`lib3d/world/iss.js`)

Mẫu: "ISS" của uperesito (Sketchfab, CC BY 4.0), lưu ở `3D Assets/space/iss-display-uperesito.glb`.

## Dựng `iss.glb`

`node make.mjs <source.glb> <out.glb> [atlas.png] [--flat]`

Script cần `@gltf-transform` 4.2, `meshoptimizer` và `sharp`. Bản trong trang được dựng với `--flat`.

1. Gộp cả trạm thành một mesh, một vật liệu, để vẽ trong một lượt. Gốc mẫu có 105 mesh và 46 vật liệu.
2. Atlas 1024×512 chứa 36 texture nhỏ (32–128 px) và màu của các vật liệu không có texture.
   - Mỗi texture có viền 8 px, lấy từ chính mép đối diện của nó vì texture lặp lại.
   - Hệ số màu của vật liệu được nhân thẳng vào điểm ảnh.
3. Toạ độ UV của mẫu vượt xa khoảng 0..1 (tới −5,7..12,3) và các texture đặt chế độ lặp. Cách xử lý:
   - `TEXCOORD_0` được đưa về 0..1 theo khoảng của từng primitive, để nén được.
   - `_UVT` (u0, v0, du, dv) giữ khoảng UV gốc.
   - `_CELL` (x, y, w, h) giữ vị trí ô của texture trong atlas.
   - Shader (`issPatch`) tính lại UV gốc, lấy `fract()` rồi đặt vào ô.
   - Gradient lấy theo UV gốc nên chỗ lặp không có đường nối. Mức mip bị kẹp, không thô hơn viền 8 px, để không lẫn màu ô bên cạnh.
4. `--flat` bỏ pháp tuyến rồi hàn đỉnh: 57 nghìn đỉnh còn 31 nghìn. Trang đổ bóng phẳng (`flatShading`). Đặt cạnh bản có pháp tuyến thì gần như không khác.
5. Nén quantize + meshopt, ảnh WebP q92:
   - bản `--flat`: 360 KB (gzip 213 KB);
   - bản có pháp tuyến: 685 KB.

## Số đo (đơn vị của mẫu, Y-up)

- X chạy dọc khung giàn: −0,18..14,21, dài 14,39 tính cả cánh pin.
- Y là bề dày −3,05..2,38. Nhìn từ +Y thấy khung giàn đè lên cụm module.
- Z chạy dọc cụm module −9,12..1,10, đầu Nga ở −Z.
- Khung giàn nằm ở Z ≈ −4,0, Y ≈ −0,1, tiết diện khoảng 1 × 1,6.
- Trụ đỡ gắn vào lưng phòng thí nghiệm Mỹ, ngay dưới giữa khung giàn, ở (7,0; −2,3; −4,0).

## Trong phòng

- Rộng 71 cm tính cả cánh pin. Lúc đầu là 88 cm, ngày 18/10 G cho nhỏ đi 10 % hai lần, giá đỡ nhỏ theo.
- Mặt +Y hướng vào phòng, đầu Nga ở trên. Mô hình ngả ra sau 12° để nhìn xuống mắt người xem, và xoay 18° về phía họ.
- Tâm ở (1,68; 3,51), là tâm ô G khoanh: khung kính bên phải, trên nhãn Geography.
- Giá đỡ: dùng hàm `standParts` của 747 nhân 1,215 (đế gỗ óc chó 19 × 11 cm, cần chrome). Cần cao khoảng 0,86 m tính từ nóc kệ (2,68 m).
- Có đèn trưng bày riêng: một `DirectionalLight` chỉ bật trên lớp 6, chiếu từ trên cao phía trước.
- Bắt chuột:
  - Lưới ô vuông khoảng 100 ô theo chiều dài, đánh dấu những ô mà hộp bao của tam giác chạm tới (`issVoxels`). Tia chuột đi qua lưới bằng DDA.
  - Đế và cần được kiểm tra bằng hộp bao.
