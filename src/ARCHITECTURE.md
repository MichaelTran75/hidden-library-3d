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
          decor/{kit, atlas, items, build}.js   cat.js (thân mèo: tư thế, lò xo, IK, dáng đi)   fur.js (lông: 20 lớp shell, ánh sáng nướng trong không gian texture)   pets.js (tập tính mèo, gà, lớp vẽ sắc nét)   b747.js (mô hình 747-8 trên kệ Research, dựng từ số đo; viền chọn, bấm mở link)   clock.js (đồng hồ trung cổ trên kệ cao: bánh răng theo giờ thật, chuông mỗi giờ)
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
- Mẫu "Ardavin's Medieval Clock" (Miguel Garcia, CC BY 4.0) cao 68 cm, file `clock.glb` 815 KB.
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
- Mèo to thêm 10 % (`CATR.scale` 1,375 → 1,5125), vết lún nệm và độ chìm khi nằm đêm tăng theo.

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
