# Đồng hồ trung cổ trên kệ cao (`lib3d/world/clock.js`)

Mẫu: "Ardavin's Medieval Clock. Model Completorium" của Miguel Garcia (CC BY 4.0), lưu ở `3D Assets/interior/clock-medieval-completorium.glb`.

## Các bước

1. `python3 -I parts.py <glb> parts.pkl`: đọc GLB thành mảng (cần `../b747/glb.py`).
2. `python3 -I parts2.py parts.pkl`: tách mảnh theo chỉ số đỉnh. Một bộ phận gồm nhiều mảnh: mỗi mặt của nó là một mảnh riêng.
3. `python3 -I segment.py`: gán mảnh vào nhóm chuyển động theo vùng quanh trục → `groups.pkl`.
4. `python3 -I segment3.py`: tách tiếp kim, bánh sao, cần nhả búa, dây, đuôi búa, chuông, hai lá gạt của verge, mặt vòng số (`ring`) và phần còn lại của vòng (`ringbody`); gom các mặt bước 3 bỏ sót → `groups3.pkl`, `groups.bin` (một byte mỗi tam giác).
5. `python3 -I ghost.py`: liệt kê mảnh còn đứng yên mà nằm sát một bộ phận chuyển động. Chỉ được còn: bạc lót trong vách (4102, 3817), giá đỡ verge (2154), chốt búa (3533), chân cần (4398).
6. `python3 -I ring.py clock-tex.jpg ring.png 1024`: vẽ lại mặt vòng số (ảnh riêng, XII ở trên). `clock-tex.jpg` do bước 1 ghi ra.
7. `node make.mjs <glb> groups.bin clock.glb 0.5 ring.png`, cần `@gltf-transform` 4.2, `meshoptimizer`, `sharp`.
   - Mỗi bộ phận: một node đặt ở điểm xoay, chứa node mang lưới.
   - Khung đồng hồ: y hướng lên, trục bánh răng dọc x, mặt số hướng về −x.
   - Phần đứng yên giảm còn 50 %; bộ phận chuyển động và vòng số giữ nguyên.
   - Mặt vòng số: vật liệu `ring` với ảnh `ring.png`, UV tính từ vị trí (6,4 đơn vị từ tâm vòng tới mép ảnh).
   - Nén quantize + meshopt, ảnh vân WebP 1024.

## Tấm X-quang (`lib3d/world/clockxray.js`)

- `python3 -I xray.py` → `xray.json`: hình chiếu mặt trước của từng bộ phận thành đường viền (cần `groups3.pkl`).
- `python3 -I xray_put.py <clockxray.js>`: chép `xray.json` vào module, giữa hai mốc.
- Chạy lại cả hai sau khi đổi nhóm bộ phận hoặc điểm xoay.

## Đo cơ cấu

- `python3 -I mech.py`: in mọi số đưa vào `clock.js` (`CK.axis`, `CK.esc`, `CK.strike`) và điểm xoay trong `make.mjs`.
- `python3 -I escfilm.py`: vẽ bộ thoát theo đúng công thức của trang lên lưới thật → `esc-film.png`. Chạy lại sau khi đổi `CK.esc`.

## Số đo

- Khung xoay 8,6° quanh trục đứng (theo pháp tuyến vòng số). Mặt phẳng từng bánh lệch khung 0,7 – 1,4°, trục verge nghiêng 1,1°: trang xoay mỗi bộ phận quanh trục đo được.
- Số răng đếm trên bóng đen của từng lát cắt (FFT theo góc, rồi kiểm bằng mắt):
  - Bánh giờ 56 răng, mang kim và bánh sao 12 răng.
  - Bánh nhỏ 7 răng ở đầu trục bánh lớn quay bánh giờ.
  - Bánh lớn 56 → bánh nhỏ 7 của trục giữa. Bánh giữa 56 → bánh nhỏ 7 của trục bánh hồi.
  - Bánh hồi vương miện 25 răng.
- Suy ra: trục bánh hồi quay 512 vòng trong 12 giờ, mỗi nhịp foliot (nửa răng) 1,6875 s.
- Kim của mẫu chỉ 44,27° (1:29).
- Bộ thoát: hai lá gạt lệch nhau 22,4°; vị trí giữa của verge lùi 3,9° so với tư thế mẫu. Đỉnh răng cách trục verge 0,34 – 0,43; lá gạt vươn 0,53 – 0,56.
- Gõ chuông: bánh sao nhả cần 13 phút sau giờ chẵn trong tư thế mẫu, trang xoay bánh sao thêm 6,52° để nhả đúng giờ. Cần bị ép tối đa 6,3°, búa nâng gấp 1,33 lần. Đầu búa chạm chuông ở −1,81° so với tư thế mẫu.

## Vòng số

- Trong ảnh gốc mặt vòng số chỉ rộng 147 px, chữ cao 11 px. `ring.py`: nền lấy từ ảnh gốc (xoá chữ cũ, giữ loang màu, thêm hạt mịn), 12 số La Mã + chấm nửa giờ vẽ bằng nét có chân, đúng chỗ của mẫu: đứng dọc bán kính, đầu chữ hướng ra ngoài, số 4 là IIII.
- Tâm vòng (Y 0,335; Z 11,594), mép trong 4,707, mép ngoài 6,239.

## Bẫy

- Quantize dời node mang lưới về giữa hộp bao của lưới: điểm xoay phải là node cha.
- `segment.py` chỉ nhận mảnh nằm trọn trong lát của bộ phận: mặt nào thò ra một chút bị bỏ lại đứng yên (mặt trước bánh lớn, bánh giữa; một mặt cán búa). Kiểm bằng `ghost.py` sau mỗi lần đổi luật.
- Bánh giữa lệch tâm 0,09 so với trục của nó trong mẫu: điểm xoay lấy theo tâm vành răng.
- Mặt vòng số có nhiều mảnh vụn (1 – 15 tam giác) nằm đè lên nó với UV cũ: sót một mảnh là chữ số bị che một góc. `segment3.py` gom theo pháp tuyến + bán kính.
- Vòng số phải tách khỏi phần đứng yên (`ringbody`): giảm lưới chung thì mép vòng thò qua mặt số.
- Mẫu đặt bánh sao tuỳ ý: mấu cần lún vào răng 4,5° ở tư thế mẫu. Luật cam tính bằng cách xoay hai lưới với nhau, lấy trung vị 12 răng.
