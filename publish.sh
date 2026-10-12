#!/bin/bash
# Dựng lại trang từ "3D Library ver 01/src" (đọc file Hidden Library gốc trong WIX) và đăng lên GitHub Pages.
#   ./publish.sh "mô tả thay đổi"
set -euo pipefail
cd "$(dirname "$0")"
python3 "../3D Library ver 01/src/build.py" --pages .
git add -A
if git diff --cached --quiet; then echo "Không có thay đổi."; exit 0; fi
git commit -m "${1:-Cập nhật}"
git pull --rebase --quiet
git push
echo "Đã đăng: https://michaeltran75.github.io/hidden-library-3d/ (Pages cần ~1 phút để cập nhật)"
