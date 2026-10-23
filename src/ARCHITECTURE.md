# Hidden Library 3D: đo đạc và kế hoạch tách tệp

Viết ngày 13/10/2026. Số liệu đo bằng `tools/perf/` (Chrome headless, GPU M4 thật, màn 1512×900 ở 2×, trình duyệt lạnh).

## 1. Hiện trạng (đã đo)

| Hạng mục | Số đo |
|---|---|
| Thời điểm phòng hiện ra | 2,3–2,7 s (FCP 0,5–0,6 s) |
| Tổng dung lượng tải | 1,21 MB nén (giải nén 2,5 MB) |
| `lib.glb` | 621 KB (17/10: 535 KB, texture còn một nửa; ngay trước đó 722 KB) |
| three.js + addon | 167 KB + 140 KB, trong đó riêng bảng LTC của RectAreaLight là 108 KB |
| `index.html` | 144 KB nén, sau khi tách `lib3d.js` (95 KB nén) |
| Dựng phòng bằng JS | 1,3 s: texture/kệ/sách 0,47 s; cây 0,23 s; nội thất, đồ trang trí và vườn 0,56 s |
| Biên dịch shader | 0,2–0,5 s, rồi thêm 0,5–0,9 s biên dịch nền các trạng thái đèn khác (phòng đứng hình trong lúc này) |
| Số chương trình shader | 80 lúc vẽ khung đầu, 144 sau khi biên dịch nền |
| Một khung hình | khoảng 7 ms (đo ngày 12–13/10) |

**Kết luận:** với mạng nhanh, nút thắt là việc dựng bằng JS và biên dịch shader trên luồng chính, không phải tải mạng. Trên laptop yếu hơn M4 khoảng 3–4 lần, hai phần này kéo thời gian mở lên khoảng 5–8 s.

## 2. Đã làm

- **13/10:** bản Pages tách mô-đun 3D ra `lib3d.js?v=băm`.
  - Chỉ màn hình hiện phòng mới tải tệp này. Điện thoại không tải `lib3d.js`, `lib.glb` hay three.js.
  - `index.html` còn 144 KB nén; `lib3d.js` là 95 KB nén, điện thoại không tải phần này. Mỗi tệp được cache riêng.
  - Bản một tệp cho Wix vẫn nhúng thẳng như cũ.
- **13/10:** đồ trang trí trên kệ cao là 25 món khác nhau, gộp theo chất liệu thành 5 lưới. Số lượt vẽ cho phần này giảm từ khoảng 60 xuống 8.
- **17/10:** phòng hiện ở 1,3–1,4 s sau khi mở trang (trước đó 2,9–4,1 s, kèm một tác vụ chặn 0,6–1,2 s). Sau khung đầu không còn tác vụ nào dài quá 160 ms. Đo bằng `node tools/perf/marks.cjs URL`.
  - **Thứ tự dựng** (`core/build.js` main, `core/loop.js` start): phòng, sách, nội thất, đồ trang trí, đèn, giao diện, biên dịch, rồi vẽ khung đầu. Vườn (cây dựng bằng code, bãi cỏ, bụi, rừng xa) và vòm trời dựng sau khung đó, ẩn tới khi được cho vào: vườn ở 0,6 s, trời ở 1,25 s, thời tiết và chữ ở 1,9 s. Mỗi phần chỉ vào khi shader của nó đã biên dịch nền xong.
  - **Kính:** gán vật liệu từ đầu, nhưng ảnh phản chiếu phòng (6 góc nhìn) chỉ chụp khi trời đã vào (`GLASS.live`). Trước đây chụp trong main, trước khi shader biên dịch nền, nên mất khoảng 0,5 s biên dịch đồng bộ.
  - **Thời tiết:** nếu đã biết trước khung đầu thì áp ngay. Nếu biết sau, ánh sáng trời âm u chờ `precompileLightStates` xong (`REVEAL.lit`) rồi mới chuyển dần. Trời âm u bật đèn, đổi số đèn, và trước khi có shader sẵn thì mọi shader có ánh sáng phải biên dịch lại cùng lúc (khung bị giữ khoảng 0,4 s).
  - **Mèo và gà** nạp sau khi shader của vườn biên dịch xong. Gà và bóng của nó (thuộc nhóm `outside`) chỉ hiện khi vườn đã vào.
  - **Gỗ vẽ trong Worker** (`world/textures.js`): sàn, trần, gỗ sồi, khung kính, 1,6 triệu điểm ảnh, chia cho tối đa 3 Worker. Worker nhận chính mã nguồn các hàm vẽ (`Function.toString`), nên ảnh ra giống từng byte với bản cũ (đã so trong trình duyệt). Không tạo được Worker thì vẽ ngay trên luồng chính như trước. Texture `fabric` không vật liệu nào dùng nên đã bỏ.
  - **Texture trong `lib.glb` còn một nửa cạnh** (`tools/half-textures.py`, bản gốc ở `backup/lib.v5-full-textures.glb`): ảnh 1024 xuống 512, ảnh 512 xuống 256. Tệp từ 722 KB xuống 535 KB; RAM đồ hoạ cho texture từ khoảng 34 MB xuống 8 MB. Lưới meshopt giữ nguyên từng byte.

## 3. Lộ trình tối ưu (xếp theo lợi ích trên công sức)

1. **Bỏ khoảng đứng hình sau khi phòng hiện.** Biên dịch trạng thái đèn chạng vạng và đêm theo kiểu lười: chỉ biên dịch khi mặt trời còn cách mốc đổi đèn khoảng 3°, hoặc khi người xem bấm công tắc ngày/đêm. Không biên dịch ngay lúc mở trang.
2. ~~**Nướng sẵn texture thủ tục khi build.**~~ Đã làm theo cách thay thế ngày 17/10: vẽ trong Worker, song song lúc dựng phòng (mục 2).
   - Còn lại trên luồng chính: giấy và búi thảm (`world/rug.js`), cỏ ngoài vườn (`world/outside.js`, sau khung đầu).
3. **Nướng sẵn hình học tĩnh vào GLB khi build.** Gồm pouf, thảm, AO tiếp xúc và vỏ nhung, ước tính tiết kiệm 0,2–0,3 s.
   - Mã sinh vẫn giữ trong `tools/` để sửa và nướng lại.
4. **Gộp vật liệu theo lớp hoàn thiện,** như đã làm cho đồ trang trí. Số shader và số lượt vẽ cùng giảm.
5. **Giảm byte tải:**
   - Mô hình máy hát của trang (`tt-asset`, 95 KB nén, số thực đầy đủ chữ số): lượng tử hóa sang nhị phân, ước tính 25–30 KB.
   - Bảng LTC: chuyển sang half-float nhị phân, ước tính 32 KB.
   - Tùy chọn: three.js tự đóng gói và lọc bỏ phần thừa bằng esbuild, ước tính khoảng 110 KB.
6. **Lần mở sau:** dùng service worker cache-first cho các tệp có `?v=băm`. GitHub Pages chỉ cho `max-age=600` (10 phút), nên sau đó trình duyệt luôn phải hỏi lại máy chủ.

Ngân sách đề xuất, kiểm bằng `build.py --check`:
- Tải đầu ≤ 1,3 MB.
- Phòng hiện ≤ 2,5 s trên M4.
- ≤ 16 ms/khung.
- ≤ 300 lượt vẽ.
- ≤ 100 chương trình shader lúc mở trang.

## 4. Mã nguồn chia mô-đun (đã làm 13/10, bước 1)

`library3d-bg.js` (3.130 dòng) đã được tách thành 40 mô-đun ES trong `src/lib3d/`. Bản cũ nằm ở `backup/library3d-bg.v7-before-split.js`.

```
lib3d/main.js          ghi thứ tự dựng; import mô-đun cuối
  core/   base.js (DOM, R, REF, tick)   utils.js (rng, noise, canvas…)   renderer.js   views.js (camera)
          build.js (main: dựng phòng)   loop.js (draw, loop, start, biên dịch shader)
  world/  textures materials room books shelves pouf rug furniture (đèn bàn, đèn cây, đèn treo bóng sợi đốt pendantLamp: dựng theo số đo mẫu CC BY) bush (bụi cây ngoài kính: thẻ chùm lá quay về người xem, pháp tuyến theo khối bụi, alpha-to-coverage) outside lights trees assets wind velvet furnish
          decor/{kit, atlas, items, build}.js   cat.js (thân mèo: tư thế, lò xo, IK, dáng đi)   fur.js (lông: 20 lớp shell, ánh sáng nướng trong không gian texture)   pets.js (tập tính mèo, gà, lớp vẽ sắc nét)   b747.js (mô hình 747-8 trên kệ Research, dựng từ số đo; viền chọn, bấm mở link)   clock.js (đồng hồ trung cổ trên kệ cao: bánh răng theo giờ thật, chuông mỗi giờ; bấm vào thì bay ra to gấp 3, tách rời từng bộ phận có tên)   iss.js (mô hình ISS trên nóc kệ Geography: một mesh + atlas, viền chọn, bấm mở trang iss-station)
  fx/     dust post (màu nước: Kuwahara tổng quát, loang ướt ở mảng lá, sàn gỗ vẽ nhẹ tay hơn, FXAA) night hour (mặt trời, lấy từ `window.HL_SUN`) glass (kính: phản chiếu phòng bằng cubemap hiệu chỉnh thị sai, Fresnel, bụi, vệt sáng chéo) rain (mưa theo thời tiết thật Pleiku: vệt mưa ngoài kính, nước bắn trên sân, giọt nước đọng và chảy trên kính khúc xạ hình phía sau, trời u ám, chớp khi dông; ?wx=rain|drizzle|storm) star-catalog (danh mục sao Yale BSC5, 2887 sao) sky (trời sắp đặt: Ngân Hà xoay vào góc kính trái cạnh trăng ở góc nhìn đầu, SKYSET; ?sky=real: trời thật theo giờ sao tại nơi người xem (`HL_SUN.place`); sao chổi sau trăng, sao băng trước trăng; dò chỗ thấy trời trên GPU, probeSky) fireflies
  ui/     library sections hero-books (sách lấy ra: bìa cứng dựng như thợ đóng sách, gáy tròn, rãnh bản lề, ruột lùi vào, vân trang, headband, chữ dập; áo sách bóng; đèn chính riêng; giữ tối đa 5 cuốn) leaves (sách đọc được, 17/10/2026: ghi chú [Mô hình kinh tế] thành sách; mở ra trang tiêu đề + mục lục, mỗi nước một trang đôi, tờ giấy lật trong shader quanh bản lề bìa, chữ tự co cho vừa 2 trang; bấm mục lục/chip trong thẻ để lật tới, trang phải lật tiếp, trang trái lật lui) words (tên trên gáy sách ở kệ, bầu trời) flight deck overlay picking hooks (__lib3d, khởi động)
```

### Quy ước

- **Thứ tự dựng.** Dòng đầu của mỗi mô-đun là `import './<mô-đun trước>.js';`. `main.js` import mô-đun cuối.
  - Nhờ vậy các mô-đun luôn chạy đúng thứ tự cũ, dù chúng import qua lại nhau. Một mô-đun được gọi hàm của mô-đun sau, vì hàm chỉ chạy khi tất cả đã nạp.
  - Thứ tự này quyết định id của vật thể, nên quyết định thứ tự vẽ các mặt cùng độ sâu. Nó cũng quyết định thứ tự rút dãy số ngẫu nhiên chung.
- **Biến dùng chung bị ghi từ mô-đun khác** phải qua setter, vì biến import chỉ đọc được: `setNeeds`, `setShadowsDirty`, `setRtScale`, `setReady`.
- **Tên cấp cao nhất phải khác nhau giữa các mô-đun**, vì bản phát hành ghép chúng vào một phạm vi. `build.py` chạy `node --check` để bắt tên trùng.
- **Import viết trên một dòng**, đường dẫn tương đối, không `?v=`.

### Mô hình 747 trên kệ Research (`lib3d/world/b747.js`, 17/10/2026)

- Hàng giữa (hàng 4) của ngăn trái kệ thấp sau lưng (ngăn Economy):
  - Sách ngẫu nhiên của ngăn vẫn được xếp rồi cất đi (`B7_CELL` trong `shelves.js`), nên chuỗi số ngẫu nhiên của các ngăn khác giữ nguyên.
  - Đầu trái ngăn có một hàng sách riêng dài 40 cm (`rowOfBooks` trong `books.js`, dùng bộ số ngẫu nhiên riêng, hạt giống 747), cuốn cuối dựa nghiêng.
- Bên phải hàng sách là mô hình Boeing 747-8I tỉ lệ 1:154 (dài 48 cm; 1:200 phóng to 30 %), đứng trên đế gỗ óc chó với trục mạ crôm.
  - Máy bay ngóc mũi 6°, quay 22° về phía phòng.
  - Sải cánh 45 cm lớn hơn chiều sâu kệ 36 cm, nên phía sau áp sát kính, đầu cánh gần chìa qua mép kệ khoảng 6 cm.
  - Chỗ đặt tính bằng hộp bao chính xác `setFromObject(holder, true)`. Hộp bao theo mesh của vật đã xoay phình to và đẩy máy bay ra quá xa.
- Dựng bằng code từ số đo mẫu `3D Assets/aviation/boeing-747-8i.glb` (OUTPISTON, CC BY-NC-SA 4.0). Chỉ lấy số, không nhúng lưới hay ảnh:
  - thân: 37 lát cắt, mỗi lát hai nửa siêu elip, sai số dưới 2 %;
  - cánh, đuôi ngang, đuôi đứng: mặt bằng, độ cao, tỉ lệ dày. Nhị diện cánh 6° phía trong động cơ trong, 2,8° phía ngoài;
  - vỏ động cơ GEnx-2B, giá treo, vỏ ray cánh tà, bầu bụng nối cánh;
  - sơn: chiếu từng texel của mẫu về toạ độ 3D, rồi đo ranh bụng đỏ theo chiều dọc thân, chỗ bắt đầu màu cam ở đuôi, hàng cửa sổ (tầng chính 1,65 m, tầng trên 4,29 m, bước 0,508 m), cửa, kính buồng lái, và bảng màu.
- Sơn là kiểu sơn ngày ra mắt 747-8, chỉ dùng màu, không chữ, không biểu tượng.
- Vẽ sắc nét đè lên tranh như con mèo:
  - qua `crispPass` của `pets.js`, trên lớp riêng 4, dùng đèn của phòng, bị che ở chỗ phòng gần hơn;
  - hiện dần trong 0,6 s khi shader đã biên dịch xong;
  - khi rê chuột, `sharpQuad` vẽ viền chọn (`P.outline`): nét trắng 2 px CSS, ngoài là quầng tối mờ 1,6 px, theo kiểu `.l3-outline` của trang.
- Bắt chuột bằng một bản thô vô hình (`PLANE.hit`, khoảng 2 nghìn tam giác). Nó được kiểm sau các sách đang mở, trước mặt phẳng của ngăn. Bấm vào thì mở `PLANE.url` trong tab mới.
- Góc nhìn gần của ngăn có máy bay khung cả hàng 4 (`slotBox` → `viewY`, `viewH`).
- Dựng sau khi vườn biên dịch xong. Trên M4: hình và sơn 24 ms, phần còn lại 8 ms, biên dịch song song khoảng 90 ms. Mốc thời gian: `l3-plane-start`, `l3-plane-model`, `l3-plane-built`, `l3-plane`.
- Script đo nằm ở `tools/b747/` (README ở đó).

### Đồng hồ trung cổ trên kệ cao (`lib3d/world/clock.js`, 17/10/2026)

- Hai ô của kệ cao gộp làm một: cột thứ 4, hàng 6 và 7 (`CLOCK_CELL` trong `shelves.js`).
  - Tấm ngăn giữa hai ô bị cắt khỏi cột đó.
  - Đồ trang trí của hai ô (đèn lồng, chồng đá) vẫn được chia bài và dựng như cũ để giữ chuỗi số ngẫu nhiên, nhưng không được thêm vào cảnh (`d.skip`).
- Mẫu "Ardavin's Medieval Clock" (Miguel Garcia, CC BY 4.0), file `clock.glb` 815 KB. Cao 74,8 cm (`CK.height`; lúc đầu 68 cm, G cho to thêm 10 %).
  - Có 7 phần: tĩnh, mặt kim, trục bánh lớn, trục giữa, trục bánh hồi, verge + foliot, búa.
  - Được vẽ sắc nét qua `crispPass`, trên lớp riêng 5, không màu nước.
- Kim chỉ giờ máy người xem. Mọi bánh quay theo tỉ số đếm trên mẫu, tính từ tư thế gốc nên răng luôn ăn khớp: mặt kim +1, trục bánh lớn −8, trục giữa +64, bánh hồi −512 vòng cho mỗi vòng kim.
- Bộ thoát verge:
  - Bánh hồi 25 răng nhích nửa răng mỗi nhịp 1,6875 s.
  - Trong một nhịp: đi tới trong 60 % đầu (lên 1,1), rồi giật lùi về 1,0 ở cuối.
  - Cả bộ bánh phía sau đi theo đúng tỉ số. Foliot lắc ±32°.
- Đầu mỗi giờ, búa gõ đúng số giờ (1–12): nhấc lên 0,62 s, rơi 0,09 s, nảy nhẹ, mỗi tiếng cách nhau 1,9 s.
- Tiếng chuông tổng hợp bằng Web Audio, gồm 9 bội âm kiểu chuông nhỏ, mỗi bội âm hai dao động lệch nhau 1,2 Hz, cộng tiếng búa.
  - Chỉ kêu sau khi người xem đã chạm vào trang lần đầu (luật trình duyệt). Không kêu khi tab đang ẩn.
  - Giờ được canh mỗi giây (`setInterval`).
- Cách tách bộ phận: xem `tools/clock/README.md`.
- Rê chuột lên đồng hồ thì hiện viền chọn như 747 (`clockHit`: tia chuột với hộp của nó, trong hệ toạ độ của nó).
- Bấm vào thì đồng hồ bay ra khỏi kệ (`openClock`, `stepClock`, `ckPlace`, `drawInspect`):
  - Bay 0,85 s ra giữa phần màn hình bên phải sidebar, scale 3D gấp 3 (`CK.big`). Khoảng cách camera tính để cả cụm (khi ráp hay khi tách, nội suy `CLOCK.span`) vừa khung.
  - Phòng tối lại (quad 0,78). Đồng hồ vẽ bằng `bigPass` vào target riêng, không bị phòng che (`uRoomDepth` = 0), có hai đèn riêng trên lớp 5 (key 2,6 bên trái trên, fill 1,1 bên phải).
  - Sau đó tách rời trong 1,1 s (`CK.apart`, đơn vị của mẫu): kim + bánh giờ ra trước và sang trái, ba trục bánh sang phải, verge lên trái, búa lên trên.
  - Đồng hồ vẫn chạy đúng giờ khi tách. Để yên 4 s thì lắc nhẹ ±0,32 rad, chu kỳ 18 s. Kéo để xoay.
  - Bấm vào bộ phận (hộp chiếu của từng phần, `V.rects`) để ráp/tách. Bấm ra ngoài, nút × hoặc Esc thì bay về kệ (ráp lại trước rồi mới bay).
- Nhãn tên song ngữ (`ckLabels`):
  - Mỗi nhãn chọn 1 trong 4 chỗ quanh hộp chiếu của bộ phận (trên, phải, dưới, trái), chấm điểm theo phần đè lên nhãn khác, bộ phận khác, mép màn hình. Có ưu tiên giữ chỗ cũ để nhãn không nhảy.
  - Có đường mảnh nối từ nhãn tới trục của bộ phận.
  - Hộp của bánh răng lấy tròn quanh trục (`ckPartBox`) để nhãn không rung khi bánh quay.
  - Chỉnh bố cục từ console: `__lib3d.CLOCK.CK.apart`, rồi `CLOCK.reSpan()`.
- Mèo to thêm 10 % (`CATR.scale` 1,375 → 1,5125), vết lún nệm và độ chìm khi nằm đêm tăng theo.

### 747 to thêm 20 % (`lib3d/world/b747.js`, 18/10/2026)

- Tỉ lệ 1:128 (`B7_SCALE` = 1,3 × 1,2 / 200), dài 58 cm, sải cánh 54 cm. Giá đỡ to theo (`B7_STAND` 1,2, cần 18 cm).
- Đỉnh đuôi cách tấm kệ trên 5 cm. Đầu cánh gần thò ra trước mép kệ khoảng 16 cm.
- Đế gỗ (dùng chung với ISS):
  - Góc bo 14 đoạn. Pháp tuyến làm mịn quanh góc bằng `toCreasedNormals` với góc gãy 20°.
  - Lớp sơn bóng mờ hơn (clearcoat 0,4, độ nhám 0,5).
  - Trước đó đèn sàn cạnh kệ chiếu sáng từng mặt phẳng ở góc bo, hiện thành một ô vuông màu be trên mép đế.

### Đèn cây quay về sofa, tên RESEARCH/BOOKS kiểu màu nước (18/10/2026)

- Đèn cây ở góc sau bên phải (`furnish.js`):
  - Xoay `rotation.y` từ −0,15 thành 1,0 để chao đèn treo trên phần ghế bên phải sofa, ở (1,56; 2,0; −7,4). Trước đó cánh tay chạy dọc kệ, chao đèn lẫn vào sách.
  - Cánh tay đối trọng ngắn lại 16 cm (`floorLamp(back)`), nếu không quả đối trọng đâm vào kệ phía sau. Giờ còn cách mặt kệ 2 cm.
  - Chao đèn được đặt lại hướng theo hệ toạ độ thế giới: chúc xuống, hơi nghiêng ra phòng như đèn đọc sách. Đèn spot và đèn điểm trong chao đi theo.
- Hai chữ `.l3-cap` (RESEARCH, BOOKS):
  - Bộ lọc SVG `#l3-wc` (`overlay.js`):
    - một bản sao chữ có mép loang (turbulence 0,05 + displacement 4 px + blur 0,6);
    - màu mỏng dày theo mảng (turbulence 0,11 điều khiển alpha), mép đậm hơn (erode 0,7);
    - trộn 30 % lên chữ gốc (`feComposite` arithmetic 0,7 / 0,3).
  - Rê chuột hiện quầng sáng ấm `--cap-glow`. Ban ngày là quầng kem quanh chữ đen, ban đêm là quầng vàng quanh chữ kem. Chuyển đổi trong 0,35 s.

### Bóng đèn treo toả sáng động (`lib3d/fx/glow.js`, 18/10/2026)

- Một tấm quay mặt về camera đặt ở kính bóng đèn, kéo về phía mắt 7 cm, cộng sáng (additive) trong `OVER.scene` như đom đóm. Nó được vẽ cùng lớp sắc nét (30 khung/giây), không bắt phòng (đã tô màu nước) vẽ lại.
- Bị che bởi những gì phòng đặt phía trước (so với `uDepth`).
- Nhịp:
  - "Thở" bằng hai sóng chậm 3,8 s và 6,1 s, nên không bao giờ lặp y hệt.
  - Mức sáng "vừa đủ" (G, 18/10): vòng sáng quanh bóng sáng hơn bản tô màu nước khoảng 1/4 (đo 44,6 → 54–63), lõi khoảng 200–220 trên 255, không cháy trắng. Cỡ quầng to/nhỏ 8 %.
  - Bản đầu sáng gấp khoảng 2,5 lần mức này và làm kính cháy trắng.
  - Lung linh rất nhẹ 3 %.
  - Gồm lõi trắng ấm, quầng hổ phách và một lớp toả rộng (lớp này phồng nhiều nhất theo nhịp thở).
- Chỉ bật khi bóng đèn sáng. Độ sáng đọc từ độ mờ quầng sáng của chính bóng đèn mà `hour.js` đặt (0 ban ngày).

### Sách khu vườn 3D trên pouf (`lib3d/world/gardenbook.js`, 18/10/2026)

- Cuốn sách nằm trên cùng chồng sách trên pouf (`LIGHTS.gardenBook`, tức b2 trong `furnish.js`) được dán bìa là ảnh G chụp khu vườn 3D (`garden-cover.webp`, 1024 px).
  - Bìa là một mặt phẳng phủ trên mặt sách. Ảnh được cắt cho khớp tỉ lệ bìa.
- Sách được vẽ sắc nét trên lớp 7, rê chuột hiện viền trắng, bấm thì mở https://michaeltran75.github.io/3d-garden/ trong tab mới.
- Bắt chuột bằng hộp bao của sách.

### Sách đang phát: mở ra đọc tóm tắt (18/10/2026)

- Sách đang phát (`UIS.active`) bay ra trước camera như cũ.
  - Bấm vào sách: `startReading` (`flight.js`) tải `summaries/books.json` (`loadSummaries`), dựng các tờ lật (`heroRead`, `hero-books.js`), rồi mở bìa như atlas.
  - Trước đây bấm vào sách là đóng player và sách về kệ.
- Bố cục sách tóm tắt (`R.over`, `leaves.js`):
  - Trang 1 là tổng quan (`paintOverview`).
  - Sau đó các phần chạy liền qua các trang (`flowAll`, `paintFlow`), ghi chú hộp thoại của trang nối sau.
  - Số trang đôi lấy theo thứ tiếng dài hơn (`R.S`).
  - Khoảng cách sách tới camera tính sao cho trang đôi chiếm khoảng 92 % phần màn hình còn trống bên phải thẻ (`openPose`).
- Thao tác:
  - Bấm trang phải để lật tới, trang trái để lật lại.
  - Bấm bìa, hoặc bấm qua trang cuối, thì sách gập (`stopReading`) và vẫn phát.
- Dừng phát: `wantOf` trả về 'shelf' khi mục đang phát mất class `is-playing`/`is-loading`, nên sách về kệ; phát tiếp thì sách bay ra lại. `syncActive` đánh dấu sách mỗi lần class đổi.
- Mục có audio mà không có tóm tắt:
  - có hộp thoại ghi chú thì mở ở mục lục như sách ghi chú;
  - không có ghi chú thì chỉ có trang tên, tác giả, số trang.
- Nội dung và cách dựng lại: `tools/summaries/README.md`.
- Kiểm tra bố cục: `__lib3d.readCheck()`.

### Kệ sách và sách thật hơn khi xem gần (18/10/2026)

Dựa theo cấu tạo sách bìa cứng (bìa 2–3 mm, bìa thừa ra quanh khối trang ~3 mm, khối trang lùi vào, gáy tròn, vải bọc có thớ, chữ mạ vàng/mực/nhãn giấy, gờ da nổi trên gáy) và kệ gỗ thật (cạnh ván bo tròn bắt sáng, lòng ô tối dần vào trong).

- Sách trên kệ (`books.js`):
  - `bookGeometry()`: hai bìa cứng, khối trang lùi vào ở đầu, chân và mép trước, gáy cong. Đơn vị tính theo hộp đơn vị mà instance co giãn.
  - Atlas 2048×1024, 32 ô 64 px:
    - ô 0–27: 28 gáy, 7 kiểu (mạ vàng trên vải, nhãn giấy, gờ da nổi, áo sách hiện đại, đầu/chân sẫm, mực trên vải, bìa mềm). Chữ chạy từ trên xuống như gáy sách Anh;
    - ô 28: vải trơn;
    - ô 29–30: khối trang;
    - ô 31: gáy sách thật, chỉ có vạch ép, không chữ.
  - Atlas cũng làm `bumpMap` (0,7).
  - Shader làm tối ở chân sách và sâu trong kệ (`vBk`), đầu sách hơi phai.
  - Sách thật của các mục dùng ô 31 (`titledSpine`, gọi từ `sections.js`), để tên thật (`words.js`) không chồng lên chữ giả.
  - Atlas vẽ trong Worker trên OffscreenCanvas (`spineAtlas`); không có Worker thì vẽ ở luồng chính (`spinesHere`, ~75 ms).
    - Trong lúc chờ, sách mặc vải trơn (`plainCloth`).
    - `main` (`core/build.js`) gắn atlas (`setSpineAtlas`) trước khung hình đầu.
    - `drawSpines` không được dùng gì của mô-đun ngoài `rng`, vì Worker chạy từ mã nguồn của nó.
- Kệ (`shelves.js`):
  - Mọi ván bo cạnh 4 mm (`boardGeo(..., round)` dùng `RoundedBoxGeometry`; uv theo mặt để vân gỗ không vỡ ở cạnh bo).
  - Màu đỉnh tối dần về phía sau ô (`CAVE` 0,5); mặt dưới ván ×0,8.
  - `MAT.shelfOak` có bumpMap gỗ (1,2), roughness 0,58.
- Màu nước bớt đi ở các góc nhìn gần (`fx/post.js`):
  - `paintLightly(obj, k, kClose)` cùng uniform `POST.light.close`, chuyển 0 → 1 trong 1,2 s (`flight.js stepBooks`).
  - Sách 0,2 → 0,95 (lúc đầu 0,8; G 18/10 bớt thêm 75 % phần còn lại), ván kệ 0,1 → 0,85.
  - G 18/10, "kệ sách và toàn bộ sách 10% less water color", bớt thêm 10 điểm ở góc nhìn phòng:
    - sách 0,1 → 0,2: sách trên kệ, trên bàn, trên pouf, cùng sách trong đồ trang trí, vốn tách thành mesh riêng `fin: 'book'` (`decor/kit.js`, `decor/build.js`, kể cả chồng sách `bookPile`);
    - ván kệ 0 → 0,1 (gần: 0,75 → 0,85);
    - lưng kệ (`shelves.js`, `room.js`) 0 → 0,1.
- Kiểm tra: `node tools/shelves/closeups.cjs cv 13:00` chụp Research, Books và một mục mỗi bên.

### Màu trắng thành #E2D6C0, bóng đèn 50 % màu nước (18/10/2026)

- G: "em thay tất cả màu trắng thành #E2D6C0". #E2D6C0 là màu giấy của trang (đã dùng cho `--halo`, `--card-open`, màu nhấn ban đêm).
- Đã đổi:
  - CSS trang (`hidden-library.base.html`): mọi `#fff`/`rgba(255, 255, 255, a)`, và chữ ban đêm `--ink`.
  - CSS phòng (`build.py`):
    - `--on-accent`;
    - nền nhãn, thẻ, gợi ý, tên bộ phận đồng hồ (trước là `rgba(246, 240, 228, a)`);
    - viền chọn SVG, chấm đường nối;
    - chữ ban đêm `#f3ead9`/`#f1e9d8`, đường mảnh ban đêm `rgba(255, 240, 215, a)`.
  - Rê chuột trên dòng/chip của thẻ (nền sáng) giờ tối đi `rgba(60, 45, 25, .07–.09)`. Nếu dùng beige thì trùng màu nền thẻ, không thấy.
  - 3D:
    - sách trắng của `PAL.modern`;
    - nhãn giấy, áo sách, chữ sáng trên atlas gáy;
    - mực sáng `INK_LIGHT` và dải dưới tên sách (`hero-books.js`, `words.js`);
    - viền chọn quanh vật (vòng trong shader `pets.js`, `deck.js`): `vec3(0.886, 0.839, 0.753)`.
- Giữ nguyên:
  - mặt trời, trăng, mây trên đồng hồ trời;
  - các quầng sáng (chữ RESEARCH/BOOKS, bóng đèn);
  - màu thật của vật (747, ISS, máy hát);
  - giấy trang sách.
- Bóng đèn treo: `paintLightly(pd, 0.5)`, tức 50 % màu nước (trước đó 0,875, còn 12,5 %).

### Sofa: bớt 30 % màu nước, vải nhung có dấu dùng (18/10/2026)

- G: "make the sofa less water color 30%; do research and improve the texture, detailing".
- Màu nước: `paintLightly(sofa, 0.3)`, cả gối tựa (nằm trong `F`, ngoài nhóm sofa) và gối ống.
- Căn cứ:
  - Hướng dẫn chăm sóc nhung của các hãng: tuyết đổ một chiều nên sáng/tối khác nhau; chỗ ngồi và tay vịn bị đè tuyết trước; ghế ghép module lệch sắc độ ở đường nối.
  - Ghi chú CGI nội thất của Maverick Frame: đệm sạch phẳng lì thì giả; đệm thật có lõm nông và nếp mềm ở mép trước; viền ống phải nổi, có rãnh bóng.
  - Thợ bọc nệm: vải dồn thành nếp ở góc đệm.
- `velvet.js`:
  - `nap`/`wear` bật define `VELVET_NAP`/`VELVET_WEAR`.
  - Hình học mang `aCB`/`aCY` (`setNap`): hộp của từng phần (không gian vật) và độ "nằm" của tuyết.
- `wearH` (chỉ đệm ngồi):
  - lõm ngồi sâu 1,1 cm, hơi lệch về trước, tuyết bị đè (`vWorn` → `vCrush`, màu +5 %);
  - nếp cuộn dưới viền trước;
  - nếp chùng ngang nhẹ;
  - nếp xoè ở hai góc trên, mặt trước và mặt hông, tắt trong ~11 cm.
- Bỏ nếp xếp dọc (`pleat` 0) trên đệm ngồi, vì nhìn như sọc vải nhung kẻ hoặc vết sơn chảy. Viền ống `seam` 1,4.
- `NAP` trong `furnish.js`: mỗi module 0,9–1,07, nhân vào sheen và 30 % vào màu.
- Ảnh kiểm tra: `sofa.cjs` (thư mục test, chụp sofa trên cửa sổ 2880×1800).

### Bộ nhớ: đo và giảm (19/10/2026)

G: "em đo xem có thể giảm ram xuống đc ko?".

- Cách đo (thư mục test):
  - `mem.cjs` móc vào các lệnh WebGL để cộng texture, buffer, renderbuffer, kèm tên hàm đã cấp phát;
  - `cpumem.cjs` cộng các bản sao CPU;
  - phys footprint (`footprint <pid>`, đúng chỉ số Activity Monitor hiển thị) của tiến trình trang và tiến trình GPU, sau khi ép GC.
- Trước khi giảm, ở 1512×945, DPR 2, ban ngày:
  - tiến trình GPU 1550 MB;
  - tiến trình trang 848 MB;
  - heap JS 91 MB;
  - GL đếm được: texture 194 MB, renderbuffer 116 MB (MSAA), buffer 27 MB;
  - bản sao CPU: ảnh 65 MB, hình học 27 MB.
- Đã làm:
  - `releaseSources` (`core/loop.js`), chạy sau `l3-precompiled`:
    - đưa mọi texture tĩnh lên GPU (`initTexture`) rồi bỏ bản CPU: đóng bitmap, thu canvas về 1 px, bỏ mảng điểm ảnh;
    - ảnh vẽ lại (sách bay ra, trang sách, tên trên gáy) mang `userData.keep` (`heroCanvasTex`, `words.js`);
    - giải phóng khoảng 65–72 MB.
  - PMREM của môi trường phản chiếu (`lights.js`): `pm.dispose()`.
  - MSAA 4 → 2 cho hình chính (`POST.rt`) và các lớp sắc nét (`pets.js`, `clock.js`, `deck.js`). Ảnh so 4/2 gần như y hệt.
- Sau (đã có thêm máy ảnh và tạp chí):
  - tiến trình GPU 1414 MB (−136);
  - tiến trình trang 839 MB (máy ảnh mới thêm khoảng +30);
  - heap JS 74 MB.
- Độ nét theo loại (G 19/10: "giảm độ nét của cây cối xuống 1, và giảm tất cả xuống 1,5 riêng chữ thì vẫn để 2"):
  - Canvas giữ DPR 2 cho chữ (tên trên gáy, trang sách khi đọc; `SHARP.book.dpr` 2).
  - Các lớp sắc nét (mèo, gà, 747, ISS, đồng hồ trên kệ, tạp chí, máy hát) vẽ ở 1,5 (`crispPass` k = 1,5 / pr; `deck.js`):
    - tra độ sâu qua `uFull`/`uOff` nhân k;
    - viền chọn giữ bề rộng trên màn hình nhờ `uRk`.
  - Cây cối: texture lá, bụi, rừng xa vẽ đủ cỡ rồi thu một nửa (`halfCanvas`). Bản thân cây nằm trong hình màu nước, vốn chỉ ~0,8 px mỗi px CSS.
  - Kết quả đo ở tầng GL (ổn định giữa các lần chạy):
    - texture 194 → 178 MB;
    - renderbuffer 116 → 56 MB;
    - tổng GL khoảng −77 MB so với ban đầu.
  - Phys footprint của tiến trình GPU dao động ±70 MB giữa các lần chạy, nên không dùng được để đo các thay đổi nhỏ.
- Đợt 3 (G 19/10: "tiếp tục giảm độ nét của toàn bộ cây" cùng danh sách còn lại):
  - Texture cây còn 1/4: ô lá 384×256, bụi 256, rừng xa 512×64; ảnh nhỏ (256) còn 1/2. Nhìn gần như không khác, vì lớp màu nước làm mềm sẵn.
  - Bóng nắng 2048 → 1536 (`lights.js`).
  - `sweepCrisp` (`pets.js`): target của lớp sắc nét nào khuất khung hình 5 s thì giải phóng, hiện lại thì cấp lại. Áp dụng cho:
    - mọi `crispPass`;
    - `bigPass` của đồng hồ (`crispSeen`);
    - máy hát (`DECKR`).
  - `releaseGeometry` (`loop.js`, ngay sau `releaseSources`):
    - vẽ một lượt cả lớp phòng không cắt khung vào target 1 px để mọi hình học đã lên GPU;
    - rồi làm rỗng mảng normal, uv, color trên CPU;
    - giải phóng khoảng 4,7 MB; heap JS 75 → 51 MB.
  - Tầng GL sau cả ba đợt: texture 165 MB, renderbuffer 51 MB.
- Còn có thể làm:
  - DPR tối đa 2 → 1,5: ở DPR 1 tiến trình GPU còn 1351 MB, nhưng chữ và lớp sắc nét bớt nét;
  - tắt hẳn MSAA: −150 MB, nhưng cạnh bị răng cưa;
  - giải phóng target của lớp sắc nét khi vật ra khỏi khung hình;
  - bóng nắng 2048 → 1536.

### Máy ảnh cổ trên kệ cao (`lib3d/world/camera.js`, 19/10/2026)

- Asahi Pentax H2 (CC BY 4.0), đặt ở ô của đồng hồ để bàn, màu nước 10 %. Cách dựng: `tools/camera/README.md`.
- `camera.glb` nhúng như `iss.glb`: base64 trong trang một file, `data-src` trên Pages.
- Rê chuột thì hiện viền; bấm thì xem cấu tạo, giống đồng hồ (G 19/10: "cho chuột hover vào máy ảnh to show white border line; click vào thì show 3D structures"):
  - Máy ảnh vẽ trên lớp 8 bằng `crispPass`, `paint` 0,1 (giữ 10 % màu nước), kèm phép thử độ sâu `vcPatch` khi ở trên kệ. Vì lớp này không nằm trong bóng của phòng, dưới máy có một mảng bóng mềm.
  - Bấm vào: máy bay ra trước camera, to ×3, phòng tối đi, ngửa 0,32 rad để thấy nóc máy (`vcPlace`). Khi đó vẽ bằng `VCAM.PI`, 1,25 px mỗi px CSS.
  - Tách thành 8 nhóm (`VC_PARTS`): ống kính ra trước, thị kính ra sau, núm tua phim, cần lên phim, núm tốc độ và nút chụp lên trên, bao da xuống dưới, thân máy đứng yên. Mỗi chi tiết dời trong khung của cha nó (`pieces[].d`).
  - Tên bộ phận theo thông số Pentax H2 (1959): một núm tốc độ 1 s – 1/500 s, cần lên phim gạt nhanh có bộ đếm, nút chụp trên nóc, không có hẹn giờ, ngàm M42, màn trập vải, gương lật, lăng kính.
  - Nhãn và đường nối dùng lại CSS của đồng hồ (`.ck-out-ui`, `.ck-name`, `.ck-lines`, `body.ck-out`).
  - Thao tác: kéo để xoay, bấm vào máy để tách hoặc ráp, bấm ra ngoài / Esc / × để cất về kệ. Phần nối vào trang: `picking.js` (`camHit`, `camPointer`), `loop.js` (`stepCamera`), `words.js` (`drawCamera`, `drawCamInspect`).

### Tạp chí khu vườn 3D trên pouf (`furnish.js` `magazine`, 19/10/2026)

- Cuốn sách khu vườn thành tạp chí to gấp đôi, dày 6 mm (G: "em cuốn sách này thành tạp chí mỏng to x2").
- Lưới 31×25 điểm, mỗi điểm bắn tia xuống pouf và hai cuốn sách. Lấy đỉnh cao nhất trong ~6 cm để giấy không chui vào nếp nhỏ, rồi nới 160 vòng: kéo về trung bình các điểm bên cạnh, cho võng 0,3 mm mỗi vòng, nhưng không thấp hơn mặt bên dưới.
- Bìa (nhóm 0) nhận ảnh khu vườn cắt theo tỉ lệ (`gardenbook.js`, `userData.cover`). Viền chọn, nút bấm mở 3d-garden và lớp 7 giữ như cũ.

### Mở trang theo từng phần, thanh tải có % (20/10/2026)

- G: "add % load cho loading bar at foot note ... cho căn phòng lần lượt load ... frame, kệ sách, sofa, rồi sách lần lượt hiện ra (fade in) ... sau đó mới load các đồ trang trí ... Text phải đc ẩn và chỉ đưa vào khi các thứ tự dc load xong".
- Thanh tải (`#lib3d-loader` ở chân trang):
  - gồm vạch và số %. Trước khi script chạy, vạch nhích chậm bằng CSS; sau đó `setLoad` (`core/base.js`) đếm theo từng bước dựng (`STEP_PCT` ở `core/build.js`) và theo các byte của `lib.glb` khi tải từ Pages;
  - các phần hiện ra đưa vạch từ 60 lên 100 %;
  - tới 100 % thì `html.l3-loaded` làm thanh mờ đi, rồi bỏ `l3-loading`.
- Trình tự (`core/loop.js` `start`):
  1. Hình đầu chỉ có khung phòng. Kệ (`PARTS.shelves`, gồm cả các tấm lưng), nội thất (`PARTS.furniture`, máy hát `DECK.hidden`) và sách (`booksMesh`) đã được dịch shader từ trước nhưng bị ẩn.
  2. Lần lượt hiện kệ (0,45 s), nội thất (0,95 s), sách (1,45 s).
  3. Sau đó dựng vườn rồi hiện vườn, rồi trời.
  4. Tiếp theo: các mô hình (747, ISS, đồng hồ, máy ảnh, tạp chí), rồi mèo và gà, rồi đồ trưng bày. Đồ trưng bày dựng ẩn, dịch shader xong mới hiện (`buildDisplays`).
  5. Cuối cùng mới hiện chữ (`reveal(3)`, `REVEAL.done`). Trước đó chuột không chọn được gì.
- Cách mờ dần:
  - với bức tranh (màu nước): `fadePicture` (`fx/post.js`) giữ lại hình đang hiện (2 target luân phiên), rồi `POST.blit` trộn từ hình cũ sang hình mới trong 0,55 s (`stepFade`);
  - với các lớp sắc nét: `uBorn` trong `sharpQuad`/`crispPass` và máy hát, 0,7 s tính từ lần hiện đầu.
- Chữ chờ phòng xong: CSS `html.l3-wait` ẩn `#l3-ui`, dòng thời tiết, thanh bên (`.toc`), đồng hồ trời (`.sky`), và đom đóm trang trí của trang. Sau 30 s mà phòng vẫn chưa xong thì `lib3d-slow` cho chữ hiện ra.
- Cùng đợt, sửa chỗ làm phòng mở chậm: tạp chí từng dò mặt pouf bằng 775 tia (5,9 s). Nay lấy độ cao từ các đỉnh của pouf, nên phòng hiện sau khoảng 1 s.
- Kiểm tra: `loadseq.cjs` (thư mục test) chụp từng nhịp kèm % và các class.

### Độ phân giải đợt 4 và mờ dần lúc tải xong (20/10/2026)

- G: "giảm độ phân giải của gà, và của mèo, giảm độ phân giải của máy bay, của bàn, của room frame, của giải ngân hà. khi loading complete mọi thứ cần fade in animation, để mượt mà".
- Giảm độ phân giải:
  - gà: lớp vẽ 0,4 px mỗi px CSS, ảnh ≤ 128 px;
  - mèo: lớp vẽ 1 px mỗi px CSS, ảnh ≤ 512 px (`shrinkTexture` ở `core/utils.js`);
  - 747: lớp vẽ 1 px mỗi px CSS, màu sơn vẽ ở 2048 rồi giữ 1024 (`halfCanvas`);
  - bàn trà: ảnh còn ½;
  - khung phòng: gỗ `frame` 128×512.
- Ngân Hà (`drawMilkyWay` ở `words.js`):
  - vỏ cầu Ngân Hà (`OVER.mw`) vẽ vào target riêng ở 0,75 px mỗi px CSS (trước là 2 px thiết bị), `uRes` đặt theo cỡ target cho phép thử độ sâu, rồi phủ lên canvas (premultiplied);
  - sao và trăng vẫn vẽ sắc nét sau đó.
- Mờ dần khi hiện lần đầu (`bornFade`): trời đêm (`SKYN`, 1,4 s), quầng bóng đèn và đom đóm. `sharpFading` giữ cho vòng vẽ chạy liên tục trong lúc mờ.
- Chữ lúc tải xong hiện lần lượt: thanh bên 1,2 s, đồng hồ trời trễ 0,25 s, nhãn trên phòng và dòng thời tiết trễ 0,5 s (1,1 s).
  - Việc dịch shader cho các trạng thái đèn lùi tới 2,2 s sau đó. Trước đây nó chiếm luồng chính nên chữ hiện giật.
- Hai target của hiệu ứng mờ dần (`fadePicture`) được giải phóng khi màn mở trang kết thúc (`endFades`, thử lại cho tới khi hết lần mờ cuối): texture 162 → 148 MB.

### Độ phân giải đợt 5: lá cây, khung phòng, máy hát, bàn (20/10/2026)

- G: "tiếp tục giảm độ phân giải của cây cối lá; room frame; giảm độ phân giải máy nghe nhạc, và bàn".
- Cây (`trees.js` `tex`): ảnh ≥ 512 px còn 1/16, ảnh ≥ 256 px còn 1/8.
  - Lá phong 96×64, cành tần bì 40×32, vệt cọ và vỏ cây 32×32.
  - Bụi (`bush.js`) 64 px, rừng xa (`outside.js`) 256×32.
  - So ảnh trước/sau: tán lá không thưa đi, chỉ mềm hơn một chút.
- Khung phòng: gỗ `frame` vẽ 128×512 rồi giữ 64×256, mỗi điểm là trung bình một ô 2×2 (`boxDown` ở `materials.js`, khoá `down` trong `PICS`). Nếu vẽ thẳng ở 64 px, vân gỗ sẽ lốm đốm.
- Bàn:
  - mặt bàn trà còn ¼ (128 px);
  - chân bàn trà và bàn gốc cây dùng `MAT.tableOak`/`MAT.tableOakDark`. Gỗ của chúng là `TEX.oakT`: gỗ sồi của kệ lấy trung bình 4×4 (64×256). Kệ vẫn giữ `TEX.oak`.
- Máy hát (`deck.js`):
  - vẽ ở 0,75 px mỗi px CSS (k = 0,75 / pr); viền chọn giữ bề rộng trên màn hình;
  - mặt nạ mực 512 → 256 (`shrinkTexture` lúc tải); nhãn đĩa tải cỡ 128 (`w_128,h_128`); đổi bài thì nhãn cũ được giải phóng;
  - bước nét cọ nhân theo k (`setPaint(..., k)` ở `post.js`), nên nét cọ trên màn hình rộng như khi vẽ đủ cỡ. Trước đó bước nét tính theo điểm ảnh của lớp vẽ: ở 0,75 px, nét cọ rộng gấp 2,7 lần và kéo vùng trong suốt quanh máy hát vào mép xa của đĩa, thành những mảng rách (đợt 4 cũng có nhưng nhỏ hơn);
  - bỏ `alphaTest 0.5` của đĩa: vành mềm của ảnh WebP (nén nên nhiễu) bị cắt thành lỗ, rồi nét cọ kéo các lỗ rộng ra. Hình tròn của đĩa vốn đã là mép đĩa.
  - Các lớp sắc nét khác vẫn tính bước nét theo điểm ảnh của lớp, nên ở DPR 2 nét cọ của chúng rộng hơn thiết kế: gà ×5, mèo và 747 ×2, còn lại ×1,33. Chưa thấy rách. Nếu có, truyền k vào `setPaint` như máy hát.
- Đo ở tầng GL: texture 147,7 → 145,5 MB, renderbuffer 44,2 → 43,9 MB. Các ảnh này vốn đã nhỏ nên lợi ít.
- Các khoản lớn nhất còn lại:
  - bóng nắng 1536² (12 MB);
  - hình chính `POST.rt`: 9,3 MB, cộng 14 MB MSAA;
  - PMREM của môi trường (8 MB);
  - hai target giấy của `bakePaper` (2 × 7,2 MB);
  - một ảnh 2048×1024 (10,7 MB): đợt này ghi nhầm là ảnh trong `lib.glb`, thật ra là atlas gáy sách (xem đợt 6);
  - sàn 512×2048 (5,3 MB).

### Bộ nhớ đợt 6: các khoản lớn (21/10/2026)

- G: "em giảm tiếp: bóng nắng 12 MB; lớp hình chính 9,3 MB, cộng 14 MB cho khử răng cưa; một ảnh 2048×1024 …; ánh sáng môi trường 8 MB; hai lớp giấy, mỗi lớp 7,2 MB".
- Bóng nắng (`lights.js`): 1536 → 1024, khung bóng giữ ±8 m, nên mỗi điểm bóng 1,6 cm thay vì 1 cm. Bóng mềm (PCFSoft) dưới lớp màu nước nhìn không khác.
- Hình chính (`POST.rt`, `post.js`):
  - bỏ MSAA 2 mẫu, mất các renderbuffer màu (14 MB) và độ sâu (5,2 MB);
  - bù lại bằng FXAA trong lượt tone (`POST.toneQuad`): cùng thuật toán với `POST.blit`, chạy ở độ phân giải của hình chính; `px` đặt trong `resize` ở `views.js`. Không có nó, mực của lượt màu nước tô theo những bậc thang trên cạnh xiên mảnh (chân bàn trà);
  - lá cây (alpha-to-coverage) không còn MSAA nên cạnh cứng hơn, nhưng lượt màu nước làm mềm lại; so ảnh không thấy khác.
- Ảnh 2048×1024 là atlas gáy sách của 4108 cuốn trên kệ (`spineAtlas` ở `books.js`). Nay vẽ ở nửa cỡ, 1024×512 (`o.S` 0,5): cùng nét vẽ, thu bằng `scale` của canvas trong Worker. Chữ trên gáy mềm hơn khi xem gần. Gáy sách thật của trang nằm ở lớp sắc nét riêng nên không đổi.
- Ánh sáng môi trường (`lights.js`): `fromScene` của three r170 luôn dựng cube 256, kết quả 768×1024 half float. Bầu trời môi trường chỉ là một dải màu, nên giờ vẽ nó vào `WebGLCubeRenderTarget` 64 bằng `CubeCamera` rồi gọi `pm.fromCubemap`; kết quả còn 336×256. Đối chiếu cảnh đêm (ánh nhung, kính) không thấy khác.
- Giấy (`bakePaper`):
  - 4 kênh biến đổi chậm (lắc nét x, y; mực; vết loang) vẽ ở nửa cỡ và đọc mịn (`POST.n1`, LinearFilter);
  - 3 kênh hạt (thớ giấy, hạt màu, mặt giấy) giữ đủ cỡ (`POST.n2`);
  - đổi chỗ kênh: hạt màu nay là `n2.y`, vết loang là `n1.w` (hai chỗ trong `post.js`).
- Đo:
  - tầng GL: texture 145,5 → 118,3 MB, renderbuffer 43,9 → 18,7 MB (−52 MB);
  - footprint, đo bằng `tools/perf/memab.cjs` (bản đợt 5 và bản này, mỗi bản 2 lần): tiến trình GPU 831 → 743 MB (−88 MB), tiến trình trang 255 → 256 MB.
- **Bẫy đo:** công cụ đo footprint cũ cộng mọi tiến trình `ms-playwright`, kể cả trình duyệt Playwright của phiên khác đang mở (21/10 có hai cái đã chạy từ hôm trước). Vì vậy các số footprint cũ có thể bị lẫn. `memab.cjs` chỉ đếm trình duyệt nó mở.
- Khoản lớn nhất còn lại:
  - hình chính 9,3 MB, `POST.out` 7,2 MB;
  - giấy 7,2 + 1,8 MB;
  - sàn 512×2048 (5,3 MB);
  - ảnh đồng hồ 1024² (5,3 MB);
  - bóng của đèn cây 1024² (5,3 + 3 MB; trước ghi nhầm là đèn treo, đèn treo không đổ bóng).

### Bóng đèn treo và mặt trăng to hơn (21/10/2026)

- G: "em cho bóng đèn trên research to ra thêm 10% và đưa lên cao thêm 1 chút; em cho moon ngoài cửa sổ to thêm 10%; và viền của moon mờ và glowing 1 chút".
- Bóng đèn: `BS` 1,2 → 1,32 (`furniture.js` `pendantLamp`), quầng sáng `BULB.size` 0,42 → 0,462 (`glow.js`). Tâm bóng 3,27 → 3,33 m (`furnish.js`). Sau đó G: "cho bóng đèn to ra thêm 10% và cao lên thêm 20%", chọn dây ngắn đi 20%: `BS` 1,452, `BULB.size` 0,508, dây (R.H − 3,33) × 0,8, tâm bóng ~3,9 m. Ở góc nhìn đầu 1512×945, bóng sát mép trên, nằm dưới đồng hồ trời. Vị trí ngang giữ nguyên, nên đồng hồ trời vẫn thẳng trục.
- Mặt trăng (`sky.js`): bán kính `MOON_R` 0,8° → 0,88°. `placeMoon` dời độ cao theo phần lớn thêm, để mép dưới vẫn qua thanh ngang (hoặc mép trên vẫn dưới nó). Viền ảnh mờ dần từ r 0,9 tới 1,0, thêm một quầng sáng ôm sát mép (`exp(-|r − 0,96| · 9)`). Vòng đen lấm tấm ở mép trăng cũ cũng hết.

### Bộ nhớ đợt 7 (21/10/2026)

- G hỏi trang nặng chỗ nào, rồi: "em giảm đi".
- Bóng của đèn cây (`floorLamp` trong `furniture.js`): 1024 → 512.
- Cube phản chiếu của kính (`glass.js`): 256 → 128. Đó là ảnh phòng soi mờ trên kính.
- Ảnh đồng hồ (`clock.js`): 1024 → 512 (`shrinkTexture`). Khi bấm xem cấu tạo (×3), số La Mã vẫn đọc được, chi tiết mềm hơn một chút.
- Atlas đồ trang trí trên kệ (`decor/atlas.js`): vẽ 1024 rồi giữ 512 (`halfCanvas`).
- Đo: tầng GL texture 118,3 → 103,3 MB, renderbuffer 18,7 → 15,6 MB. Footprint (`memab.cjs`, 2 lần mỗi bản): tiến trình GPU 776 → 708 MB.
- Chưa làm: DPR của khung vẽ (2 → 1,5 thì lợi lớn nhất nhưng chữ bớt nét). `clock.glb` 0,81 MB chủ yếu là hình học (ảnh trong đó chỉ 72 KB), nên thu ảnh không làm file nhẹ đi.

### Mèo: dựng lại xương, khớp, trọng số; đuôi tự nhiên; thêm hành vi (22/10/2026)

- G: "bổ sung xương, khớp và trọng số weight vào trong mèo, để cho mèo, đuôi mèo không bị méo, chân mèo không bị méo … add behavior vào đuôi mèo để cho nó tự nhiên khi vận động … bổ sung thêm một chút hành vi".
- Nguyên nhân méo (đo trên lưới gốc, 794 đỉnh):
  - mỗi chân chỉ có khoảng 3 vòng đỉnh suốt chiều dài, gối, khuỷu và cổ chân không có đỉnh để gập;
  - trọng số chân chia theo độ cao lúc đứng, nên khi gập (ngồi, nằm), da không đi theo xương;
  - đuôi 7 đốt trên khoảng 9 vòng đỉnh.
- `tools/pets/rig_cat.py` (Blender 5.2, chạy như cũ):
  - Lưới chia nhỏ: mỗi tam giác thành 4 trên toàn thân, thêm một lần nữa ở chân (dưới z 0,08) và đuôi. Kết quả 7482 đỉnh, 14960 tam giác. Chia phẳng nên giữ nguyên dáng; pháp tuyến gốc được nội suy sang đỉnh mới (`onrm`, `normals_split_custom_set_from_vertices`). Nếu không làm vậy, các mặt cũ phẳng lì hiện thành sọc trên đuôi.
  - Xương:
    - đuôi 12 đốt, đặt theo đường tâm ống đuôi đo từ lưới: lấy tâm từng lát cắt, lặp 4 lần, làm mượt;
    - lưng dưới ngực thành 2 đốt (`spine`, `spine2`);
    - ngón chân trước thành đốt riêng (`ftoe_L/R`);
    - khuỷu dời vào giữa ống cẳng tay.
  - Trọng số: trong mỗi chuỗi xương, mỗi đỉnh chiếu lên chuỗi để có toạ độ dọc chiều dài, mỗi khớp có một dải chuyển mềm (chân 6–9 mm, đuôi 40 % một đốt). Vùng đùi và vai rộng hơn, để khối cơ đùi đi theo đùi khi ngồi. Làm mượt 5 lượt trên mặt lưới, giữ 4 ảnh hưởng.
  - `cat.bin` mới 208 KB (trước 81 KB), đóng gói và xáo trộn bằng `pack.mjs` như cũ. Thư viện ở `@gltf-transform` 4.2, `meshoptimizer` 0.22.
- `cat.js`:
  - `C_TAIL` lấy từ xương (`tail1…tailN`). Các tư thế vẫn viết cho 7 đốt: mỗi thao tác trên đốt k được chia cho các đốt mới nằm trên cùng đoạn 1/7 đuôi; `tailArc` co giãn theo số đốt. Thao tác trên `spine` được chia đôi sang `spine2`. Chân trước có ngón (`catLegs`: `toe` = `ftoe`).
  - Đuôi (`catTail`):
    - mỗi khớp là một lò xo có tắt dần, cứng ở gốc, mềm ở chóp;
    - lực đẩy từ cử động của thân như trước;
    - thêm "tâm trạng" `C_TMOOD`: một sóng chạy từ gốc tới chóp, biên độ tăng dần về chóp; chóp cong như dấu hỏi; `flat` khi nằm hoặc ngồi thì quét ngang theo trục đứng của phòng;
    - `catTailFloor` giữ đuôi không xuyên sàn hay đệm.
  - Tư thế mới: `stretch` (duỗi một chân sau ra sau, sau khi vươn vai) và `loaf` (nằm kiểu ổ bánh mì: chân trước gập dưới ngực, đuôi ôm hông).
- `pets.js`:
  - `tailMood`:
    - nằm thư thả: quét chậm;
    - nhìn gà: chóp đuôi bồn chồn;
    - đi: dựng cao, chóp cong, đung đưa theo bước;
    - rình: thấp và rung;
    - bực khi bị vuốt lâu: quét rộng và nhanh hơn;
    - ngủ: thỉnh thoảng động nhẹ;
    - đổi tâm trạng mượt trong khoảng 0,6 s.
  - Hành vi mới ban ngày (`dayActs`): ngoài liếm lông, có nằm ổ bánh mì 18–34 s mắt lim dim, và ngẩng đầu đánh hơi. Liếm lông xong thì lắc đầu, hai tai giật. Vươn vai xong thì duỗi một chân sau.
  - Sửa lỗi cũ: trong chuyến đi buổi sáng, một chú thích `//` giữa dòng đã nuốt mất động tác vươn vai. Nay đã khôi phục.
  - Chuột chỉ vào bộ phận nào giờ dò bằng các "con nhộng" quanh xương (`pickPart`), không bắn tia lên lưới da 15k tam giác mỗi khung hình nữa. Móc thử `PETS.trip(to)`.
- Đo (cùng mã, khác `cat.bin`): bộ đệm hình học GL 27 → 34,8 MB, vì lông 20 tầng nhân theo lưới; tiến trình GPU tăng khoảng 40 MB (nhiễu); khung hình không chậm hơn.
- Mèo của Jade (`miyu-3d`, `src/pets/cat.bin` + `kitty.js`) vẫn là rig cũ.

### Gà bớt răng cưa, bớt 70 % màu nước (22/10/2026)

- G: "em cho gà bớt răng cưa và giảm water color lại 70%".
- `SHARP.hen` (`pets.js`):
  - lớp vẽ 0,4 → 0,8 px mỗi px CSS (ở 0,4 cạnh gà lởm chởm từng khối);
  - `paint` 0,15 → 0,045, `wash` 1 → 0,3.
- Kết quả: viền gà mịn, thấy rõ mỏ và mào, không còn loang mảng.

### Khung gỗ tối hơn 50 % (22/10/2026)

- G: "em cho wooden frame darker 50%". `MAT.frame` (`materials.js`): màu 0,75 → 0,375 (sRGB). Kệ và bàn giữ nguyên.

### 747 và ISS: bấm thì bay ra xoay, bấm nữa mới mở trang (`lib3d/world/showcase.js`, 22/10/2026)

- G: "khi click vào các model airplane, iss, showing rotate 3d model first, if click then open new tab".
- Mô-đun mới nằm sau `camera.js` trong chuỗi thứ tự dựng (`flight.js` nay import `showcase.js`).
- Khi bấm:
  - mô hình (cả đế) bay ra giữa khung nhìn, to ×3 (ISS ×2,4) trong 0,85 s; phòng tối đi;
  - mô hình tự xoay như trên bàn xoay, 16 s một vòng; kéo chuột thì xoay theo và nghiêng (±0,5 rad); thả ra thì xoay tiếp từ đó;
  - bấm vào mô hình (hình chữ nhật của nó trên màn hình) thì mở `PLANE.url` / `ISS.url` trong tab mới; bấm ra ngoài, Esc hoặc × thì cất về kệ.
  - Dùng chung bảng và CSS của đồng hồ và máy ảnh (`.ck-out-ui`, `body.ck-out`).
- Khi ở ngoài kệ:
  - không bị độ sâu của phòng che: `DECKR.u.uDepth` tạm đổi sang một texture 1×1 có độ sâu 1;
  - vẽ ở 1 px mỗi px CSS (`S.PI`; 1,25 tới 22/10/2026); bóng trên kệ ẩn đi; `drawPlane`/`drawIss` bỏ qua khi `away > 0`.
- **Bẫy:** đừng thêm đèn vào cảnh lúc mở. Số đèn là một phần khoá của shader, nên mọi vật liệu trong phòng phải dịch lại, phòng đứng hình khoảng một giây. Mô hình lấy sáng từ đèn phòng, độ phơi sáng ×1,2.
- Móc thử: `PLANE.open()`, `ISS.open()`. Bài kiểm tra: `showtest.cjs` (thư mục thử).
- Cạnh mô hình có nhãn "Click to see details" / "Bấm để xem chi tiết" (`.sc-tip`, cùng kiểu `.ck-name`), đặt bên phải tâm mô hình, lật sang trái nếu sát mép màn hình (G 22/10/2026).

### Mấy chỉnh nhỏ ngày 22/10/2026

- 747 và ISS bớt độ phân giải (G: "em giảm độ phân giải của máy bay và iss"):
  - lượt vẽ trên kệ ở 0,75 px mỗi px CSS (747 trước là 1, ISS 1,5); khi bay ra xem (`showcase.js`) 1;
  - ảnh của ISS thu về 512 (`shrinkTexture`).
- Kệ sách tối hơn 10 % (G: "em cho kệ sách darker color 10%"): `shelfOak`, `shelfBack` 0,75 → 0,675 (sRGB).
- Sách trên bàn và trên pouf bớt 60 % màu nước (G, khoanh đỏ trên ảnh): `tb1`, `tb2`, `b1`, `b3` trong `furnish.js` dùng `paintLightly(…, 0,68)`.

### Khung vẽ DPR 1,5, giấy lát gạch, lớp màu nước 0,75 (23/10/2026)

- G hỏi lớp màu nước phủ màn hình giảm được không, DPR 2 là gì, rồi: "em làm hết đi".
- DPR của khung vẽ tối đa 1,5 (`core/views.js` resize, `core/renderer.js`):
  - các lớp sắc nét vẫn tính theo `k = dpr / pr`, nên tự theo;
  - máy hát: `k = min(1, 0,75 / pr)`.
- Giấy (`fx/post.js`):
  - trước là hai ảnh cỡ cả màn hình;
  - nay là hai viên gạch lặp:
    - `POST.n1`: 512×512 phủ 1024 px CSS, lọc tuyến tính (gợn x, y, mực, vết loang);
    - `POST.n2`: 256×256, lọc nearest (thớ giấy, hạt màu, mặt giấy).
  - Nhiễu tuần hoàn `vn(p, P)` và `fb(p, P)` (lacunarity 2) nên mép viên gạch liền nhau.
  - `POST.paper` = (w/1024, h/1024, w/256, h/256) báo cho shader số lần lặp.
- Lớp màu nước `POST.out` vẽ ở 0,75 px CSS (nét cọ vốn mềm). Khử răng cưa ở hai bước:
  - FXAA trong `toneQuad`, có `px` đặt lại khi resize;
  - FXAA ở bước blit lên canvas.
- `POST.rt` không còn MSAA.
- Đo (`memab.cjs`, 2 lần mỗi bản), tiến trình GPU 722 → 656 MB.
- **Bẫy, lần thứ 3 và 4:** chú thích `//` đặt giữa dòng nuốt mã phía sau.
  - Ở `views.js`, dòng `setSize` bị nuốt nên các lớp sắc nét vỡ và mờ.
  - Ở `furnish.js`, phần chỉnh vật liệu mặt bàn trà (màu 1,55/1,2/0,85, độ nhám 0,55, bỏ map kim loại) bị nuốt từ 20/10. Nay đã trả lại.
  - Chú thích chỉ đặt ở cuối dòng, sau mã.

### Xoá những gì không góc nhìn nào thấy (23/10/2026)

- G: "những chỗ nào mà nó bị khuất em xóa thẳng tay cho anh"; sau đó: "Nếu sách không có tốn RAM thì để lại như cũ đi".
- Công cụ: `tools/perf/occlusion.cjs`.
  - Mỗi vật và mỗi bản sao được vẽ bằng một màu mã riêng, từ mọi góc nhìn:
    - nhà và từng ngăn, Research;
    - thanh cuộn ở −0,3, 0 và 0,45;
    - 8 khổ cửa sổ, ban ngày và ban đêm;
    - tổng 672 góc.
  - Camera chỉ đổi theo các góc nhìn và thanh cuộn (dịch ống kính), nên chừng đó là đủ. Khung nhà luôn là một phần của khung tranh gốc.
- **Bẫy của chính công cụ:**
  - Ghi số bản sao vào kênh alpha thì điểm ảnh alpha 0 bị mất. Lần quét đầu báo sai rằng sách đang thấy là khuất, và một mặt nạ ẩn sách làm hỏng kệ.
  - Bụi, sprite đom đóm và vật thêm sau vẫn vẽ bằng màu thật, cộng vào màu mã, làm vật khuất trông như thấy được.
  - Bản hiện tại tắt hết những thứ đó trong lượt vẽ mã, và đếm điểm ảnh lạ (phải bằng 0).
- Đã xoá (không điểm ảnh nào trong 672 góc):
  - 16 cây ngoài vườn (`HIDDEN_TREES` trong `outside.js`) và 7 bụi (`HIDDEN_BUSHES`). Cây và bụi không đổ bóng, nên không mất bóng nào trong phòng;
  - tường phải sau kệ cao (`room.js`). Bật/tắt nó vào sáng 21/6 và 21/12 (giả ngày) cũng như sáng hôm nay không đổi một điểm ảnh nào: nắng không vào từ phía đó;
  - thân và bóng của đèn bàn (trong chụp), hũ nến cạnh đèn, sứ cách điện ở đuôi bóng đèn treo, nắp gỗ dưới mặt bàn gốc cây;
  - đồ trang trí ở hai ô phía trước của kệ phải (`decor/build.js`: `c.x > 2 && c.z > -1.4`);
  - đĩa và viền của 7 đèn âm trần (`fx/night.js`). Đèn rọi vẫn giữ; phần trần đó không góc nào thấy.
- Giữ lại:
  - gối ôm thứ hai: ló ra 173 điểm ảnh qua kẽ lá khi nhìn thấp;
  - lưng tủ thấp ở mặt kính trước: không thấy, nhưng có đổ bóng nắng;
  - sách trên kệ (khoảng 2.600 cuốn không bao giờ thấy, nhưng gần như không tốn gì) và sách trang trí: theo lời G;
  - 4 lá cây trong chậu và các lớp lông thảm. Các lớp lông thảm dùng alpha nên công cụ không đếm đúng.
- Màu nước là hiệu ứng trên ảnh màn hình, nên phần bị khuất vốn không tốn gì cho nó.
- Đo, bản trước khi xoá so với bản sau:
  - vật trong cảnh 271 → 243; tam giác trong cảnh 1,90 → 1,71 triệu;
  - mỗi lần vẽ lại phòng (mọi lượt): lệnh vẽ ~580 → ~550, tam giác 4,59 → 4,20 triệu;
  - texture 90,1 → 88,8 MB, bộ đệm 34,9 → 34,3 MB;
  - tiến trình GPU 649 → 636 MB (3 lần mỗi bản; dao động ±15).
- So ảnh trước/sau ở 4 giờ trong ngày × 5 góc, mỗi bản hai lần chạy: mọi khác biệt chỉ là mèo, gà, cây đung đưa và đom đóm.

### Audio ẩn khi mở trang, sách bớt màu nước, mèo nằm, chuyển ngày/đêm không giật (23/10/2026)

- Thanh "Nghe tiếp" (G: "hide the audio from start", rồi "chỉ hiện khi click vào sách nghe nói"): `barDismissed` bắt đầu là `true`. Mở trang thì thanh không hiện, kể cả khi còn sách nghe dở; bấm nghe một cuốn thì thanh hiện như cũ.
  - Sửa bằng bản vá `BAR_PATCH` trong `build.py`, không sửa trong HTML.
  - **Bẫy:** `build.py` lấy HTML từ trang sống `WATCHLIST/WIX/Hidden Library.html`, không phải từ `src/hidden-library.base.html`. File kia chỉ là bản chụp dự phòng, sửa ở đó không có tác dụng. Mọi thay đổi trong mã của trang phải là bản vá trong `build.py`, như các bản vá YouTube và giờ mặt trời.
  - Muốn thử như một người quay lại trang: đặt `hiddenLibrary.last` và `hiddenLibrary.positions` bằng `addInitScript`. Đặt rồi tải lại thì không được: lúc rời trang, trang tự ghi đè vị trí nghe.
- Toàn bộ sách bớt 50 % màu nước so với trước (G: "toàn bộ sách less watercolor 50%"):
  - sách trên kệ `paintLightly(booksMesh, 0,6, 0,975)` (xa / gần), trước là 0,2 / 0,95;
  - sách trên bàn và trên pouf 0,68 → 0,84; chồng sách và sách giữa đồ trang trí 0,2 → 0,6.
  - Lần hai, cùng tối đó (G: "cho sách less water color 50%"): kệ 0,8 / 0,9875; bàn và pouf 0,92; đồ trang trí 0,8.
- Sofa tối hơn 20 % (G: "cho màu sofa dark color thêm 20%"): nhung của đệm, lưng và khung, cùng hai gối ôm, nhân 0,8 trên sRGB:
  - đệm và lưng 0x40603f → 0x334d32; khung 0x3b5a3c → 0x2f4830; gối ôm 0x37563a → 0x2c452e;
  - gối vuông (mù tạt, xanh) và pouf giữ nguyên.
- Lượt ba (G lặp lại yêu cầu, rồi chọn "thêm một lượt nữa", và "gối dark color 50%" cho tất cả gối):
  - sofa ×0,8 lần nữa: đệm và lưng 0x293e28, khung 0x263a26;
  - mọi gối ×0,5: gối ôm 0x162217, gối mù tạt 0x4b3820, gối xanh 0x1c2c1d;
  - sách: kệ 0,9 / 0,99375, đồ trang trí 0,9; sách trên bàn trà và trên pouf 0,96, rồi bớt thêm 80 % (G khoanh hai cuốn) → 0,992.
- 24/10/2026 (G: "em giảm watercolor đi 30% cho toàn bộ sách"): mọi sách bớt thêm 30 % phần màu nước còn lại: kệ 0,93 / 0,9956, đồ trang trí 0,93, bàn và pouf 0,9944.
- Mèo nằm nhìn ra kính (dáng `sphinx`, G khoanh chỗ đùi sau):
  - Lỗi cũ: đùi gập ngang lên tới tầm háng (khoảng 12 cm trên sàn), nên cổ chân sau còn cao hơn háng, bàn chân dựng đứng chìa ra sườn như ngón tay cái, dưới bụng nhàu lại.
  - Nay: đùi −30°, dạng 10°, cẳng 30°, bàn chân −70°. Cổ chân và đệm chân sát sàn dưới khối đùi, bàn chân hướng ra trước. Dáng `loaf` dùng cùng chân sau.
  - Tìm bằng `tools/pets/legsearch.cjs`: thử lưới góc, chấm điểm theo vị trí khớp. Xem bằng `tools/pets/catview.cjs`: da trần, tô theo pháp tuyến, chụp nhiều phía.
  - Móc thử `PETS.tryPose(tên, ops)`. Lúc tính dáng, móc tạm đưa mèo về gốc toạ độ, vì `catPose` xoay theo trục thế giới.
- Chuyển ngày/đêm bằng nút (G: "fix the lag transition from night to daytime"). Trước đây, mở trang ban đêm rồi bấm sang ngày thì đứng hình khoảng 5 s ở trình duyệt mới, vì lúc đó mới dựng 45 shader. Ba nguyên nhân:
  1. Các mô hình vẽ sắc nét (747, đồng hồ, ISS, sách vườn, máy ảnh, mèo, gà) chỉ dịch shader cho trạng thái đèn lúc chúng tải xong. Nay `precompileLightStates` (`core/loop.js`) dịch chúng cho cả 4 trạng thái đèn, rồi vẽ thử mỗi cái một lần vào một target 4×4: ANGLE trên Metal chỉ làm xong shader ở lần vẽ đầu.
  2. **Bẫy của three.js:** bản đồ bóng được vẽ trước khi lượt `render()` đếm đèn của nó, nên shader bóng (`depth`) mang số đèn của lượt vẽ cảnh ngay trước đó. Lượt đó thường là một lớp sắc nét, và vì mèo bật mọi đèn lên lớp của nó (`pets.js`), camera lớp mèo thấy tới 6 đèn hướng. Mỗi lần đèn đổi lại sinh một bộ shader bóng mới.
     - Nay `roomLightsFirst()` chạy ngay trước mỗi lần vẽ bóng: một lượt `render()` không vẽ gì (camera lớp 30; đèn của phòng được bật thêm lớp 30), để số đèn luôn là của phòng.
     - Lượt dịch trước cũng vẽ bóng thử ở mỗi trạng thái, không cắt theo khung (ban đêm mặt trời nằm dưới đất).
  3. `renderer.debug.checkShaderErrors` tắt (`core/renderer.js`): đọc log shader ở lần dùng đầu bắt trình duyệt chờ dịch xong ngay lúc đó. Cần soi lỗi shader thì thêm `?shaders` vào địa chỉ.
  - Thêm: ảnh phản chiếu trên kính (`fx/glass.js`) vẽ mỗi khung một mặt trong 6 mặt, thay vì cả 6 mặt trong một khung.
- Đo (1512×945, DPR 2, mỗi chiều 2 lần), trước → sau:
  - shader dựng lúc bấm: 45 → 0;
  - khung chậm nhất: 5,2 s (lần đầu) hoặc 0,1–0,3 s (khi đã có đệm shader) → 34 ms;
  - không còn khung nào quá 50 ms, không còn long task.
  - Mở trang ban ngày rồi chuyển sang đêm: cũng 34 ms.
  - Giá phải trả lúc tải: một long task 54 ms trong lúc dịch trước (phòng đang đứng yên).

### Bóng đèn treo: thấy dây tóc, sáng hơn khi rê chuột (23/10/2026)

- G: "cho dây tóc still visible 90%; khi hover vào bóng đèn thì sáng hơn 50%".
- Quầng anh thấy là sprite `glow` của đèn treo (`furniture.js` pendantLamp): cộng sáng, kéo về phía mắt 7 cm. Tâm trắng của nó che mất chỗ dây tóc.
- Dây tóc mô hình (bán kính 0,28 mm) nhỏ hơn một điểm ảnh ở khoảng cách này. Làm dày nó hay bỏ màu nước của nó đều không hiện ra (đã thử, đã trả lại).
- Nay:
  - quầng dùng `pendantGlowTex`: chỗ dây tóc nằm (và quanh nó một chút) chỉ còn 10 % quầng;
  - dây tóc là một sprite riêng `fil` (`filamentTex`: một vạch ngang có hạt, dài 4,6 cm như dây tóc thật), màu 0xffe2b8 × 5, cộng sáng, đè lên quầng. Đó là chỗ sáng nhất của bóng;
  - `fx/hour.js` đặt độ mờ của nó (0,8 × k) cùng với quầng.
- Rê chuột lên bóng (`stepBulb` trong `fx/glow.js`, chạy mỗi khung trong `core/loop.js`):
  - quầng, dây tóc và thuỷ tinh sáng ×1,5, vào và ra êm (~0,25 s);
  - ánh đèn hắt lên phòng giữ nguyên;
  - vùng bắt chuột là cỡ bóng thuỷ tinh trên màn hình, rộng hơn một chút;
  - móc thử: `__lib3d.BHOV`.
- **Bẫy:** lớp quầng thứ hai `BULB` (`fx/glow.js`, vẽ trên lớp sắc nét) chưa bao giờ bật. `words.js` gọi `bornFade('bulb', BULB.on.value > 0)`, nên giá trị 0 lúc đầu giữ nó mãi ở 0. Em để nguyên lớp đó, không bật.

### Lông mèo xù, dài hơn (`world/fur.js`, 24/10/2026)

- G: "em cho lông mèo là lông xù có độ dài".
- Độ dài và số lớp:
  - lông 8 mm → 2 cm (`uFurLen`); số lớp vỏ 20 → 28, để sợi dài không đứt quãng;
  - đầu 0,55 → 0,6, đuôi 1,3 → 1,5, bàn chân 0,5 → 0,45 (tỉ lệ so với thân);
  - đầu sợi rủ xuống nhiều hơn (0,15 → 0,32).
- Xù:
  - mỗi sợi xoăn khi mọc lên, ngả mạnh hơn theo hướng riêng;
  - lông mọc thành chùm khoảng 6 mm (70 chùm trên ảnh texture của bộ lông), mỗi chùm một chiều cao, đầu các sợi trong chùm chụm vào nhau;
  - cả độ phủ trung bình (khi sợi nhỏ hơn một điểm ảnh) cũng theo chiều cao của chùm, nên nhìn từ xa viền vẫn lởm chởm.
- Giá: hình học lông tăng thêm 8 lớp, khoảng +3,6 MB; vẽ thêm 40 % tam giác cho lông.
- Rồi gấp đôi (G: "em mèo lông xù dài thêm x2"): 4 cm, 40 lớp, chùm to hơn (50 chùm trên texture thay vì 70).

### Lông xù trên sofa, thảm, sách (24/10/2026)

- **Đã bỏ (cùng ngày):** G: "em bỏ chất liệu lông trên pouf và sofa". `sofaFluff` không còn được gọi; hàm vẫn giữ trong `velvet.js`. Không còn lông, sofa và pouf trông sáng hơn hẳn, vì lớp lông có chân sợi tối đã kéo màu xuống.
- Pouf sẫm lại 30 % và khe nếp gấp tối hơn 45 % (G: "em cho pouf sẫm lại 30%, các khe nếp gấp 45% darker"):
  - nhung 0x456944 → 0x304a30;
  - trong `poufGeometry` (`world/pouf.js`), độ che khe (vertex color, theo độ lõm) nhân thêm 1 − 0,45 × min(1, (1 − o) / 0,25): khe sâu tối hẳn 45 %, khe nông ít hơn.

- Sofa (G: "add lông xù lên bề mặt sofa"): `sofaFluff` (`world/velvet.js`) cho mỗi phần của sofa (đệm, lưng, tay, khung).
  - 8 lớp vỏ của chính phần đó, vẽ một lần (instanced). Lớp thứ k đẩy ra theo pháp tuyến (k/8) × 6 mm.
  - Sợi lông cách nhau ~2,5 mm, tính trong ô 3D của chính phần đó (không lệ thuộc đường nối UV), gom thành chùm ~1 cm, mỗi chùm một chiều cao, mỗi sợi ngả một kiểu.
  - Màu và ảnh lấy từ chính lớp nhung, nên đổi màu sofa thì lông đổi theo. Lớp lông không đổ bóng.
  - Sợi nhỏ hơn nửa điểm ảnh thì dùng độ phủ trung bình, chấm dither ổn định, để không nhấp nháy.
- Thảm (G: "thảm trên sàn less water color 90% và dark color thêm 10%"): `paintLightly(LIGHTS.rug, 0,9)`; len 0xf3e9d6 → 0xdbd2c1. Rồi bỏ hẳn màu nước (`paintLightly(LIGHTS.rug, 1)`; G: "remove water color cho cái thảm dưới đất").
- Sách bớt thêm 50 % màu nước: kệ 0,965 / 0,9978, đồ trang trí 0,965, bàn và pouf 0,9972.
- Sách trên kệ bớt thêm 90 % (G: "giảm water color cho toàn bộ sách trên kệ 90%"): kệ 0,9965 / 0,99978, sách trang trí trên kệ 0,9965.
- Đo khi chuyển ngày/đêm: khung trung bình 15–17 ms, chậm nhất 33 ms, không dựng shader mới (như trước).
- Lượt sau (G: "lông trên sofa ngắn đi 30%, a thấy frame ảnh có vấn đề glitching ở tủ sách và sofa, ... sách nằm trên bàn và trên sofa less water color 50%"):
  - Lông sofa 6 → 4,2 mm, 8 → 6 lớp, vật liệu Lambert.
  - Lông sofa nay hoà trong suốt (không ghi độ sâu, các lớp vẽ từ trong ra, như lông mèo), thay cho cắt theo chấm dither: chấm bám theo màn hình nên "bò" khi hình dịch.
  - `POST.rt` có lại MSAA 2 mẫu (`fx/post.js`). Sách gần như hết màu nước nên cạnh gáy sách lộ răng cưa và chớp khi hình dịch.
  - Đo phần còn nháy (dịch hình đúng 1 px rồi bù lại, đếm điểm ảnh còn khác hơn 24): tủ phải 1,20 → 0,32 %, kệ sau 1,04 → 0,56 %, sofa 2,48 → 1,60 %.
  - Giá: khoảng 19 MB bộ nhớ GPU, và thời gian mỗi lần vẽ lại phòng (150 khung, ban ngày): chưa có lông sofa, không MSAA 16–17 ms; lông 8 lớp, không MSAA 19–23 ms; bây giờ 25–28 ms.
  - **Cần để ý:** `adaptQuality` (`core/loop.js`) tự hạ độ phân giải nếu trung vị một đoạn chuyển động quá 28 ms, hai đoạn liền, và nhớ lựa chọn đó một tuần. Bây giờ ta đang sát ngưỡng đó.
  - Sách trên bàn và trên pouf 0,9986.
- Pouf cùng màu và chất liệu với sofa (G: "em cho cái này cùng màu và chất liệu với sofa"): nhung 0x30553c → 0x293e28, ánh 0xdfe6c4; thêm `sofaFluff(pouf)` và màu nước như sofa (`paintLightly(pouf, 0,3)`; trước đó pouf giữ đủ màu nước). Lông dùng chung hình học với pouf, nên vẫn theo chỗ lõm dưới sách.

### Cuộn lên xuống không làm rìa sách chớp; pouf sáng hơn (24/10/2026)

- G: "a thấy các rìa cuốn sách nó flicking khi a rolling up and down".
  - Cuộn là dịch ống kính (`setViewOffset`), tức là trượt nguyên hình. Mỗi bước trượt một phần lẻ của điểm ảnh, nên cạnh mảnh của gáy sách lúc trúng điểm ảnh, lúc không, và chớp.
  - Nay `applyView` (`core/views.js`) làm tròn độ dịch (lên xuống, và sang ngang ở các góc ngăn kệ) theo số nguyên điểm ảnh của hình phòng (`RT_SCALE`). Hình trượt nguyên vẹn, mỗi bước tối đa khoảng 1,25 px CSS.
  - Đo: cuộn từng bước 0,37 px, bù đúng độ dịch (nội suy), đếm điểm ảnh còn khác hơn 16. Tủ phải 1,92 → 0,44 %, kệ sau 1,34 → 0,08 %. Không tốn thêm gì.
- Pouf sáng hơn sofa 30 % (G: "màu Pouf bớt xẫm đi 30%"): 0x293e28 → 0x355134 (×1,3 trên sRGB). Rồi thêm 30 % nữa, 0x456944, và bỏ hẳn màu nước (`paintLightly(pouf, 1)`).
- Nền sân bớt 50 % màu nước (G: "nền ngoài sân less water color 50%"): `paintLightly(ground, 0,5)` và `paintLightly(patio, 0,5)` (`world/outside.js`). Trước đó nền sân giữ đủ màu nước.
- Các vật G khoanh trên bàn bớt 90 % màu nước còn lại: chậu cây 0,5 → 0,95 (cây và gốc cây giữ 0,5), đèn bàn 0,75 → 0,975, hai cuốn sách trên bàn 0,9986 → 0,99986.
- Sofa bớt 90 % màu nước còn lại (G: "em cho sofa less water color 90%"): sofa, gối ôm và gối vuông 0,3 → 0,93, rồi bỏ hẳn (1; G: "remove water color cho sofa và các gối").
- Phần không màu nước (mặt nạ `drawLight` đầy: sofa, gối, pouf, thảm) lấy thẳng từ hình 3D (`POST.tone`, 0,8 px CSS) trong `POST.blit`, không qua `POST.out` (0,75). Ánh giấy, độ ấm và lớp mờ giữ nguyên; viền mềm (`smoothstep(0,985, 0,999)`). Đo năng lượng cạnh trên sofa và gối: chỉ tăng 1–2 %, như đã tính trước, vì giới hạn thật là hình 3D vẽ ở 0,8 px CSS (G hỏi: "vậy cái gì làm cho sofa bị mờ"). Lông xù của sofa là con của từng phần nên theo cùng mức. Pouf giữ 0,3, rồi cũng 0,93 như sofa (G: "em cho Pouf less water color 90%").
- Hai cuốn sách trên pouf (G khoanh, "remove water color"):
  - bỏ hẳn màu nước (`paintLightly(b, 1)`);
  - vẽ thêm một bản sắc nét như tạp chí: `PBOOK` (`world/gardenbook.js`) là bản sao mỗi mesh của sách, đặt trên lớp 9, vật liệu vá như các lớp sắc nét, vẽ trước tạp chí để tạp chí nằm đè lên;
  - sách thật vẫn ở trong phòng (để đổ bóng và có độ sâu);
  - lý do: dù hết màu nước, sách vẫn mờ vì hình phòng vẽ nhỏ hơn màn hình rồi phóng lên;
  - `precompileLightStates` dịch trước cả các bản sao này.

### Bóng tiếp xúc: đồ đạc đứng trên sàn (`groundAO` trong `world/furnish.js`, 24/10/2026)

- G: "sao a có cảm giác tất cả đồ đạc ko nằm trên mặt sàn gỗ nhỉ; a có cảm giác giống như nó bay bổng".
- Nguyên nhân:
  - nét mực màu nước dọc chân đồ đạc mất theo khi bỏ màu nước;
  - ánh chiều thấp và đèn bàn không đổ bóng ngay dưới chân đồ.
- `groundAO(F, vật, y, k, sp)`:
  - lấy các đỉnh của vật nằm trong 2,5 cm sát điểm thấp nhất, gom theo ô 4 cm. Mỗi cụm là một "bàn chân": chân bàn, đế sofa, chân đèn, đáy pouf;
  - dưới mỗi bàn chân đặt một mảng tối cùng hình (hộp bo tròn), lan ra vài cm;
  - dưới cả vật thêm một mảng mờ (độ tối 0,22);
  - các mảng nằm sát mặt sàn, hoặc sát mặt thảm cho pouf (y 0,019), vẽ cùng phòng nên được tô màu cùng sàn.
- Áp cho: bàn trà, bàn gốc cây, sofa, đèn cây, pouf. Pouf rộng gấp đôi và đậm hơn, vì thân nó phình ra che chỗ tiếp xúc. Máy hát đã có bóng riêng từ trước (`ui/deck.js`).
- Sàn gỗ tối hơn 30 % trên màn hình (G: "em cho sàn màu sẫm hơn 30%"): `MAT.floor.color` 0,52 trên sRGB (`world/materials.js`). Đặt 0,7 thì màn hình chỉ tối đi 15 %, vì độ sáng của giấy màu nước kéo màu tối lên. Đo vùng sàn: 168 → 120 (−29 %).
- Sàn bỏ hẳn màu nước (G: "em cho sàn nhà no water color"): `paintLightly(floor, 1)` (`world/room.js`). Mặt nạ đầy nên sàn cũng lấy thẳng từ hình 3D ở bước dán lên màn hình.

### Thảm và sách trên bàn sắc nét (`world/gardenbook.js`, 24/10/2026)

- G: "em cho thảm dươi sàn 100% visible, sách cũng visible" (chọn: sắc nét như sách trên pouf; sách trên bàn và trên pouf).
- `sharpTwins(S, objs, fix)` dựng bản sao của từng mesh trên lớp riêng của S:
  - pouf 9, bàn trà 10, thảm 11 (kèm bóng của pouf nằm trên thảm, `LIGHTS.poufAO`);
  - vật liệu giữ phần vá shader riêng của nó rồi thêm phép thử độ sâu của lớp sắc nét (`sharpTwinMat`);
  - mỗi bản có khoá shader riêng. **Bẫy:** hàm bọc có cùng mã nguồn cho mọi bản, nên three.js dùng chung một chương trình nếu khoá không phân biệt.
- Các lượt đồ đứng yên (`P.still`) chỉ vẽ lại khi phòng vẽ lại (`ROOMF`, `core/loop.js`), hoặc khi vị trí trên màn hình đổi. Giữa các lần đó dùng lại ảnh cũ.
- Thảm vẽ trước máy hát và mèo (`drawFloorSharp`, `ui/words.js`), ở 1 px mỗi px CSS. Nó chỉ hiện khi phòng đã đứng yên 0,2 s; lúc phòng chuyển động thì thấy thảm vẽ thường.
- Thảm sắc nét để lộ vân xéo mịn của 14 lớp sợi len (trước đây độ mờ giấu đi). Giảm mức chi tiết chùm sợi không làm hết vân đó.
- Đo vẽ lại 150 khung, xen kẽ với bản trước đó: như nhau (34–38 ms lúc đo). Máy lúc đó chậm hơn các lần đo trước, cùng bản cũ trước đây đo 25–28 ms.

### Trăng to hơn, sao băng bay sau trăng; bóng đèn treo to hơn (24/10/2026)

- G: "mặt trăng ngoài cửa sổ x1.5 bigger, các sao băng hay sao chổi chỉ bay sau lưng mặt trăng; bóng đèn trên research bigger 1.5x và khi hover over thì glowing bigger 2x bigger area".
- Trăng: `MOON_R` 0,88 → 1,32 độ (`fx/sky.js`). `placeMoon` vẫn giữ mép trăng cách khung kính như cũ.
- Sao băng và sao chổi bị trăng che, kể cả phần tối của trăng lưỡi liềm:
  - `moonMask` tính tâm và bán kính đĩa trăng trên màn hình mỗi khung, theo camera của bầu trời (`OVER.cam`; dùng camera của phòng thì lệch hẳn);
  - `MOON_HIDE` trong shader của sao băng và sao chổi bỏ phần nằm trong đĩa;
  - sao băng vẽ trước trăng (`renderOrder` 4 → 2);
  - móc thử: `METEOR.hide`.
- Bóng đèn treo: `BS` 1,452 → 2,178 (`world/furniture.js`), cả bóng và đui.
  - **Bẫy:** quầng và dây tóc được kéo về phía mắt 7 cm cho nằm trước mặt kính. Bóng to hơn thì 7 cm lọt vào trong bóng, mặt kính che quầng, lòng bóng tối đi. Nay khoảng kéo tăng theo cỡ bóng (`× BS / 1,452`).
  - Vùng khoét quanh dây tóc hẹp lại (chỉ sát sợi, còn 30 % quầng ở đó).
  - Rê chuột: quầng sáng ×1,5 như trước, và lan rộng gấp đôi diện tích (cỡ sprite × √2, `stepBulb`).

### Pouf hết răng cưa; bóng theo hướng sáng cửa sổ (24/10/2026)

- G: "em remove răng cưa trên pouf; tạo shadow cho pouf đúng theo hướng sáng từ cửa sổ và rõ hơn, bao gồm máy nghe đĩa mèo, và sofa".
- Răng cưa trên pouf là những đường chấm tối dọc nếp gấp, do khe được tô tối theo từng đỉnh (sau khi làm tối 45 %).
  - Nay độ tối của khe được làm mịn hai lượt với các đỉnh xung quanh, rồi đậm lại (mũ 1,25) (`world/pouf.js`).
  - Pouf vẽ chung lớp sắc nét với thảm (`RUGS`). Lớp này dùng độ sâu riêng (`own`), không thử theo độ sâu của phòng vốn thô hơn, nên mép pouf trên thảm không còn bậc thang.
  - **Bẫy, lần thứ 5:** chú thích `//` chèn giữa dòng nuốt mất `const ck`, trang lỗi `ck is not defined`.
- Khe nếp gấp sắc nét, vẫn tối (G: "đừng cho các nếp gấp và khe đen mờ", chọn "khe sắc nét, vẫn tối"):
  - màu theo đỉnh của pouf tách làm hai: xanh lá là độ tối của khe, đỏ/lam là độ tối của khe nhân bóng sát sàn;
  - `makeVelvet({ aoSharp: true })` (`VELVET_AO_SHARP`, `world/velvet.js`) cắt độ tối mịn đó ở mức 0,66 thành mảng tối viền sắc (viền rộng một điểm ảnh nhờ `fwidth`), giữ một ít độ sâu ở trong và ngoài;
  - nhờ màu đã làm mịn trước nên đường cắt là đường cong trơn, không răng cưa, không chấm.
- Bóng:
  - Bản đồ bóng của mặt trời 1024 → 2048.
  - Máy hát có một khối tàng hình để đổ bóng nắng (`DECK.caster`, `ui/deck.js`).
  - Mèo đổ bóng nắng khi đứng yên (lớp của mèo bật cho camera bóng). Lúc mèo đi thì tắt, nên mỗi chuyến chỉ vẽ lại bóng hai lần.
  - Nắng chỉ rọi phần sàn sát kính; giữa phòng được chiếu bởi ánh trời qua kính (đèn diện rộng, không đổ bóng). Nên `windowShadow` (`world/furnish.js`) đặt sau sofa, pouf và máy hát một vệt bóng mềm theo hướng rời kính (`WIN_DIR` = (1, 0, 0,35): từ kính trái và kính sau):
    - rộng bằng chân đồ, đậm ở chân, nhạt và loe dần trên ~½ chiều cao + 15 cm;
    - mờ dần theo trời tối (`fx/hour.js`);
    - bóng của pouf nằm trên thảm, nên được vẽ cùng lớp sắc nét của thảm.
  - Bóng tiếp xúc của mèo dịch theo cùng hướng và to hơn 12 %.
- Đường góc (G: "em cho các khe góc có line rõ nét hơn"): `cornerShade` (`world/room.js`) chạy dọc chỗ sàn gặp:
  - thanh chân vách kính trái (mặt trong xL + 4 cm, vì thanh sâu 20 cm);
  - chân tủ cao bên phải;
  - mặt tủ thấp trước và sau.
  Mỗi chỗ có một dải trên sàn và một dải lên mặt tủ: một đường tối sắc sát góc, rồi nhạt dần. Không màu nước (`paintLightly(…, 1)`).
  - Lượt sau (G: "em cho rõ nét hơn nữa và áp dụng thêm cho thư viện"):
    - dải dựng bằng đỉnh trực tiếp (`cornerStrip(A, B, d, n, w, L)`). **Lỗi cũ:** dải đứng bị lật, nên đường tối nằm cao 5 cm thay vì sát sàn;
    - đường tối đậm hơn (0,92) và dày hơn: khoảng 5 mm ở sàn;
    - thêm đường đứng ở hai đầu tủ thấp (trước và sau), khoảng 1 cm: mép ngoài thanh đứng sát kính trái, và chỗ tủ gặp tủ cao bên phải (cả mặt tủ thấp lẫn mặt tủ cao) (`caseCorners`).
- Chân sofa (G khoanh mép dưới sofa và chaise: "rõ nét đen cho các chỗ này"):
  - đế lõm 0x1d2419 → 0x0b0d09;
  - một đường tối sắc trên sàn quanh chân mỗi khối (`cornerStrip`, xuất từ `room.js`), lùi vào 3 cm để nằm dưới mép chứ không lộ ra cạnh.
- Nét mực cho phần ít hoặc không màu nước (G khoanh tay sofa, chỗ sofa gặp tủ, chân chaise: "tiếp tục cho các khu vực này"):
  - `POST.quad` (`fx/post.js`): ở chỗ mặt nạ `lite > 0,05`, một Sobel trên độ sâu tại đúng điểm ảnh (không lắc theo giấy, chỉ theo độ sâu, không theo màu) vẽ đường tối sắc (màu × 0,32/0,27/0,22) nơi độ sâu nhảy bậc;
  - lượng mực truyền qua kênh alpha của `POST.out`; `POST.blit` vẽ lại đường đó lên phần lấy thẳng từ hình 3D (sofa, pouf, thảm, sàn);
  - nhờ đó sofa, pouf, bàn, tủ có lại nét viền mà màu nước từng vẽ.
- Viền đen chỉ ở chỗ G chỉ (G khoanh tay sofa bên phải và chân chaise, rồi: "em redo lại và chỉ add thêm viền đen đúng vào vị trí a chỉ định"):
  - Lượt trước, nét mực theo độ sâu áp cho mọi đồ không màu nước, nên viền hiện khắp nơi. Đã bỏ.
  - Nay `POST.quad` chỉ vẽ nét mực trong các hộp đánh dấu (`inkBox(i, min, max)`, tối đa 4; vị trí lấy từ `uInvVP` và độ sâu):
    - hộp 0: tay sofa bên phải (`sofa_back_side`), nới 1,2 cm;
    - hộp 1: phần dưới mặt trước chaise.
  - Trong hộp: Sobel độ sâu tại đúng điểm ảnh vẽ đường tối sắc nơi độ sâu nhảy bậc. Lượng mực truyền qua alpha của `POST.out` cho phần lấy thẳng từ hình 3D.
  - Đã thử và bỏ: đường dải đặt lơ lửng trước tay sofa (nằm giữa mặt), và viền theo pháp tuyến hay theo hướng nhìn trong shader nhung (tay sofa bo tròn đều, không có cạnh gập; ánh nhung che mất viền).
  - Khe giữa tay sofa và tủ cao: một dải tối trên mặt tủ phía sau tay sofa.
  - Viền mờ nhẹ cho hết răng cưa (G: "em cho mờ nhẹ viền răng cưa này"): độ đậm theo độ sâu tăng dần mềm hơn (`smoothstep(0,03, 0,12)` × 0,9); `POST.blit` lấy trung bình 5 điểm của lượng mực.
- Bỏ gối ôm tròn ở đầu phải sofa và gối xanh của module sofa (`sofa_pillow`) cạnh tay phải (G: "em remove gối ôm, gối xanh, chỉ để lại gối vàng trong hình"). Gối mù tạt phía sau giờ lộ ra. Gối ôm bên trái vẫn giữ.
- Máy nghe nhạc đậm bóng hơn (G: "em render shadow thêm cho máy nghe nhạc"):
  - bóng tiếp xúc 0,74 × 0,62 → 0,84 × 0,7 m, độ tối 0,8 / 0,5 → 0,92 / 0,62;
  - bóng cửa sổ độ tối 0,62, dài 0,38 m.
- Dịch trước, để lúc bấm chuyển ngày/đêm không phải dựng shader nào:
  - shader bóng của mèo: lúc dịch trước bật tạm bóng của mèo;
  - Ngân Hà (`milkyWayParts`, `ui/words.js`): lớp này chỉ vẽ lần đầu khi trời tối. Mở trang ban ngày rồi chuyển sang đêm thì khựng 359 ms; nay không khựng.
  - Đo: không còn shader mới khi chuyển; khung chậm nhất 74 ms (ngày → đêm), 35 ms (đêm → ngày).

### Thanh cuộn dọc: xem trọn khung cảnh (`core/views.js` LIFT, 19/10/2026)

- G: "add vertical scroll bar để xem được hết khung cảnh". Góc nhìn ở nhà cắt khung như ảnh nền cover, nên trên cửa sổ rộng bị mất phần trên và phần dưới.
- Cách làm: dịch ống kính theo chiều dọc như máy ảnh kiến trúc, tường vẫn thẳng đứng: `camera.setViewOffset(W, H, -shift·W, LIFT.cur·H, W, H)`.
  - Phạm vi từ −0,3 (lên: ngọn cây, dầm trần) đến +0,45 (xuống: pouf, tạp chí, thảm) chiều cao cửa sổ; chuyển mượt trong ~0,12 s.
  - Mỗi lần đổi góc nhìn (`goView`), khung về lại 0.
- Điều khiển:
  - thanh cuộn ở mép phải (`#l3-lift` trong `#l3-ui`, `buildLift`/`placeLift` ở `overlay.js`): độ dài thanh trượt bằng phần đang thấy trên tổng phần xem được; kéo được, bấm vào rãnh để nhảy tới;
  - lăn chuột hoặc trackpad trên phòng;
  - phím ↑ ↓ PageUp PageDown (`picking.js`).
  - Ẩn khi đồng hồ hoặc máy ảnh đang bay ra (`body.ck-out`).
- Nhãn, đường nối, lớp sắc nét và phép bắt chuột đều dùng `camera.projectionMatrix`, nên tự trôi theo. Đồng hồ trời là HTML nên đứng yên.
- Kiểm tra: `lifttest.cjs` (thư mục test): lăn xuống, lăn lên, kéo, đổi góc thì về 0.

### Mô hình ISS trên nóc kệ Geography (`lib3d/world/iss.js`, 17/10/2026)

- Mẫu "ISS" của uperesito (CC BY 4.0) đứng trên giá kiểu 747, trên nóc kệ thấp phía sau, ngay trên ô Geography, trước cửa kính (khung kính bên phải, chỗ G khoanh).
- `iss.glb` 360 KB, dựng bằng `tools/iss/make.mjs` (xem `tools/iss/README.md`):
  - một mesh, một vật liệu;
  - 36 texture gộp trong atlas 1024×512, thuộc tính `_CELL`/`_UVT`, shader `issPatch` lặp vân trong ô;
  - không có pháp tuyến, đổ bóng phẳng.
- Kích thước và tư thế:
  - Rộng 71 cm (lúc đầu 88 cm, ngày 18/10 G cho nhỏ đi 10 % hai lần), tấm pin gần nằm ngang, nghiêng 30° (đầu Nga ở phía sau, nâng lên; `IS.tilt`, G 18/10 — trước đó đứng thẳng ngả 12°), xoay 18° về phía mắt người xem, tâm ở (1,68; 3,51), cần đỡ chống từ dưới vào lưng phòng thí nghiệm Mỹ.
  - Giá đỡ `standParts(rodTop, 1.215)` (hàm của `b747.js`, có thêm hệ số kích thước). Cần cao khoảng 0,86 m.
  - Đế đặt giữa nóc kệ. Lưng trạm cách kính ít nhất 4 cm, đế cách thanh ngang chân kính.
- Vẽ sắc nét trên lớp 6 qua `crispPass`, có viền chọn như 747. Có đèn trưng bày riêng chỉ trên lớp 6 (`ISS.key`, cường độ 1,6) vì nó đứng xa các đèn của phòng.
- Bắt chuột (`issHit`):
  - Đế và cần thử bằng hộp bao.
  - Thân trạm thử bằng lưới ô vuông khoảng 100 ô theo chiều dài (`issVoxels`), tia chuột đi qua lưới bằng DDA, nên khe giữa các cánh pin không bắt chuột.
  - Bấm thì mở `ISS.url` (https://michaeltran75.github.io/iss-station/) trong tab mới.
- Ở khung nhìn chính với cửa sổ thấp (vd. 1512×945), góc trên bên trái của trạm nằm dưới chữ SET của đồng hồ trời. Ở khung nhìn Research chỉ thấy nửa dưới trạm ở mép trên. Ở ngăn Geography chỉ thấy cần.

### Thời tiết trực tiếp (`src/weather/`)

- `sky-weather.js` + `.css`: thời tiết nơi người xem (Open-Meteo, 15 phút; từ 17/10 lấy đúng chỗ `HL_SUN.place` mà giờ mặt trời mọc/lặn dùng: thành phố chính của múi giờ máy họ, giờ Việt Nam → Pleiku; bộ nhớ đệm `hiddenLibrary.weather.v2` ghi kèm lat/lon, đổi chỗ thì bỏ) dưới đồng hồ mặt trời/mặt trăng của trang; mây theo độ phủ và hướng/tốc độ gió, mưa, chớp khi dông. Script thường (không thuộc lib3d), nên điện thoại cũng có. `build.py` chèn vào cả hai bản. Xem thử: `?wx=clear|wind|fog|drizzle|rain|storm`.
- Trạng thái cho phần còn lại của trang: `window.HL_WEATHER`, sự kiện `hl-weather`, `<html data-wx>`.

### Mặt trời theo giờ địa phương (`src/sun/`, 17/10/2026)

- `sun-clock.js` → `window.HL_SUN` (`place`, `at(d)`, `times(d)`, `minutes(d)`, `isDay(d)`): một nguồn duy nhất cho giao diện sáng/tối, đồng hồ bầu trời, biểu tượng thời tiết và ánh sáng phòng 3D. Script thường, `build.py` chèn vào `<head>` (cả hai bản, điện thoại cũng có) để giao diện đúng ngay lần vẽ đầu.
- Nơi người xem: múi giờ của trình duyệt (`Intl…timeZone`) → thành phố chính của múi giờ đó (`zones.js`, từ zone.tab của IANA). Không hỏi quyền vị trí (iframe Wix khác origin vốn không được dùng geolocation). Giờ Việt Nam (`Asia/Ho_Chi_Minh`, Chromium gọi là `Asia/Saigon`) hoặc UTC+7 với trình duyệt tiếng Việt → Pleiku. Múi giờ lạ → 14° B, kinh tuyến chuẩn của múi giờ.
- Tính toán: phương trình NOAA (theo Meeus) từ thời điểm UTC, có khúc xạ; mọc/lặn khi tâm Mặt Trời ở −0,833°. Ngày của trang = từ phút mọc đến phút lặn theo đồng hồ địa phương; vùng cực: cả ngày sáng hoặc cả ngày tối.
- `build.py` vá script của trang (`SUN_PATCHES`): bỏ giờ cố định 6:22/17:30, mốc RISE/SET của đồng hồ bầu trời tính lại mỗi ngày, mốc 12:00 đặt đúng chỗ.
- Bảng múi giờ: `python3 tools/sunplace/make.py` (đọc `/usr/share/zoneinfo/zone.tab` của macOS + `tools/sunplace/cldr-zones.json`, danh sách tên Chromium trả về; 19 tên cũ như `Asia/Saigon`, `Asia/Calcutta` khớp theo tệp zoneinfo giống hệt).

### Build (`build.py`)

- `bundle_lib3d()` lần theo chuỗi import từ `main.js`, ghép các mô-đun theo thứ tự dựng thành một mô-đun, bỏ import/export.
  - three.js vào qua `import()` động sau bước kiểm tra màn hình, nên điện thoại không tải.
  - Bản Pages ra một tệp `lib3d.js?v=băm`; bản Wix ra một tệp HTML tự chứa.
  - Lý do ghép: tải một tệp nhanh hơn 41 tệp nối chuỗi.
- `build.py --pages DIR --dev`: thêm `DIR/dev.html` chạy thẳng 41 mô-đun, không ghép, để sửa và gỡ lỗi.

### Thêm một tính năng

1. Tạo `lib3d/<nhóm>/<tên>.js`, dòng đầu `import './<mô-đun đứng trước>.js';`, rồi import những gì cần.
2. Mô-đun đứng sau nó (hoặc `main.js` nếu nó đứng cuối) đổi dòng đầu sang import tệp mới.
3. Gọi hàm dựng của nó trong `core/build.js` (`main`) hoặc `core/loop.js` (`start`). Nếu nó cần chuyển động thì thêm vào `loop`, như `stepDeck` và đom đóm.

### Kiểm tra tương đương (`tools/split/compare.cjs`)

So bản cũ với bản mới bằng mã băm cảnh và ảnh chụp lúc 15:00 / 17:40 / 20:00, với đồng hồ giữ ở 10 s. Kết quả lúc tách:
- Ảnh ngày trùng từng điểm ảnh.
- Ảnh đêm lệch 3 điểm ảnh × 1/255 ở mặt trăng, do pha trăng tính theo giờ thật. Hai lần chạy cùng một bản cũ cũng lệch như vậy.
- Cảnh trùng hết, trừ id vật liệu của mấy cuốn sách lấy từ GLB, vốn đổi giữa các lần tải.
- `devcheck.cjs`: 41 tệp chạy thẳng, không lỗi, ảnh trùng.

### Bước tiếp theo

Đề xuất, chưa làm:
- Một sổ đăng ký tính năng `FEATURES` (`build` / `step` / `sharp` / `onHour`), để vòng lặp tự hỏi từng tính năng thay vì liệt kê tay trong `loop`.
- Các mục tối ưu ở phần 3.
