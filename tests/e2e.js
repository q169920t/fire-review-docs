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
  check('讀到模板', tplCount === 8, `(${tplCount})`);
  const t0 = await page.evaluate(() => S.tplFiles[0]);
  check('模板修改時間正確', Math.abs(t0.lastModified - fs.statSync(path.join(W, 'root', 'templates', t0.name)).mtimeMs) < 2, t0.name);

  // 3b. 產出前在預覽上改字
  await page.evaluate(() => { setPvStep(PV.steps.findIndex(x => x.docs.some(cd => cd.doc.id === 'd08'))); });
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
  await page.fill('#userName', '測試員'); await page.dispatchEvent('#userName', 'change');
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
  check('產出 案件資料.json、不再產出用印檢查表', outs.includes('案件資料.json') && !outs.includes('用印檢查表.html'));
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
  await page.evaluate(() => { setPvStep(PV.steps.findIndex(x => x.docs.some(cd => cd.doc.id === 'd08'))); PV.doc = 'd08'; buildPvPane(); });
  await page.waitForSelector('#pvedits button:has-text("另存為模板版本")', { timeout: 10000 });
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

  // 4c. 我的案件：產出後自動記錄、修正後只重新產出受影響的文件
  const logF = path.join(W, 'root', '案件紀錄', '測試員.json');
  check('產出後記入「我的案件」', fs.existsSync(logF) && JSON.parse(fs.readFileSync(logF, 'utf8')).cases.length === 1);
  check('產出後進入修正模式', await page.isVisible('.editbar') && await page.isVisible('button:has-text("重新產出…")'));
  const t01 = fs.statSync(path.join(W, 'case', '01城市倉儲-圖說審查申請書.docx')).mtimeMs;
  await page.evaluate(() => { S.cs.values['受託人電話'] = '04-1234-5678'; saveDraft(); window.__gen = generate(); });
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    if (await page.isVisible('.modal .hd:has-text("重新產出・")')) break;
    const b = await page.$('.modal .ft .btn.primary'); if (b) await b.click();
  }
  const rg = await page.textContent('.modal').catch(() => '');
  check('列出修改內容', rg.includes('受託人電話') && rg.includes('04-1234-5678'));
  const checked = await page.$$eval('.modal tbody input[type=checkbox]', a => a.map(x => x.checked));
  check('只預選受影響的文件', checked.filter(Boolean).length === 1 && checked.length === 5, JSON.stringify(checked));
  await page.click('.modal .btn.primary:has-text("重新產出勾選的文件")');
  await page.waitForSelector('.modal .hd:has-text("重新產出結果")', { timeout: 10000 });
  await page.click('.modal button:has-text("關閉")');
  const old = fs.readdirSync(path.join(W, 'case', '_舊版'));
  const oldFiles = old.length ? fs.readdirSync(path.join(W, 'case', '_舊版', old[0])) : [];
  check('舊檔備份到 _舊版', oldFiles.includes('08城市倉儲-委託書.docx') && oldFiles.includes('案件資料.json'), oldFiles.join(','));
  const nx = require('child_process').execSync(`unzip -p "${path.join(W, 'case', '08城市倉儲-委託書.docx')}" word/document.xml`).toString();
  check('重新產出的文件有新資料', nx.includes('04-1234-5678') && nx.includes('本案名稱：'));
  check('沒受影響的文件沒有重新產出', fs.statSync(path.join(W, 'case', '01城市倉儲-圖說審查申請書.docx')).mtimeMs === t01);
  const rec2 = JSON.parse(fs.readFileSync(path.join(W, 'case', '案件資料.json'), 'utf8'));
  check('記錄修改歷程', rec2.history.length === 1 && rec2.history[0].changes.some(c => c.label === '受託人電話' && c.to === '04-1234-5678') && rec2.history[0].by === '測試員');
  check('其他文件的產出紀錄保留', rec2.outputs.length === 5 && rec2.outputs.find(o => o.docId === 'd08').revisedAt && !rec2.outputs.find(o => o.docId === 'd01').revisedAt);
  check('案件清單更新修正次數', JSON.parse(fs.readFileSync(logF, 'utf8')).cases[0].revisions === 1);

  // 4d. 清空後從「我的案件」打開
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); saveDraft(); S.tab = 'cases'; render(); });
  await page.waitForSelector('#main tbody tr', { timeout: 5000 });
  check('案件清單列出案件', (await page.textContent('#main tbody')).includes('城市倉儲新建工程'));
  await page.fill('#main input[type=text]', '找不到的字'); await sleep(200);
  check('搜尋可以篩選', (await page.$$('#main tbody tr')).length === 0);
  await page.fill('#main input[type=text]', '倉儲'); await sleep(200);
  await page.click('#main tbody button:has-text("打開修正")');
  await page.click('.modal .btn.primary:has-text("打開")'); await sleep(1200);
  const reo = await page.evaluate(() => ({ tab: S.tab, tel: S.cs.values['受託人電話'], ed: !!S.editing, y: S.cs.values['年份'] }));
  check('打開後資料帶回、進入修正模式', reo.tab === 'gen' && reo.tel === '04-1234-5678' && reo.ed && await page.isVisible('.editbar'), JSON.stringify(reo));
  await page.evaluate(() => { S.cs.values['年份'] = '100'; saveDraft(); }); await sleep(300);
  await page.reload(); await sleep(1500);
  const rl = await page.evaluate(() => ({ ed: !!S.editing, y: S.cs.values['年份'] }));
  check('重開程式仍在修正模式、日期不會被改成今天', rl.ed && rl.y === '100', JSON.stringify(rl));

  // 4e. 資料檢查表「不須」自動排除；圖審所需文件條件標記；□■ 字型
  await page.evaluate(() => { endEditing(); S.tab = 'gen'; S.cs.docChoices.d00 = { include: true, tpl: 0 }; S.cs.cl[8] = '不須'; saveDraft(); render(); }); await sleep(600);
  const ex = await page.evaluate(() => ({ inc: caseDocs().find(x => x.doc.id === 'd08').include, by: caseDocs().find(x => x.doc.id === 'd08').byCl,
    tel: [...document.querySelectorAll('#main label.f span')].some(x => x.textContent.includes('受託人電話')),
    stepTitles: [...document.querySelectorAll('.card.step h3')].map(x => x.textContent) }));
  check('檢查表「不須」的文件不產出', ex.by && !ex.inc);
  check('專用欄位隱藏', !ex.tel);
  check('資料檢查表排在第 2 步', (ex.stepTitles[1] || '').includes('資料檢查表'), ex.stepTitles.join(' / '));
  check('最後一步顯示「不須」', (await page.textContent('#main')).includes('不須'));
  const cond = await page.evaluate(async () => {
    S.settings.docs.push({ id: 'd90', no: -1, name: '圖審所需文件', stamps: [], templates: [{ label: '標準版', file: '圖審所需文件_template.docx' }] });
    catById(S.cs.category).docIds.push('d90'); await saveSettingsNow(); await scanTemplates();
    const run = async () => { const cd = caseDocs().find(x => x.doc.id === 'd90');
      const f = await readFile(await getSub(S.root, TPL_DIR), cd.file);
      const blob = await fillTemplate(await f.arrayBuffer(), resolver(cd), { cond: condEval });
      const pkg = await loadDocx(await blob.arrayBuffer());
      return { text: bodyParas(pkg).map(p => paraTexts(p).map(t => t.textContent).join('')).filter(Boolean).join('|'), rows: wEls(pkg.parts.find(x => x.name === 'word/document.xml').doc, 'tr').length, name: fileName(cd.doc.no, S.cs.abbr, cd.doc.name, '.docx'), steps: caseSteps().map(s => s.title) }; };
    S.cs.checks['新建'] = false; S.cs.checks['增建'] = false; const a = await run();
    S.cs.cl[8] = '有'; S.cs.checks['增建'] = true; const b = await run();
    S.cs.checks['新建'] = true; const c = await run(); S.cs.checks['新建'] = false;
    return { a, b, c, warn: S.tplInfo['圖審所需文件_template.docx'].warnings, fields: Object.keys(S.tplInfo['圖審所需文件_template.docx'].fields) };
  });
  check('條件不符的行被刪除', !cond.a.text.includes('委託書') && !cond.a.text.includes('核准函'), cond.a.text);
  check('條件符合的行保留、標記移除', cond.b.text.includes('■委託書') && cond.b.text.includes('■核准函') && !cond.b.text.includes('列:'), cond.b.text);
  check('整列刪除、自動編號接續', cond.b.rows === 1 && cond.b.text.includes('1、業主用印文件') && cond.b.text.includes('2、結尾') && !cond.b.text.includes('電機'), cond.b.text);
  check('條件標記不會變成表單欄位', cond.fields.length === 0 && cond.warn.length === 0, JSON.stringify(cond));
  check('排除條件：沒勾新建才列出', cond.b.text.includes('■使用執照') && !cond.c.text.includes('■使用執照') && cond.c.text.includes('■委託書'), cond.c.text);
  check('檔名不加項次編號', cond.b.name === '城市倉儲-圖審所需文件.docx', cond.b.name);
  check('沒有新欄位的文件不另開步驟', !cond.b.steps.some(t => t.includes('圖審所需文件')), cond.b.steps.join(' / '));
  const hint = require('child_process').execSync(`unzip -p "${path.join(W, 'case', '01城市倉儲-圖說審查申請書.docx')}" word/document.xml`).toString();
  check('□■ 設定為中文字型顯示', /<w:r>(?:(?!<\/w:r>).)*w:hint="eastAsia"(?:(?!<\/w:r>).)*[□■]/s.test(hint));

  // 4f. 圖審所需文件在資料檢查表那一步預覽
  await page.evaluate(() => { S.cs.docChoices.d00 = { include: true, tpl: 0 }; saveDraft(); render(); }); await sleep(500);
  const pvTabs = await page.evaluate(() => { const i = PV.steps.findIndex(x => x.title === '資料檢查表'); return i >= 0 ? PV.steps[i].docs.map(cd => cd.doc.name) : []; });
  check('資料檢查表那一步可以預覽圖審所需文件', pvTabs.includes('資料檢查表') && pvTabs.includes('圖審所需文件'), pvTabs.join(','));

  // 4g. 存檔：資料不齊也能存到「我的案件」，之後繼續填，產出後同一筆變成已產出
  pick = path.join(W, 'case2'); fs.mkdirSync(pick, { recursive: true });
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); selectCategory(S.settings.categories[0].id); S.cs.abbr = '草稿案'; S.cs.values['工程名稱'] = '草稿測試工程'; saveDraft(); render(); });
  await sleep(400);
  await page.click('#main button:has-text("存檔")'); await sleep(800);
  const lg1 = JSON.parse(fs.readFileSync(logF, 'utf8')).cases.find(c => c.abbr === '草稿案');
  check('沒產出也能存到我的案件', lg1 && lg1.status === 'draft' && lg1.draft.values['工程名稱'] === '草稿測試工程', JSON.stringify(lg1 && lg1.status));
  check('顯示草稿標示', await page.isVisible('.editbar:has-text("草稿")'));
  await page.evaluate(() => { S.cs.values['受託人電話'] = '02-0000-0000'; saveDraft(); });
  await page.click('#main button:has-text("存檔")'); await sleep(800);
  const lgN = JSON.parse(fs.readFileSync(logF, 'utf8')).cases.filter(c => c.abbr === '草稿案');
  check('再次存檔更新同一筆', lgN.length === 1 && lgN[0].draft.values['受託人電話'] === '02-0000-0000');
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); saveDraft(); S.tab = 'cases'; render(); });
  await page.waitForSelector('#main tbody tr');
  check('清單顯示「未產出（草稿）」', (await page.textContent('#main tbody')).includes('未產出（草稿）'));
  await page.fill('#main input[type=text]', '草稿案'); await sleep(200);
  await page.click('#main tbody button:has-text("繼續填寫")'); await page.click('.modal .btn.primary:has-text("打開")'); await sleep(800);
  const dr = await page.evaluate(() => ({ tel: S.cs.values['受託人電話'], d: !!S.drafting, e: !!S.editing }));
  check('打開草稿可以繼續填', dr.tel === '02-0000-0000' && dr.d && !dr.e, JSON.stringify(dr));
  await page.evaluate(() => { for (const f of S.settings.fields) S.cs.values[f.name] = S.cs.values[f.name] || ('測' + f.name); for (const d of S.settings.docs) S.cs.docChoices[d.id] = { include: !d.checklist, tpl: 0 }; saveDraft(); window.__gen = generate(); });
  for (let i = 0; i < 6; i++) { await sleep(700); if (await page.isVisible('.modal .hd:has-text("產出結果")')) break; const b = await page.$('.modal .ft .btn.primary'); if (b) await b.click(); }
  check('產出結果沒有列印用印檢查表按鈕', !(await page.isVisible('.modal button:has-text("用印")')));
  await page.click('.modal button:has-text("關閉")');
  const lgD = JSON.parse(fs.readFileSync(logF, 'utf8')).cases.filter(c => c.abbr === '草稿案');
  check('產出後同一筆變成已產出', lgD.length === 1 && lgD[0].status === 'done' && !lgD[0].draft && lgD[0].folder === 'case2', JSON.stringify(lgD.map(x => x.status + '/' + x.folder)));
  // 已產出案件：存檔不動 Word，下次打開接續存檔內容
  const m0 = fs.statSync(path.join(W, 'case2', '08草稿案-委託書.docx')).mtimeMs;
  await page.evaluate(() => { S.cs.values['受託人電話'] = '03-1111-1111'; saveDraft(); });
  await page.click('#main button:has-text("存檔")'); await sleep(800);
  const lgE = JSON.parse(fs.readFileSync(logF, 'utf8')).cases.find(c => c.abbr === '草稿案');
  check('已產出案件存檔不動 Word', lgE.draft && lgE.draft.values['受託人電話'] === '03-1111-1111' && fs.statSync(path.join(W, 'case2', '08草稿案-委託書.docx')).mtimeMs === m0);
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); saveDraft(); S.tab = 'cases'; render(); });
  await page.waitForSelector('#main tbody tr'); await page.fill('#main input[type=text]', '草稿案'); await sleep(200);
  check('清單標示有未重新產出的修改', (await page.textContent('#main tbody')).includes('未重新產出'));
  await page.click('#main tbody button:has-text("打開修正")'); await page.click('.modal .btn.primary:has-text("打開")'); await sleep(800);
  const de = await page.evaluate(() => ({ tel: S.cs.values['受託人電話'], e: !!S.editing }));
  check('打開時接續存檔內容', de.tel === '03-1111-1111' && de.e, JSON.stringify(de));
  // 刪除草稿
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); selectCategory(S.settings.categories[0].id); S.cs.abbr = '要刪的'; S.tab = 'gen'; saveDraft(); render(); }); await sleep(300);
  await page.click('#main button:has-text("存檔")'); await sleep(800);
  await page.evaluate(() => { S.tab = 'cases'; render(); }); await page.waitForSelector('#main tbody tr');
  await page.fill('#main input[type=text]', '要刪的'); await sleep(200);
  await page.click('#main tbody button:has-text("刪除")'); await page.click('.modal .btn.primary:has-text("刪除")'); await sleep(800);
  check('可以刪除草稿', !JSON.parse(fs.readFileSync(logF, 'utf8')).cases.some(c => c.abbr === '要刪的'));
  await page.evaluate(() => { endEditing(); S.cs = blankCase(); saveDraft(); });

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

  // 5b. PDF 編輯：合併、拖曳排序、旋轉、標註、匯出、編輯紀錄
  {
    const { execFileSync } = require('child_process');
    const order = () => page.evaluate(() => PE.pages.map(p => p.src ? PE.srcs[p.src].name.replace('.pdf', '') + (p.idx + 1) : 'blank'));
    await page.click('nav button:has-text("PDF 編輯")');
    await page.waitForSelector('.pe-empty');
    check('PDF 編輯：顯示拖放區', await page.isVisible('.pe-empty'));
    let fc = page.waitForEvent('filechooser'); await page.click('.pe-empty button:has-text("選擇 PDF 檔")');
    await (await fc).setFiles([path.join(W, 'pdf/A.pdf'), path.join(W, 'pdf/B.pdf')]);
    await page.waitForFunction(() => document.querySelectorAll('.pe-card').length === 3, null, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.pe-card .pe-thumb canvas').length === 3, null, { timeout: 20000 });
    check('PDF 編輯：合併兩個檔共 3 頁且縮圖顯示', (await order()).join() === 'A1,A2,B1', (await order()).join());
    const bDims = await page.evaluate(() => peDims(PE.pages[2]));
    check('PDF 編輯：原本有旋轉的頁面方向正確', bDims.W > bDims.H && bDims.t === 90, JSON.stringify(bDims));
    // 拖曳第 3 張到最前面
    const cards = await page.$$('.pe-card .pe-thumb');
    const b3 = await cards[2].boundingBox(), b1 = await cards[0].boundingBox();
    await page.mouse.move(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.mouse.down();
    await page.mouse.move(b3.x + b3.width / 2 - 20, b3.y + 40, { steps: 4 });
    await page.mouse.move(b1.x + 10, b1.y + b1.height / 2, { steps: 8 }); await sleep(100);
    check('PDF 編輯：拖曳時出現插入位置', await page.isVisible('.pe-ins'));
    await page.mouse.up(); await sleep(400);
    check('PDF 編輯：拖曳調整順序', (await order()).join() === 'B1,A1,A2', (await order()).join());
    // 旋轉、刪除、復原
    await page.hover('.pe-card >> nth=1'); await page.click('.pe-card >> nth=1 >> button[title="向右轉"]'); await sleep(300);
    check('PDF 編輯：旋轉頁面', await page.evaluate(() => PE.pages[1].rot) === 90);
    await page.click('.pe-card >> nth=2'); await page.keyboard.press('Delete'); await sleep(300);
    check('PDF 編輯：刪除頁面', (await order()).join() === 'B1,A1');
    await page.keyboard.press('Control+z'); await sleep(400);
    check('PDF 編輯：復原刪除', (await order()).join() === 'B1,A1,A2');
    await page.click('.pe-card >> nth=2'); await page.click('button:has-text("在選取頁後插入空白頁")'); await sleep(300);
    check('PDF 編輯：插入空白頁', (await order()).join() === 'B1,A1,A2,blank');
    // 標註：在第 3 頁（A2）上畫
    await page.dblclick('.pe-card >> nth=2'); await page.waitForSelector('.pe-page'); await sleep(300);
    await page.evaluate(() => { PE.zoom = 0.8; PE.scrollTo = PE.pages[2].id; peRender(); }); await sleep(800);
    const ov = await page.$('.pe-page >> nth=2 >> .pe-ov');
    await ov.scrollIntoViewIfNeeded(); await sleep(300);
    const z = await page.evaluate(() => PE.zoom);
    const at = async (x, y) => { const b = await ov.boundingBox(); return [b.x + x * z, b.y + y * z]; };
    const drag = async (tool, x1, y1, x2, y2) => {
      await page.click(`.pe-tb [data-tool="${tool}"]`);
      const [a, b] = await at(x1, y1), [c, d] = await at(x2, y2);
      await page.mouse.move(a, b); await page.mouse.down(); await page.mouse.move((a + c) / 2, (b + d) / 2, { steps: 3 }); await page.mouse.move(c, d, { steps: 3 }); await page.mouse.up(); await sleep(100);
    };
    await drag('rect', 60, 100, 260, 180);
    await drag('cloud', 300, 100, 500, 200);
    await page.click('.pe-tb [data-tool="ellipse"]'); await page.click('.pe-tb button[title="虛線"]');
    await drag('ellipse', 60, 250, 200, 330);
    await drag('arrow', 300, 300, 450, 380);
    await drag('pen', 80, 450, 200, 520);
    await drag('hl', 80, 600, 300, 600);
    const n1 = await page.evaluate(() => PE.pages[2].anns.length);
    check('PDF 編輯：畫出框線、雲朵線、圓圈、箭頭、手寫、螢光筆', n1 === 6, String(n1));
    check('PDF 編輯：圓圈為虛線', await page.evaluate(() => PE.pages[2].anns[2].type === 'ellipse' && PE.pages[2].anns[2].dash === 'dash'));
    await page.click('.pe-tb [data-tool="text"]');
    const [tx, ty] = await at(300, 470); await page.mouse.click(tx, ty);
    await page.waitForSelector('.pe-ta'); await page.keyboard.type('消防測試 ABC'); await page.keyboard.press('Escape'); await sleep(200);
    const txt = await page.evaluate(() => PE.pages[2].anns.find(a => a.type === 'text'));
    check('PDF 編輯：文字框輸入中文', txt && txt.text === '消防測試 ABC', JSON.stringify(txt && txt.text));
    check('PDF 編輯：文字顯示在頁面上', (await page.textContent('.pe-page >> nth=2 >> .pe-ov')).includes('消防測試'));
    // 選取並移動框線
    await page.click('.pe-tb [data-tool="select"]');
    const [ma, mb] = await at(60, 140), [mc, md] = await at(90, 160);
    await page.mouse.move(ma, mb); await page.mouse.down(); await page.mouse.move(mc, md, { steps: 5 }); await page.mouse.up(); await sleep(100);
    const r0 = await page.evaluate(() => PE.pages[2].anns[0]);
    check('PDF 編輯：拖曳移動標註', Math.abs(r0.x - 90) < 3 && Math.abs(r0.y - 120) < 3, `${r0.x},${r0.y}`);
    await page.click('.pe-tb button[title="顏色"] >> nth=1'); await sleep(100);
    check('PDF 編輯：改選取標註的顏色', await page.evaluate(() => PE.pages[2].anns[0].color) === '#1a5fd0');
    await page.click('.pe-tb button[title="顏色"] >> nth=0');
    // 橡皮擦刪手寫，再復原
    await page.click('.pe-tb [data-tool="eraser"]');
    const pen = await page.evaluate(() => PE.pages[2].anns.find(a => a.type === 'pen').pts[1]);
    const [ex, ey] = await at(pen[0], pen[1]); await page.mouse.click(ex, ey); await sleep(150);
    check('PDF 編輯：橡皮擦刪除', await page.evaluate(() => PE.pages[2].anns.length) === 6);
    await page.keyboard.press('Control+z'); await sleep(300);
    check('PDF 編輯：復原橡皮擦', await page.evaluate(() => PE.pages[2].anns.length) === 7);
    // 在旋轉過的第 2 頁畫一個框
    const ov2 = await page.$('.pe-page >> nth=1 >> .pe-ov'); await ov2.scrollIntoViewIfNeeded(); await sleep(200);
    { const b = await ov2.boundingBox(); await page.click('.pe-tb [data-tool="rect"]');
      await page.mouse.move(b.x + 100 * z, b.y + 100 * z); await page.mouse.down(); await page.mouse.move(b.x + 250 * z, b.y + 200 * z, { steps: 4 }); await page.mouse.up();  }
    // 匯出
    pick = path.join(W, 'pdfout');
    await page.click('#peExport'); await page.waitForSelector('.modal .pe-name');
    check('PDF 編輯：匯出視窗可以填檔名', (await page.inputValue('.modal .pe-name')).length > 0);
    await page.fill('.modal .pe-name', '測試合併');
    await page.click('.modal button:has-text("選擇資料夾並匯出")');
    await page.waitForSelector('.modal .hd:has-text("匯出完成")', { timeout: 30000 });
    const outPdf = path.join(W, 'pdfout', '測試合併.pdf');
    check('PDF 編輯：匯出 PDF 與編輯紀錄', fs.existsSync(outPdf) && fs.existsSync(path.join(W, 'pdfout', '測試合併.pdfedit')));
    await page.click('.modal button:has-text("關閉")');
    const T = await page.evaluate(() => { const a = PE.pages[2].anns.find(a => a.type === 'text'); return { ...a, th: peTextH(a) }; });
    const boxes = [[2, 88, 118, 6, 64], [2, T.x, T.y, T.w, T.th], [1, 98, 98, 4, 104], [2, 400, 700, 100, 80]];
    const res = JSON.parse(execFileSync('python3', [path.join(__dirname, 'pdf_check.py'), outPdf, JSON.stringify(boxes)]).toString());
    check('PDF 編輯：匯出頁數與順序', res.pages === 4 && res.text[0].includes('B1') && res.text[1].includes('A1') && res.text[2].includes('A2'), JSON.stringify(res.text));
    check('PDF 編輯：匯出保留旋轉', res.rot[0] === 90 && res.rot[1] === 90 && res.rot[2] === 0, JSON.stringify(res.rot));
    check('PDF 編輯：框線印在正確位置', res.boxes[0].red > 50, JSON.stringify(res.boxes[0]));
    check('PDF 編輯：中文字印在文字框內', res.boxes[1].red > 100, JSON.stringify(res.boxes[1]));
    check('PDF 編輯：旋轉頁上的框線位置正確', res.boxes[2].red > 50, JSON.stringify(res.boxes[2]));
    check('PDF 編輯：沒有標註的地方是空白', res.boxes[3].red === 0 && res.boxes[3].dark === 0, JSON.stringify(res.boxes[3]));
    // 清除後重新開啟編輯紀錄
    const before = await page.evaluate(() => JSON.stringify(PE.pages.map(p => [p.rot, p.anns.length])));
    await page.click('button[title="清除目前的全部內容，重新開始"]'); await sleep(200);
    if (await page.isVisible('.modal')) await page.click('.modal .btn.primary');
    await page.waitForSelector('.pe-empty');
    fc = page.waitForEvent('filechooser'); await page.click('.pe-empty button:has-text("開啟編輯紀錄")');
    fs.copyFileSync(path.join(W, 'pdfout', '測試合併.pdfedit'), path.join(W, 'pdf', 'reopen.pdfedit')); // 測試工具無法上傳中文檔名
    await (await fc).setFiles(path.join(W, 'pdf', 'reopen.pdfedit'));
    await page.waitForFunction(() => document.querySelectorAll('.pe-card .pe-thumb canvas').length === 4, null, { timeout: 20000 });
    const after = await page.evaluate(() => JSON.stringify(PE.pages.map(p => [p.rot, p.anns.length])));
    check('PDF 編輯：開啟編輯紀錄還原頁面與標註', before === after && (await order()).join() === 'B1,A1,A2,blank', after);
    check('PDF 編輯：編輯紀錄保留檔名', (await page.evaluate(() => PE.name)) === '測試合併');

    // 5c. v2.1：刪除原有圖片、清除原有註解、文字格式、插入圖片、印章庫
    await page.click('button[title="清除目前的全部內容，重新開始"]'); await sleep(200);
    if (await page.isVisible('.modal')) await page.click('.modal .btn.primary');
    await page.waitForSelector('.pe-empty');
    fc = page.waitForEvent('filechooser'); await page.click('.pe-empty button:has-text("選擇 PDF 檔")');
    await (await fc).setFiles(path.join(W, 'pdf/C.pdf'));
    await page.waitForFunction(() => PE.pages.length === 1);
    await page.click('#peStripAnn'); await page.waitForSelector('.modal .hd:has-text("清除原有註解")');
    check('PDF 編輯：找到原有註解', (await page.textContent('.modal .bd')).includes('2 個原有註解'), await page.textContent('.modal .bd'));
    await page.click('.modal .btn.primary'); await sleep(300);
    check('PDF 編輯：清除原有註解', await page.evaluate(() => PE.pages[0].noAnn === true));
    await page.dblclick('.pe-card >> nth=0'); await page.waitForSelector('.pe-page'); await sleep(300);
    await page.evaluate(() => { PE.zoom = 0.8; peRender(); }); await sleep(800);
    const ovC = await page.$('.pe-page >> nth=0 >> .pe-ov'); const zc = await page.evaluate(() => PE.zoom);
    const atC = async (x, y) => { const b = await ovC.boundingBox(); return [b.x + x * zc, b.y + y * zc]; };
    await page.click('.pe-tb [data-tool="objdel"]'); await page.waitForSelector('.pe-obj');
    const objs = await page.evaluate(() => peObjList(PE.pages[0]).map(o => [o.k, Math.round(o.x), Math.round(o.y), Math.round(o.w), Math.round(o.h)]));
    check('PDF 編輯：找到頁面上的 3 張圖片（含子圖層裡的）', objs.length === 3, JSON.stringify(objs));
    // C.pdf：紅圖 (100,742)-(200,842)→畫面 y=0..100；綠圖在子圖層 (100,500)
    { const [x, y] = await atC(150, 75); await page.mouse.click(x, y); await sleep(500); }
    { const [x, y] = await atC(150, 292); await page.mouse.click(x, y); await sleep(500); }
    check('PDF 編輯：點選刪除兩張圖片', await page.evaluate(() => (PE.pages[0].del || []).length) === 2, JSON.stringify(await page.evaluate(() => PE.pages[0].del)));
    check('PDF 編輯：刪除後剩 1 張可選', await page.evaluate(() => peObjList(PE.pages[0]).length) === 1);
    await page.keyboard.press('Control+z'); await sleep(300);
    check('PDF 編輯：復原刪除圖片', await page.evaluate(() => (PE.pages[0].del || []).length) === 1);
    await page.keyboard.press('Control+y'); await sleep(300);
    // 文字格式
    await page.click('.pe-tb [data-tool="text"]');
    { const [x, y] = await atC(300, 600); await page.mouse.click(x, y); }
    await page.waitForSelector('.pe-ta'); await page.keyboard.type('粗體置中'); await page.keyboard.press('Escape'); await sleep(200);
    await page.click('.pe-tb [data-tool="select"]');
    { const t = await page.evaluate(() => PE.pages[0].anns.find(a => a.type === 'text')); const [x, y] = await atC(t.x + 10, t.y + 8); await page.mouse.click(x, y); await sleep(150); }
    await page.click('.pe-tb button[title="粗體"]'); await page.click('.pe-tb button[title="置中"]'); await page.click('.pe-tb button[title="底線"]');
    await page.click('.pe-tb button[title="底色"] >> nth=1'); // 黃底
    await page.click('.pe-tb button[title="文字框加外框"]'); await sleep(100);
    await page.click('.pe-tb button[title="框線顏色"] >> nth=1'); await sleep(100);
    const ft = await page.evaluate(() => PE.pages[0].anns.find(a => a.type === 'text'));
    check('PDF 編輯：文字格式（粗體、置中、底線、底色、外框顏色）', ft.bold && ft.align === 'center' && ft.underline && ft.fill === '#fff3a0' && ft.border && ft.bcolor === '#1a5fd0' && ft.color === '#d4202c', JSON.stringify(ft));
    // 插入圖片（去白底）
    fc = page.waitForEvent('filechooser'); await page.click('.pe-tb [data-tool="image"]');
    await (await fc).setFiles(path.join(W, 'pdf/stamp.png'));
    await page.waitForSelector('.modal .hd:has-text("插入圖片")');
    await page.fill('.modal input[type=number]', '2'); await page.click('.modal button:has-text("放到頁面上")'); await sleep(300);
    { const [x, y] = await atC(450, 150); await page.mouse.click(x, y); await sleep(200); }
    const im = await page.evaluate(() => { const a = PE.pages[0].anns.find(a => a.type === 'img'); return a && { ...a, t: PE.imgs[a.key].type }; });
    check('PDF 編輯：插入圖片（寬 2 公分）', im && Math.abs(im.w - 2 / 2.54 * 72) < 0.5 && im.t === 'png', JSON.stringify(im));
    check('PDF 編輯：圖片去除白底（透明）', await page.evaluate(async () => { const a = PE.pages[0].anns.find(a => a.type === 'img'); const bm = await createImageBitmap(new Blob([PE.imgs[a.key].bytes])); const c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext('2d'); g.drawImage(bm, 0, 0); return g.getImageData(1, 1, 1, 1).data[3] === 0 && g.getImageData(bm.width >> 1, bm.height >> 1, 1, 1).data[3] === 255 && bm.width < 240; }));
    await page.keyboard.press('Escape'); await sleep(100);
    // 印章庫：新增、蓋章
    await page.click('.pe-tb [data-tool="stamp"]'); await page.waitForSelector('.modal .hd:has-text("印章庫")');
    check('PDF 編輯：印章庫一開始是空的', (await page.textContent('.modal .bd')).includes('還是空的'));
    fc = page.waitForEvent('filechooser'); await page.click('.modal button:has-text("從圖片新增")');
    await (await fc).setFiles(path.join(W, 'pdf/stamp.png'));
    await page.waitForSelector('.modal .hd:has-text("新增印章")');
    await page.fill('.modal input[type=text]', '測試章'); await page.fill('.modal input[type=number]', '2.5');
    await page.click('.modal button:has-text("存到印章庫並開始蓋")'); await sleep(800);
    check('PDF 編輯：印章存到系統資料夾', fs.existsSync(path.join(W, 'root', '印章庫', '測試章.png')) && JSON.parse(fs.readFileSync(path.join(W, 'root', '印章庫', '印章庫.json'), 'utf8'))['測試章.png'].w === 2.5);
    { const [x, y] = await atC(450, 300); await page.mouse.click(x, y); await sleep(150); const [x2, y2] = await atC(450, 400); await page.mouse.click(x2, y2); await sleep(150); }
    check('PDF 編輯：印章可以連續蓋', await page.evaluate(() => PE.pages[0].anns.filter(a => a.type === 'img').length) === 3);
    await page.keyboard.press('Escape'); await sleep(100);
    await page.click('.pe-tb [data-tool="stamp"]'); await page.waitForSelector('.modal .pe-stamp');
    check('PDF 編輯：印章庫列出新印章', (await page.textContent('.modal .pe-stamp')).includes('測試章'));
    await page.click('.modal .pe-stamp'); await sleep(300);
    check('PDF 編輯：從印章庫選用', await page.evaluate(() => PE.tool === 'place' && Math.abs(PE.placing.w - 2.5 / 2.54 * 72) < 0.1));
    await page.keyboard.press('Escape');
    // 匯出並檢查
    pick = path.join(W, 'pdfout');
    await page.click('#peExport'); await page.waitForSelector('.modal .pe-name');
    await page.fill('.modal .pe-name', 'v21測試'); await page.click('.modal button:has-text("選擇資料夾並匯出")');
    await page.waitForSelector('.modal .hd:has-text("匯出完成")', { timeout: 30000 }); await page.click('.modal button:has-text("關閉")');
    const out21 = path.join(W, 'pdfout', 'v21測試.pdf');
    const T2 = await page.evaluate(() => { const a = PE.pages[0].anns.find(a => a.type === 'text'); return { ...a, th: peTextH(a) }; });
    const I2 = await page.evaluate(() => PE.pages[0].anns.find(a => a.type === 'img'));
    const res2 = JSON.parse(execFileSync('python3', [path.join(__dirname, 'pdf_check.py'), out21, JSON.stringify([[0, 100, 0, 100, 100], [0, 100, 242, 100, 100], [0, 300, 0, 100, 100], [0, T2.x, T2.y, T2.w, T2.th], [0, I2.x, I2.y, I2.w, I2.h]])]).toString());
    check('PDF 編輯：刪掉的紅色圖片不見了', res2.boxes[0].red === 0, JSON.stringify(res2.boxes[0]));
    check('PDF 編輯：刪掉的子圖層圖片不見了', res2.boxes[1].green === 0, JSON.stringify(res2.boxes[1]));
    check('PDF 編輯：沒刪的藍色圖片還在', res2.boxes[2].blue > 1000, JSON.stringify(res2.boxes[2]));
    check('PDF 編輯：匯出後沒有原有註解、剩 1 張原圖', res2.annots[0] === 0 && res2.imgsizes[0].filter(z => z[0] === 40).length === 1, JSON.stringify([res2.annots, res2.imgsizes]));
    check('PDF 編輯：文字底色與字印出', res2.boxes[3].yellow > 200 && res2.boxes[3].red > 50, JSON.stringify(res2.boxes[3]));
    check('PDF 編輯：印章印在正確位置', res2.boxes[4].red > 100, JSON.stringify(res2.boxes[4]));

    // 5d. v2.2：檔案大小顯示、只匯出選取頁、超過上傳限制自動分割、單頁太大選解析度
    await page.click('button[title="清除目前的全部內容，重新開始"]'); await sleep(200);
    if (await page.isVisible('.modal')) await page.click('.modal .btn.primary');
    await page.waitForSelector('.pe-empty');
    fc = page.waitForEvent('filechooser'); await page.click('.pe-empty button:has-text("選擇 PDF 檔")');
    await (await fc).setFiles([path.join(W, 'pdf/D.pdf'), path.join(W, 'pdf/E.pdf')]);
    await page.waitForFunction(() => PE.pages.length === 4);
    await page.waitForFunction(() => /約 [\d.]+ MB/.test(document.querySelector('#peSize')?.textContent || ''), null, { timeout: 30000 });
    const est = parseFloat((await page.textContent('#peSize')).match(/約 ([\d.]+) MB/)[1]);
    check('PDF 編輯：即時顯示合計大小（約 4.3 MB）', est > 3.9 && est < 4.8, String(est));
    await page.waitForFunction(() => [...document.querySelectorAll('.pe-csz')].every(e => /MB/.test(e.textContent)), null, { timeout: 30000 });
    check('PDF 編輯：每頁顯示單獨大小', (await page.textContent('.pe-card >> nth=3 >> .pe-csz')).includes('MB'));
    await page.click('.pe-card >> nth=0'); await sleep(600);
    check('PDF 編輯：顯示選取頁面的大小', (await page.textContent('#peSize')).includes('選取 1 頁'), await page.textContent('#peSize'));
    // 只匯出選取的頁面
    await page.click('#peExport'); await page.waitForSelector('.modal .pe-scope');
    await page.fill('.modal .pe-name', 'sel測試'); await page.check('.modal input[value="sel"]');
    await page.click('.modal button:has-text("選擇資料夾並匯出")');
    await page.waitForSelector('.modal .hd:has-text("匯出完成")', { timeout: 30000 });
    check('PDF 編輯：符合限制時顯示 ✓', (await page.textContent('.modal .bd')).includes('符合 8 MB'));
    await page.click('.modal button:has-text("關閉")');
    const rs = JSON.parse(execFileSync('python3', [path.join(__dirname, 'pdf_check.py'), path.join(W, 'pdfout', 'sel測試.pdf'), '[]']).toString());
    check('PDF 編輯：只匯出選取的 1 頁', rs.pages === 1 && rs.text[0].includes('NOISE-700-1'), JSON.stringify(rs.text));
    // 全部匯出，上傳限制 1.5 MB → 自動分割；第 4 頁單獨就 2.5 MB → 選解析度
    await page.click('.pe-grid', { position: { x: 5, y: 5 } }); await sleep(200);
    await page.click('#peExport'); await page.waitForSelector('.modal .pe-lim');
    await page.fill('.modal .pe-name', 'split測試'); await page.fill('.modal .pe-lim', '1.5');
    await page.click('.modal button:has-text("選擇資料夾並匯出")');
    await page.waitForSelector('.modal .hd:has-text("這一頁太大")', { timeout: 60000 });
    check('PDF 編輯：單頁太大時提供解析度選項', (await page.$$('.modal .pe-dpi')).length >= 2, String((await page.$$('.modal .pe-dpi')).length));
    await page.waitForSelector('.modal button:has-text("使用選取的解析度"):not([disabled])', { timeout: 90000 });
    const pickD = await page.evaluate(() => +document.querySelector('.pe-dpi.on')?.dataset.d);
    check('PDF 編輯：預設選符合限制裡最高的解析度、有預覽', pickD > 0 && !!(await page.$('.modal .pe-dpiprev canvas')), String(pickD));
    await page.click('.modal button:has-text("使用選取的解析度")');
    await page.waitForSelector('.modal .hd:has-text("已自動分割")', { timeout: 90000 });
    await page.click('.modal button:has-text("關閉")');
    const sp = ['split測試(1-2頁).pdf', 'split測試(3頁).pdf', 'split測試(4頁).pdf'].map(n => path.join(W, 'pdfout', n));
    check('PDF 編輯：依頁序分割成 3 個檔', sp.every(f => fs.existsSync(f)), fs.readdirSync(path.join(W, 'pdfout')).join(','));
    if (sp.every(f => fs.existsSync(f))) {
      const sizes = sp.map(f => fs.statSync(f).size);
      check('PDF 編輯：每個分割檔都不超過 1.5 MB', sizes.every(z => z <= 1.5e6), JSON.stringify(sizes));
      const pc = sp.map(f => JSON.parse(execFileSync('python3', [path.join(__dirname, 'pdf_check.py'), f, '[]']).toString()));
      check('PDF 編輯：分割檔頁數與內容正確', pc[0].pages === 2 && pc[1].pages === 1 && pc[2].pages === 1 && pc[0].text[1].includes('NOISE-700-2') && pc[1].text[0].includes('NOISE-700-3'), JSON.stringify(pc.map(x => x.text)));
    }
    await page.evaluate(() => peRender()); await sleep(1500);
    check('PDF 編輯：超過限制的頁面醒目標示', !!(await page.$('.pe-card >> nth=3 >> .pe-csz.over')) && !!(await page.$('#peSize .pe-szp.over')));
    pick = path.join(W, 'root');
    await page.click('nav button:has-text("文件產出")'); await sleep(300);
  }

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
