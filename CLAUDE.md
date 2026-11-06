# 工作守則（給 Claude 看）

## 專案是什麼
消防審勘文件管理工具。依案件類別套用 Word 模板產出可編輯的 .docx、用印檢查表、掃描檔改名與出錯檢查。
使用者是公司內部同事，透過 Google 雲端硬碟共用「審勘文件系統」資料夾（模板、系統設定.json）。

## 和使用者溝通
- 使用者沒有程式背景：一律用**繁體中文、白話**說明，避免術語；必要的術語要附一句解釋。
- 不要只貼指令或程式碼當回報，要說明「改了什麼、使用者要怎麼確認」。
- git 操作（pull、commit、push、tag、release）由 Claude 代勞，使用者不需要自己下指令。

## 絕對不能上傳到 GitHub 的東西（repository 是公開的）
- 金鑰、密碼、Token、任何帳號憑證
- 案件資料（案件資料.json、產出的 Word/PDF、掃描檔）
- 模板 .docx、系統設定.json、常用資料（業主、建築師、專技人員的姓名、電話、地址、證號、統編）
- 程式內建的預設值也不能放真實個人或公司資料
每次 commit 前先檢查差異內容有沒有上述資料。

## 資料夾架構
- `app/審勘文件管理.html`：主程式（單一 HTML，內含 JSZip、docx-preview 函式庫與主程式）。可用瀏覽器直接開，也可由 exe 開。
- `shell/`：exe 外殼（Go + WebView2）。只負責開視窗、本機檔案存取、線上更新；畫面與功能都在 HTML。
  - `main.go`：本機服務（127.0.0.1:47321，隨機通行碼 `X-App-Token`）、設定檔、更新邏輯
  - `ui_windows.go`：視窗、選資料夾對話框；`ui_other.go`：Linux 開發測試用（不開視窗）
  - `build.sh`：編譯 `dist/FireReviewDocs.exe`（會把 HTML 複製成 `shell/app.html` 內嵌）
- `tests/`：端對端測試，`bash tests/run.sh`（Linux 跑本機服務 + Playwright Chromium，83 項）
- `.github/workflows/release.yml`：main 上 CHANGELOG 出現有日期的新版本時，自動編譯並建立 Release
- `docs/`：給人看的說明；`CHANGELOG.md`：每次發布的更新說明（白話）

## exe 模式的運作
- 外殼在 HTML 的 `<head>` 注入 `window.__NATIVE__`；HTML 偵測到就改用 `NDir`/`NFile`（模仿瀏覽器資料夾物件，走本機服務），其餘程式不必改。
- 系統資料夾尋找順序：上次使用 → exe 所在資料夾 → 預設 G:\ 路徑 → 都沒有才請使用者選。
- 使用者設定存在 `%APPDATA%\審勘文件管理\config.json`；下載的新版畫面與 WebView2 資料在 `%LOCALAPPDATA%\審勘文件管理\`。
- 線上更新讀 `https://github.com/q169920t/fire-review-docs/releases/latest/download/` 的 `latest.json`、`app.html`、`FireReviewDocs.exe`。
  - 只改 HTML：`APP_VERSION` 調升即可，使用者按「立即更新」後重新載入畫面。
  - 改了外殼（shell/）：要調升 `main.go` 的 `ShellVersion`，更新時會換 exe 並重新啟動。
- 退回舊版的做法：把舊程式碼用**更高的版本號**重新發布（例如 v1.5 有問題 → 以 v1.4 的內容發布 v1.5.1），不要刪 Release。

## 預覽改字與另存模板版本
- 案件資料 `cs.edits = { 文件id: { file: 模板檔名, paras: { 段落編號: 新文字 } } }`；段落編號 = `word/document.xml` 裡 `w:p` 的順序（含表格內段落），只對同一個模板檔有效。
- 新文字保留 `{欄位}` 標記，產出時先改字再帶入資料（`fillTemplate(buf, resolve, { edits })`）；`\t`=定位點、`\n`=換行，整段沿用第一段文字的格式；頁首頁尾不開放修改。
- 預覽用 `{ tag: true }` 在每段開頭塞私用區字元編號（U+E000…），渲染後 `tagPreview()` 取出並移除。
- 「另存為模板版本」寫成 `templates/<原名>_<版本名>_template.docx`，加進該文件的 `templates` 清單，案件改選新版本並清掉 edits。

## 資料檢查表與條件標記
- 文件的 `no` 對應資料檢查表項次；檢查表上有該項次的文件（`byCl`），是否產出由檢查表決定（「不須」＝不產出），不看 `docChoices.include`。`no` 為負數＝檔名不加編號（`noLabel()`）。
- 條件標記（`applyConds()`，只有傳 `cond: condEval` 才處理）：`{列:13}`、`{列:□變更使用}`，逗號＝AND、`|`＝OR、前面加 `!`＝NOT；條件不符刪段落，表格列內容全空就刪列；`{序}` 依保留順序編號。`analyzeTemplate` 會把條件引用記在 `info.condCl` / `info.condChecks`（供重新產出判斷影響），不當成欄位。
- 寫入 □ ■ 的 run 會補 `w:rFonts w:hint="eastAsia"`（`ensureEAHint`），避免 Word 用英文字型顯示而變小。
- 注意：系統設定在共用雲端硬碟，新功能用到的設定（例如 `no: -1`、條件標記模板）要等新版發布後，舊版程式才看得懂。

## 我的案件（案件存檔與修正重新產出）
- 清單存在系統資料夾 `案件紀錄\<使用者名稱>.json`（每人一份），每筆含 `id`（= 案件資料的 `caseId`）、資料夾名稱與路徑、完整案件資料快照。
- 產出新案件後自動進入「修正模式」（`S.editing`，存在 localStorage `editingCase`）；修正模式下「產出」改走 `regenerate()`：比對 `diffCase()` → `affectReasons()` 預選受影響文件 → 舊檔移到 `_舊版\YYYYMMDD-HHmm\` → 更新 `outputs`（重產的加 `revisedAt`）與 `history`。
- 修正模式下啟動時不把日期改成今天。
- 「存檔」（`saveCaseDraft`）：未產出的案件記成 `status: 'draft'`（`S.drafting`，localStorage `draftingCase`），產出時沿用同一個 id，`logCase` 會把它換成 `status: 'done'`；已產出案件存檔只寫 `entry.draft` / `draftAt`，打開時若 `draftAt` 比案件資料新就用草稿內容。
- 用印檢查表.html 已移除（由「圖審所需文件」取代）；文件的 `stamps` 仍保留，掃描檔改名用來提醒缺少的用印文件。

## 版本與發布
- 主程式版本號是 HTML 裡的 `const APP_VERSION = 'x.y'`（畫面右上角會顯示），改版時同步更新 CHANGELOG.md。
- 「存檔上傳」= commit + push 到 main，**不發布**。
- 「發布 vX.Y」= 確認 `APP_VERSION` 是 X.Y，把 CHANGELOG 該版標題的「（尚未發布）」改成日期，例如 `## v1.6（2026-11-10）`，commit + push 到 main。GitHub Actions 偵測到「有日期、且還沒發布過」的版本，就會自動編譯並建立 Release 與標籤。只有使用者明確說要發布時才改日期。
  - 平常開發中的版本，CHANGELOG 標題一律寫「（尚未發布）」，否則一 push 就會發布。
  - 這個雲端環境不能推送標籤、也不能直接建立 Release（HTTP 403），所以才用這個方式。
  - 「已發布」的判斷是 Release 存在且附有 3 個檔案；GitHub 回 502 時流程會自動重試，殘留的空標籤不影響重跑。發布後用 `curl -sSL https://github.com/q169920t/fire-review-docs/releases/latest/download/latest.json` 確認版本號。
- 發布前先跑 `bash tests/run.sh`，全部通過才發布。
- 設定檔格式有變動時，要寫升級程式（`migrateSettings`），舊的系統設定.json 打開時自動升級，不可遺失使用者資料。

## 開發環境注意（Claude 的雲端環境）
- Go 套件下載：`export GOPROXY=direct GOSUMDB=off GOTOOLCHAIN=local GOFLAGS=-mod=mod`（proxy.golang.org 不通；golang.org/x/* 已在 go.mod 用 replace 指到 GitHub 鏡像）。
- 無法在這裡實際開 Windows 視窗；Windows 專屬部分（視窗、選資料夾、換 exe）要請使用者在自己電腦上試。

## 寫回使用者電腦
- 寫回後要在使用者電腦上確認檔案版本號正確，再回報完成。
- 主程式的預設工作資料夾：`G:\我的雲端硬碟\##歌珊\審勘文件系統`（另有 OneDrive 桌面的舊副本）。

## 使用方式
- 每人一份 exe 放在自己電腦（位置不限），不需安裝；需要 Windows 10/11 內建的 WebView2。
