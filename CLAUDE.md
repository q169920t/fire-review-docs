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
- `tests/`：端對端測試，`bash tests/run.sh`（Linux 跑本機服務 + Playwright Chromium，201 項；PDF 編輯的檢查用 `tests/pdf_check.py`，需要 pypdf、pypdfium2、reportlab）
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

## ④ PDF 編輯（合併、排序、標註、匯出）
- 函式庫放在 HTML 最後的 `<script type="text/plain">` 區塊（pdf.js 3.11.174 + worker、pdf-lib 1.17.1、@pdf-lib/fontkit 1.1.1、繁中用的 CMap），第一次進入分頁才由 `peLibs()` 載入；worker 用 Blob 建立並設 `workerPort`（直接開 HTML 檔時才不會退回慢速模式）。程式碼在 `/* PE-JS-START */` 區段，樣式在 `/* PE-CSS-START */`。
- 狀態在 `PE`：`srcs`（來源檔 bytes、pdf.js 文件、每頁大小與原本旋轉）、`pages`（`{id, src, idx, rot, anns}`，空白頁 `src:null` 並帶 `w,h`）。`peDims()` 算出畫面上的寬高與總旋轉角。
- 標註座標＝畫面上看到的方向、單位 pt、左上原點。旋轉頁面時 `peRotAnn()` 一起轉換。畫面與匯出共用 `peParts()` 產生的路徑；匯出時用 `peMatrix()` 把畫面座標換回 PDF 座標，並先 `wrapContentStreams` 包住原內容。
- 文字斷行 `peWrap()` 畫面與匯出共用；有字型（系統資料夾 `字型\` 第一個 .otf/.ttf/.ttc）時用 fontkit 量字寬並把字轉成向量路徑印上去，沒有字型就用 canvas 畫成 4 倍解析度 PNG。
- 編輯紀錄 `.pdfedit` = zip：`edit.json`（name、srcs、imgs、pages）+ `src/N.pdf` 原始檔 + `img/N.*` 插入的圖片。
- 加密的來源檔無法直接複製頁面，匯出時改用 200 dpi 圖片。
- 刪除原有圖片（v2.1）：`peLex()` 解析頁面內容，`peFindImages()` 找出每個畫圖片指令（含子圖層 Form 裡的）的位置；識別碼＝第幾個 Do/BI 指令，子圖層用 `5.2` 表示，存在頁面的 `pg.del`。偵測與刪除（`peStripImages()`）用同一套解析，永遠從**原始來源檔**算，不會因為刪過而錯位。子圖層與資源會先複製再改，不影響共用同一子圖層的其他頁；不再用到的圖片從資源拿掉，匯出前 `peGC()` 清掉沒人引用的物件，圖片才真的不在檔案裡。畫面用 `peSrcPage()` 產生刪除後的單頁版本顯示。橫跨整頁寬或高的圖片（掃描底圖、掃描條）不列出；重疊時依原本畫圖順序，最上面的點得到。
- 刪除原有物件（v2.4，擴充上面的圖片刪除）：`peLex(b, true)`（完整模式）解析字串、陣列、路徑與文字運算子；`peScanLevel()` 掃描一層內容，回傳圖片、路徑（`p`＋序號）、文字（`t`＋序號）的位置、點列與在內容中的範圍，`peFindObjects()` 遞迴子圖層並存成欄位式陣列（`s.objs[idx]`：`k/kd/bb/gs/ge/fl/pool/hide`）。識別碼仍存在 `pg.del`，圖片的編號和舊版相同（舊 .pdfedit 可用）。`peStripImages()` 同時處理三種：路徑整段刪掉；文字有字寬資料（`font.known`：Widths、CID 的 W/DW、標準字型用 `peStdInit()` 從 pdf-lib 取字寬表）時換成同寬的 `[n] TJ` 位移（後面的字不移位、文字真的消失），查不到字寬時改成 `3 Tr … 原本的 Tr`（隱形）。操作：`PE.objSel`（選取）、`PE.objHover`、`PE.band`（框選），`peObjHit()`（點到：描邊看距離、填色看是否在內，同點選面積最小）、`peObjBand()`（完全在框內），Delete 呼叫 `peObjDelete()`。大圖片（橫跨整頁寬或高）與太小的圖片不列出。
- 介面：按鈕用 `peAb(icon, label, opt)`（圖示＋短文字，label 空白＝只有圖示）；頁面整理的打勾圓圈 `.pe-chk`，選取變更只呼叫 `peRefreshSel()`（更新 class 與上方列），不可再用 `peRender()`（會讓縮圖閃爍）。
- 清除原有註解：頁面 `pg.noAnn = true`，畫面用 pdf.js `AnnotationMode.DISABLE`，匯出時刪 `/Annots`。`peSig(pg)` 是 del＋noAnn 的簽名，縮圖快取與復原後重畫都看它。
- 文字框格式：`bold`、`italic`、`underline`、`align`、`fill`（底色，null＝無）、`bcolor`（框線色，沒有時沿用 `color`）。`字型\` 檔名含 Bold／粗 的當粗體字型（`PE.fkB`）；有一般字型但沒粗體字型時用描邊加粗（`peFakeBold`）。斜體＝傾斜 `PE_ITAL`，畫面用 transform、匯出直接算在字形路徑上。
- 圖片標註 `{type:'img', key, x, y, w, h, r}`：圖片資料放在 `PE.imgs[key]`（不放進復原紀錄），編輯紀錄 ver 2 存在 `img/N.png|jpg`。去白底 `peKnockout()`。印章庫＝系統資料夾 `印章庫\`（PNG/JPG＋`印章庫.json` 記預設寬度公分），同事共用；不可放進 GitHub。
- 匯出檔名在匯出視窗裡填（`.modal .pe-name`），上方工具列不再有檔名欄。
- 檔案大小（v2.2）：`peEstimate(pages)` 用 `peWalkSize()` 走過每頁用到的物件加總大小；串流用內容雜湊當識別，所以跨來源檔相同的圖片、字型只算一次（和匯出時的 `peDedupe()` 一致，誤差約 1～5%）。每頁的物件清單快取在 `s.szInfo`（鍵含 `peSig`）。`peSizeSoon()` 在 `peRender`、`pePush`、復原時重算，更新 `#peSize` 與縮圖下的 `.pe-csz`。MB 一律用 1,000,000 bytes，限制 `PE.limitMB`（localStorage `peLimitMB`，預設 8），比 Windows 顯示的 MB 保守。
- 匯出：`peBuildPdf(progress, { pages, raster: {頁id: dpi}, onCanvas })`，最後一律 `peDedupe()` + `peGC()`。超過限制且勾選自動分割（`PE.autoSplit`）時走 `peSplitPlan()`：先找單頁就超過的頁 → `peOversizeDialog()` 列出解析度（含原解析度，`peNativeDpi()` 取佔頁面面積最多的圖片解析度、用長邊算）試算大小與預覽 → 依頁序貪婪分組（轉成圖片的頁用實際大小）→ 每組實際建檔，超過就把最後一頁移到下一組。分割檔名 `檔名(a-b頁).pdf`。轉成圖片用 `pePlaceRaster()`：灰階頁存灰階，JPEG(0.92) 與無損 Flate 取較小。
- 超過限制的處理方式 `PE.overMode`（localStorage `peOverMode`：`compress`／`split`／`none`，舊的 `peAutoSplit=false` 視為 none）。`compress` 走 `peCompressDialog()`：圖片覆蓋 ≥30% 頁面（`peImgCover()`）的頁算掃描頁，各頁只在目標 dpi 低於自己原解析度時才轉圖片；JPEG 品質 `PE_COMPRESS_Q`=0.75；由高到低試算整份大小，找到符合的再多算一個就停；選定後直接用試算的結果存檔。
- 測試注意：Playwright 的檔案選擇無法上傳中文檔名，測試時要先複製成英文檔名。e2e 會套用一次「更新」，`/tmp/fire-e2e/home/cache/app.html` 會留下舊程式；自己另外測試時要先刪掉它，否則開的是舊版。

## v2.6：竣工查驗
- 模板子資料夾：`scanTemplates` 會讀 `templates\<子資料夾>\`（`listDirs` 略過 `_ ~ .` 開頭），檔名記成 `子資料夾/檔名`；讀寫一律用 `readTpl(file)`／`writeTpl(file, blob)`（`tplLoc` 逐層找資料夾）。
- 設定 schema 5（`migrateSettings`）：欄位 `管理權人統編`、檢附資料 `外觀照片`、勾選群組「竣工查驗」的 `監造人異動`，並加入 `jungongDefaults()` 的文件（id `j..`）與類別（`cj1..3`）。
- 文件新屬性：`perRole: ['監造人','裝置人']`＝依受託人分份（`roleCopies()`，以姓名＋證書字號判斷是否同一人；分份的 `cd.doc` 是衍生物件，`id` 為 `j08@監造人`、`baseId` 指回原文件，`docById` 會去掉 `@` 後面；`cd.roles` 讓 `resolver` 把設計人欄位換成該角色欄位、並決定 {□監造}{□裝置}）。`cond: '□監造人異動'`＝文件出現條件（不符時 `cd.condOff`，勾選框仍會出現在步驟裡）。
- 模板版本可帶 `no` 與 `clSet`（例：危險物品切結書工廠版 `no: 12, clSet: {11:'不須', 6:'有'}`）：`pickTemplate()` 套用；檢查表某項改成需要時 `clLinked()` 自動換版本。cd 的項次一律看 `cd.doc.no`（已套用版本的 no）。
- 資料檢查表兩欄式（檢附／不需）：`analyzeTemplate` 數每列 `{□}` 個數存 `info.clCols`；`checklistCols(cat)`、`checklistTable(items, cols)`、`resolver` 都依此切換。內部狀態仍是 有／無／不須。
- 項次重複檢查改成「同項次且同名稱」才算檔名重複（委託書與報備書都是第 8 項）。

## v2.5：文件產出新介面、其他文件、專技人員三組、自訂模板
- 文件產出畫面（`viewGen`）只在這個分頁加 `main.gen-main`（字大、樣式都以它為前綴，不影響其他分頁）；切換分頁第一次畫面加 `.fresh` 才播淡入動畫（避免每次 `render()` 閃爍）。大按鈕 `bigBtn(icon, 標題, 一句說明, onclick, {cls,id})`。步驟列 `#stepper .stp`，卡片 id `step-N`；完成判斷 `stepDone(fields)`（必填都有值），打字時 `refreshStepMarks()` 只更新標示不重畫。欄位 `label.f` 有 `data-field`，有值加 `.filled`。e2e 依賴的 `#checkResult`、`#pvpane`、`.card.step h3`、`.editbar`、按鈕文字「存檔」「重新產出…」都要保留。
- 其他文件：文件 `pool: true` ＝放進其他文件資料庫；案件 `cs.extraDocs = [文件id]`，`caseDocs()` 會把它們接在類別文件後面（`cd.extra`，一律產出、不受檢查表決定），欄位歸到 `caseSteps()` 的「其他文件」步驟。`pickExtraDocs()` 選擇、`removeExtraDoc()` 移除。項次留白＝`no: -1`（項次重複的檢查會略過負數）。
- 專技人員：設計人＝原本欄位（`PRO_BASE`），監造人／裝置人欄位＝角色＋`PRO_SUFFIX`（`proMap(role)`）。`cs.proSame[role] === false` 才是不同人，預設同設計人；`syncPros(cs)` 在 `saveDraft`、`normalizeCase`、`validateCase` 時把設計人的值複製過去，所以產出、預覽、重新產出比對都直接看 `cs.values`。設定 schema 4（`migrateSettings`）加入群組「監造人」「裝置人」與 14 個欄位；常用資料共用「專技人員」那一組（`saveAsProfile(grp, from)` 會把監造人欄位換回專技人員欄位名稱存）。
- 自訂模板：`customTemplate(file)`（`#btnCustomTpl`）。預覽用 docx-preview，選取文字 mouseup 填入 `#ctplText`，`replaceInDocx(buf, find, '{欄位}')` 換掉所有段落裡相同的文字（可跨格式不同的片段，和 `fillTemplate` 同一套切割方式）。預覽上色 `showMarks` 要跳過 `<style>` 裡的文字（CSS 也有大括號）。儲存寫 `templates/<名稱>_template.docx`，新增文件（`pool: true`、預設 `no: -1`），新的欄位名稱自動登記在「案件資料」。
- PDF 編輯：`.pe-pages` 設 `width:max-content; min-width:100%`，放大後才捲得到最左邊；`peZoom` 也保留水平位置。來源檔標籤沒有 ×、縮圖沒有單頁刪除鈕，只有 `.pe-gbar`「刪除選取的 N 頁」；上方 `#peReset`「重新開始」一定詢問。

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
