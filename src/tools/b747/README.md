# Số đo mẫu 747-8I cho `lib3d/world/b747.js`

Mô hình 747 trên kệ Research được dựng bằng code từ số đo của `3D Assets/aviation/boeing-747-8i.glb` ("Boeing 747-8i", OUTPISTON, CC BY-NC-SA 4.0).
Không nhúng lưới hay ảnh của mẫu. Các script này đọc GLB và in ra số đo. Bảng số trong `b747.js` được chép từ kết quả, đã làm tròn và rút gọn.

Chạy từ thư mục này, truyền đường dẫn GLB làm tham số (chạy với `-I` vì GLB là tệp tải về):

- `python3 -I measure.py <glb>`
  - Cắt thân mỗi 0,5 m, cắt cánh, đuôi ngang, đuôi đứng theo sải.
  - Ghi `measure.json`: điểm cắt kèm màu sơn ở mỗi điểm.
  - Cần `tex.jpg` (ảnh sơn tách từ GLB) ở thư mục đang đứng.
- `glb.py`: đọc GLB thành mảng numpy, tách phần liền mạch (`components`).
- `texels.py`: chiếu từng texel của ảnh sơn về điểm 3D nó tô (raster tam giác UV, toạ độ barycentric).
  - Dùng để đo ranh màu đỏ, cam, trắng, hàng cửa sổ, cửa, kính buồng lái.
- `parts2.py`: liệt kê mọi phần, cắt lát (`segs`).
  - Dùng cho động cơ, giá treo, vỏ ray cánh tà, bầu bụng.

Cách khớp đã dùng:
- Mỗi lát thân là hai nửa siêu elip, chung nửa rộng và độ cao chỗ rộng nhất, số mũ riêng cho trên và dưới.
- Lát cắt được giữ lại khi nội suy tuyến tính sai quá 2 cm (Douglas–Peucker trên từng tham số), còn 37 lát.
- Hàng cửa sổ: cụm texel tối, gom thành dãy theo bước 0,508 m.
