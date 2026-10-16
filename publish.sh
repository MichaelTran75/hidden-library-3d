#!/bin/bash
# Dựng lại trang từ "3D Library ver 01/src" (đọc file Hidden Library gốc trong WIX), chép mã nguồn vào src/ và đăng lên GitHub Pages.
#   ./publish.sh "mô tả thay đổi"
set -euo pipefail
cd "$(dirname "$0")"
python3 "../3D Library ver 01/src/build.py" --pages .
# the source goes up with it (src/: the modules, build.py, the tools and data, not the backups), with the page it was
# built from (the live Hidden Library page), so the repo can build itself again
rsync -a --delete --exclude 'backup/' --exclude '__pycache__/' --exclude '.DS_Store' "../3D Library ver 01/src/" src/
LIVE="$HOME/Desktop/B. Ebook & Audio Book/⭕/Nexus Antigravity/CORE FILES (ROOT)/JADE/WATCHLIST/WIX/Hidden Library.html"
if [ -f "$LIVE" ]; then cp "$LIVE" src/hidden-library.base.html; fi
git add -A
if git diff --cached --quiet; then echo "Không có thay đổi."; exit 0; fi
git commit -m "${1:-Cập nhật}"
git pull --rebase --quiet
git push
echo "Đã đăng: https://michaeltran75.github.io/hidden-library-3d/ (Pages cần ~1 phút để cập nhật)"
