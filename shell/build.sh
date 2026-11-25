#!/usr/bin/env bash
# 編譯 Windows 版 exe：把主程式 HTML 放進 exe 裡，輸出到 dist/
# 程式圖示在 rsrc_windows_amd64.syso（由 app.ico、app.rc 產生，go build 會自動帶入）。
# 換圖示時：換掉 app.ico 後執行 llvm-windres --target=pe-x86-64 -i app.rc -o rsrc_windows_amd64.syso
set -euo pipefail
cd "$(dirname "$0")"
cp "../app/審勘文件管理.html" app.html
mkdir -p ../dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/FireReviewDocs.exe .
echo "done: dist/FireReviewDocs.exe"
