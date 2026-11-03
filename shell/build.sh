#!/usr/bin/env bash
# 編譯 Windows 版 exe：把主程式 HTML 放進 exe 裡，輸出到 dist/
set -euo pipefail
cd "$(dirname "$0")"
cp "../app/審勘文件管理.html" app.html
mkdir -p ../dist
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../dist/FireReviewDocs.exe .
echo "done: dist/FireReviewDocs.exe"
