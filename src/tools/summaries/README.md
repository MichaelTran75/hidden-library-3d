# Tóm tắt sách (`summaries/books.json`)

Khi sách đang phát (đã bay ra khỏi kệ), bấm vào sách thì sách mở ra phần tóm tắt (`lib3d/ui/leaves.js`, G 18/10/2026).

## Nội dung

- 25 cuốn trong nhóm Books, mỗi cuốn có bản tiếng Anh và tiếng Việt. Mỗi bản gồm:
  - một trang tổng quan (`over`);
  - các phần `[nhãn ngắn, tiêu đề, nội dung]`, thường là 3 phần.
- Nội dung viết bằng lời của Hidden Library, không chép nguyên văn sách.
- Tra cứu thêm cho những cuốn chưa chắc nội dung (18/10/2026):
  - "Trò chơi quyền lực" (Ngô Di Lân, Omega Plus 2024): bài giới thiệu trên sggp.org.vn và baolaocai.vn.
  - "Money Masters of Our Time": danh sách 17 nhà đầu tư theo các trang bán sách.
  - "Paths to Wealth Through Common Stocks": mục lục của Wiley.
  - "When to Rob a Bank": trang Wikipedia và lời giới thiệu của nhà xuất bản.
- Cú pháp trong nội dung:
  - các đoạn cách nhau một dòng trống;
  - dòng bắt đầu bằng `- ` là một mục trong danh sách;
  - `**đậm**`, `*nghiêng*`.

## Sửa và dựng lại

1. Sửa `part1.py` … `part5.py`:
   - part1: Business, Innovation & Investing;
   - part2, part3: Psychology & Behavioral Economics;
   - part4: Economics & World History;
   - part5: Science & Big Ideas.
2. Chạy `python3 tools/summaries/make.py`. Script ghép các phần thành `summaries/books.json` và kiểm tra:
   - mỗi cuốn đủ hai thứ tiếng, số phần ở hai thứ tiếng bằng nhau;
   - tên sách (khoá) khớp với `en` trong `lib3d/ui/book-data.js`.
3. `build.py` nhúng thẳng vào trang một-file; trên Pages thì ghi ra `summaries.json` và chỉ tải khi có người mở sách lần đầu.
4. Kiểm tra bố cục: trong trang, chạy `await __lib3d.readCheck()`. Kết quả cho từng cuốn:
   - trang tổng quan có vừa một trang không (ở cả hai thứ tiếng);
   - sách có bao nhiêu trang đôi;
   - cỡ chữ đã dùng.

## Trong sách

- Trang trái (mặt trong bìa): tên sách, tác giả · năm · số trang, tên các phần.
- Trang 1: tổng quan.
- Sau đó các phần chạy liền nhau như chữ trong sách thật, với cỡ chữ cố định 3 % bề rộng trang. Tiêu đề một phần không đứng cuối trang nếu còn quá ít chỗ.
- Ghi chú của chính trang (các hộp thoại "Note") nối tiếp sau phần tóm tắt.
- Bấm trang phải để lật tới, trang trái để lật lại. Bấm bìa, hoặc bấm qua trang cuối, thì sách gập lại nhưng vẫn phát.
- Pause thì sách về kệ; phát tiếp thì sách lại bay ra.
