#!/usr/bin/env bash
# 端對端測試：編譯開發版本機服務 → 產生假資料 → 用 Chromium 跑完整流程
set -euo pipefail
cd "$(dirname "$0")/.."
cp "app/審勘文件管理.html" shell/app.html
(cd shell && go build -o /tmp/fire-dev .)
export E2E_WORK=/tmp/fire-e2e FIRE_BIN=/tmp/fire-dev
python3 tests/make_fixtures.py "$E2E_WORK" "app/審勘文件管理.html"
NODE_PATH="$(npm root -g)" node tests/e2e.js
