# Đồng hồ trung cổ trên kệ cao (`lib3d/world/clock.js`)

Mẫu: "Ardavin's Medieval Clock. Model Completorium" của Miguel Garcia (CC BY 4.0), lưu ở `3D Assets/interior/clock-medieval-completorium.glb`.

## Các bước

1. `python3 -I parts.py <glb> parts.pkl`: đọc GLB thành mảng.
2. `python3 -I parts2.py parts.pkl`: tách mảnh theo chỉ số đỉnh.
3. `python3 -I segment.py`: gán mảnh vào nhóm chuyển động. Một mảnh chỉ vào nhóm khi mọi đỉnh của nó nằm trong vùng quanh trục của nhóm. Kết quả là `groups.pkl`, từ đó ghi ra `groups.bin`, một byte cho mỗi tam giác.
4. `node make.mjs <glb> groups.bin clock.glb 0.35`, cần `@gltf-transform` 4.2 và `meshoptimizer`.
   - Mỗi nhóm thành một mesh, gốc đặt trên trục quay của nó.
   - Toạ độ đưa về khung đồng hồ: y hướng lên, trục bánh răng dọc x, mặt số hướng về −x.
   - Phần đứng yên giảm còn 35 %.
   - Nén quantize + meshopt, ảnh vân WebP 1024.

## Số đo

- Khung xoay 8,6° quanh trục đứng (theo pháp tuyến vòng số).
- Số răng đếm trên bóng đen của từng lát cắt (FFT theo góc, rồi kiểm bằng mắt):
  - Bánh giờ 56 răng, mang kim và bánh sao 12 răng.
  - Bánh nhỏ 7 răng ở đầu trục bánh lớn quay bánh giờ.
  - Bánh lớn 56 → bánh nhỏ 7 của trục giữa. Bánh giữa 56 → bánh nhỏ 7 của trục bánh hồi.
  - Bánh hồi vương miện 25 răng.
- Suy ra: trục bánh hồi quay 512 vòng trong 12 giờ, mỗi nhịp foliot (nửa răng) 1,6875 s.
- Kim của mẫu chỉ 44,27° (1:29). Foliot lệch 7,5° so với vị trí giữa.
