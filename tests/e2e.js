// exe 模式端對端測試：本機服務（Linux 開發版）+ Chromium
// 執行方式：bash tests/run.sh
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), http = require('http');
const W = process.env.E2E_WORK || '/tmp/fire-e2e';
const BIN = process.env.FIRE_BIN || '/tmp/fire-dev';
const NEXT = JSON.parse(fs.readFileSync(path.join(W, 'upd', 'latest.json'), 'utf8')).app;
const CUR = fs.readFileSync(path.join(__dirname, '..', 'app', '審勘文件管理.html'), 'utf8').match(/APP_VERSION = '([0-9.]+)'/)[1];
const PORT = 47399, UPORT = 47400;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 更新伺服器
  const upd = http.createServer((q, r) => { const f = path.join(W, 'upd', path.basename(q.url)); if (fs.existsSync(f)) { r.end(fs.readFileSync(f)); } else { r.statusCode = 404; r.end(); } }).listen(UPORT);
  const env = { ...process.env, FIRE_PORT: String(PORT), FIRE_HOME: path.join(W, 'home'), FIRE_UPDATE_BASE: `http://127.0.0.1:${UPORT}/` };
  const start = () => { const p = spawn(BIN, [], { env }); p.stdout.on('data', d => process.stdout.write('[srv] ' + d)); p.stderr.on('data', d => process.stdout.write('[srv!] ' + d)); return p; };
  let srv = start(); await sleep(800);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  let pick = path.join(W, 'root');
  await page.route('**/api/pickdir', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ path: pick }) }));
  const base = `http://127.0.0.1:${PORT}/`;

  // 1. 第一次開啟：找不到系統資料夾 → 選一次
  await page.goto(base); await sleep(800);
  check('首次開啟顯示選資料夾畫面', await page.isVisible('button:has-text("選擇系統資料夾")'));
  check('版本號 v' + CUR, (await page.textContent('#appVer')) === 'v' + CUR);
  await page.click('button:has-text("選擇系統資料夾")'); await sleep(1500);
  check('選好後進入主畫面', await page.isVisible('#layout'));
  check('建立 系統設定.json', fs.existsSync(path.join(W, 'root', '系統設定.json')));
  const cfg = JSON.parse(fs.readFileSync(path.join(W, 'home', 'config.json'), 'utf8'));
  check('記住系統資料夾', cfg.root === path.join(W, 'root'));

  // 2. 更新提示
  await sleep(1500);
  check('出現更新提示 v' + NEXT, await page.isVisible('#updBar') && (await page.textContent('#updBar')).includes('v' + NEXT));

  // 3. 重新開啟：直接進入，不用再選
  await page.reload(); await sleep(1500);
  check('重新開啟自動進入主畫面', await page.isVisible('#layout') && !(await page.isVisible('button:has-text("選擇系統資料夾")')));
  const tplCount = await page.evaluate(() => S.tplFiles.length);
  check('讀到模板', tplCount === 7, `(${tplCount})`);
  const t0 = await page.evaluate(() => S.tplFiles[0]);
  check('模板修改時間正確', Math.abs(t0.lastModified - fs.statSync(path.join(W, 'root', 'templates', t0.name)).mtimeMs) < 2, t0.name);

  // 3b. 產出前在預覽上改字
  await page.evaluate(() => { setPvStep(1); });
  await sleep(500);
  await page.click('#pvpane .pvtabs button:has-text("委託書")');
  await page.waitForSelector('#pvbody p[data-pi]', { timeout: 10000 });
  check('預覽段落可點選修改', (await page.$$('#pvbody p[data-pi]')).length >= 3);
  check('預覽沒有殘留段落編號', !(await page.textContent('#pvbody')).includes(''));
  await page.click('#pvbody p[data-pi]:has-text("工程名稱")');
  await page.waitForSelector('.modal textarea');
  const orig = await page.inputValue('.modal textarea');
  check('編輯框顯示模板原文（含 {欄位}）', orig === '工程名稱：{工程名稱}　地址：{建築地址}', orig);
  await page.fill('.modal textarea', '本案名稱：{工程名稱');
  await page.click('.modal .btn.primary:has-text("套用")'); await sleep(300);
  check('大括號不成對會提醒', (await page.textContent('.modal .ederr')).includes('不成對'));
  await page.fill('.modal textarea', '本案名稱：{工程名稱}　地址：{建築地址}');
  await page.click('.modal .btn.primary:has-text("套用")');
  await page.waitForSelector('#pvbody p.pved', { timeout: 10000 });
  check('預覽立即顯示修改後文字', (await page.textContent('#pvbody p.pved')).includes('本案名稱：'));
  check('顯示已修改段數', (await page.textContent('#pvedits')).includes('1 段'));

  // 4. 產出文件
  pick = path.join(W, 'case');
  await page.evaluate(() => {
    for (const f of S.settings.fields) S.cs.values[f.name] = S.cs.values[f.name] || ('測' + f.name);
    S.cs.values['工程名稱'] = '城市倉儲新建工程'; S.cs.abbr = '城市倉儲';
    for (const d of S.settings.docs) S.cs.docChoices[d.id] = { include: !d.checklist, tpl: 0 };
    if (!document.querySelector('#checkResult')) document.body.append(Object.assign(document.createElement('div'), { id: 'checkResult' }));
    window.__gen = generate();
  });
  for (let i = 0; i < 6; i++) { // 依序按掉確認視窗，直到出現產出結果
    await sleep(800);
    if (await page.isVisible('.modal .hd:has-text("產出結果")')) break;
    const b = await page.$('.modal .ft .btn.primary'); if (b) await b.click();
  }
  const resultText = await page.textContent('.modal').catch(() => '');
  check('出現產出結果', resultText.includes('產出結果'));
  check('結果有「開啟資料夾」按鈕', await page.isVisible('.modal button:has-text("開啟資料夾")'));
  await page.click('.modal button:has-text("關閉")');
  const outs = fs.readdirSync(path.join(W, 'case'));
  console.log('case files:', outs.join(' | '));
  check('產出 5 份 Word', outs.filter(f => f.endsWith('.docx')).length === 5);
  check('產出 案件資料.json 與 用印檢查表', outs.includes('案件資料.json') && outs.includes('用印檢查表.html'));
  check('沒有留下暫存檔', !outs.some(f => f.includes('.tmp')));
  const wt = outs.find(f => f.includes('委託書'));
  const xml = require('child_process').execSync(`unzip -p "${path.join(W, 'case', wt)}" word/document.xml`).toString();
  check('Word 內容已帶入資料', xml.includes('城市倉儲新建工程') && !xml.includes('{工程名稱}'), wt);
  check('Word 套用修改的文字', xml.includes('本案名稱：') && !xml.includes('工程名稱：城市'));
  check('其他段落維持原樣（粗體、定位點）', xml.includes('<w:tab/>') && xml.includes('<w:b/>'));
  const sq = require('child_process').execSync(`unzip -p "${path.join(W, 'case', outs.find(f => f.includes('申請書')))}" word/document.xml`).toString();
  check('其他文件不受影響', sq.includes('工程名稱：') && !sq.includes('本案名稱'));
  const rec = JSON.parse(fs.readFileSync(path.join(W, 'case', '案件資料.json'), 'utf8'));
  check('案件資料記住修改內容', Object.values(rec.edits.d08.paras).includes('本案名稱：{工程名稱}　地址：{建築地址}'));

  // 4b. 另存為模板版本
  await page.click('#pvedits button:has-text("另存為模板版本")');
  await page.fill('.modal input', '倉儲用');
  await page.click('.modal .btn.primary:has-text("存檔")'); await sleep(2500);
  const vf = path.join(W, 'root', 'templates', '委託書_倉儲用_template.docx');
  check('另存的模板檔已建立', fs.existsSync(vf));
  const vx = fs.existsSync(vf) ? require('child_process').execSync(`unzip -p "${vf}" word/document.xml`).toString() : '';
  check('另存的模板保留 {欄位}', vx.includes('本案名稱：{工程名稱}') && !vx.includes('城市倉儲'));
  const st2 = JSON.parse(fs.readFileSync(path.join(W, 'root', '系統設定.json'), 'utf8'));
  const d08 = st2.docs.find(d => d.id === 'd08');
  check('新版本出現在版本選單', d08.templates.some(t => t.label === '倉儲用' && t.file === '委託書_倉儲用_template.docx'));
  check('版本紀錄有寫來源', (st2.templates['委託書_倉儲用_template.docx'].history[0].note || '').includes('另存'));
  const after = await page.evaluate(() => ({ tpl: S.cs.docChoices.d08.tpl, ed: !!S.cs.edits.d08 }));
  check('案件改用新版本、修改已併入', after.tpl === 1 && !after.ed, JSON.stringify(after));
  await sleep(1200);
  check('新版本預覽沒有修改標記', (await page.$$('#pvbody p.pved')).length === 0 && (await page.textContent('#pvbody')).includes('本案名稱：'));

  // 5. 掃描檔：讀、寫、刪、同資料夾判斷
  const r5 = await page.evaluate(async (dir) => {
    const d = new NDir(dir), out = new NDir(dir + '/out');
    const list = await listFiles(d, /\.pdf$/i);
    const f = await readFile(d, list[0]);
    const sub = await getSub(d, 'out', true);
    await writeFile(sub, '08城市倉儲-委託書.pdf', f);
    await d.removeEntry(list[1]);
    let nf = false; try { await d.getFileHandle('不存在.pdf'); } catch (e) { nf = e.name === 'NotFoundError'; }
    return { list, type: f.type, size: f.size, same: await d.isSameEntry(new NDir(dir + '/')), diff: await d.isSameEntry(out), nf };
  }, path.join(W, 'scan'));
  check('掃描檔清單', r5.list.length === 2, JSON.stringify(r5));
  check('PDF 類型正確（可預覽）', r5.type === 'application/pdf');
  check('另存改名', fs.existsSync(path.join(W, 'scan', 'out', '08城市倉儲-委託書.pdf')));
  check('刪除原檔', !fs.existsSync(path.join(W, 'scan', 'scan1.pdf')));
  check('同資料夾判斷', r5.same && !r5.diff);
  check('找不到檔案回報正確', r5.nf);

  // 6. 安全：沒有通行碼或網址不對都拒絕
  const noTok = await fetch(`${base}api/info`).then(r => r.status);
  const badHost = await new Promise(res => http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', headers: { Host: 'evil.example:' + PORT } }, r => res(r.statusCode)));
  check('沒有通行碼被拒絕', noTok === 403);
  check('外部網址被拒絕', badHost === 403);

  // 7. 套用更新
  await sleep(1800);
  await page.click('#updBar button:has-text("立即更新")'); await sleep(300);
  await page.click('.modal .btn.primary:has-text("開始更新")');
  await page.waitForLoadState('load'); await sleep(2000);
  check('更新後顯示 v' + NEXT, (await page.textContent('#appVer')) === 'v' + NEXT);
  check('更新後不再提示', !(await page.isVisible('#updBar')));
  check('新版存到快取', fs.existsSync(path.join(W, 'home', 'cache', 'app.html')));

  // 8. 重開程式：沿用已下載的新版
  srv.kill('SIGINT'); await sleep(500); srv = start(); await sleep(800);
  await page.goto(base); await sleep(1500);
  check('重開後仍是新版且自動進入', (await page.textContent('#appVer')) === 'v' + NEXT && await page.isVisible('#layout'));

  // 9. 一次只能開一個
  const second = spawn(BIN, [], { env }); let out2 = '';
  second.stdout.on('data', d => out2 += d); await sleep(1500);
  check('重複開啟會提示已開啟', out2.includes('程式已經開著了'), out2.trim());

  check('沒有畫面錯誤', errs.length === 0, errs.join(' / '));
  await browser.close(); srv.kill('SIGINT'); upd.close();
  console.log(`RESULT ${results.filter(Boolean).length}/${results.length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
