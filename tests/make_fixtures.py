# 產生測試用的假模板、假掃描檔與假的「新版」更新檔（不含任何真實資料）
import json, os, sys, shutil
import docx
W = sys.argv[1]; APP = sys.argv[2]
shutil.rmtree(W, ignore_errors=True)
for d in ['root/templates', 'root/字型', 'case', 'scan', 'home', 'upd', 'pdf', 'pdfout']: os.makedirs(os.path.join(W, d))
names = ['資料檢查表_template.docx', '圖說審查申請書_template.docx', '消防防護計畫檢核表_template.docx', '委託書_template.docx',
         '危險物品切結書_template.docx', '危險物品切結書_工廠版_template.docx', '建築圖切結書_template .docx']
for n in names:
    d = docx.Document(); d.add_paragraph('工程名稱：{工程名稱}　地址：{建築地址}'); d.add_paragraph('{□新建}新建 {□增建}增建'); r = d.add_paragraph().add_run('第三段\t定位點'); r.bold = True
    if n.startswith('委託書'): d.add_paragraph('受託人電話：{受託人電話}')
    d.save(os.path.join(W, 'root/templates', n))
# 資料檢查表：有表格（項次、名稱、有、無、不須、備註）
d = docx.Document(); d.add_paragraph('資料檢查表 {工程名稱}')
t = d.add_table(rows=0, cols=6)
for no, name in [(1, '申請書'), (6, '檢核表'), (8, '委託書'), (10, '危險物品切結書'), (11, '建築圖切結書')]:
    c = t.add_row().cells; c[0].text = str(no); c[1].text = name; c[2].text = '{□}'; c[3].text = '{□}'; c[4].text = '{□}'; c[5].text = ''
d.save(os.path.join(W, 'root/templates', '資料檢查表_template.docx'))
# 圖審所需文件：條件標記與自動編號
d = docx.Document(); d.add_paragraph('圖審所需文件 {□新建}{□增建}')
d.add_paragraph('{序}、業主用印文件'); d.add_paragraph('{列:8}■委託書'); d.add_paragraph('{列:□新建|□增建}■核准函'); d.add_paragraph('{列:8,!□新建}■使用執照')
t = d.add_table(rows=2, cols=1); t.rows[0].cells[0].text = '{列:13}{序}、電機技師知會函'; t.rows[1].cells[0].text = '{序}、結尾'
d.save(os.path.join(W, 'root/templates', '圖審所需文件_template.docx'))
for i in range(2): open(os.path.join(W, f'scan/scan{i}.pdf'), 'wb').write(b'%PDF-1.4\n%test' + bytes([i]))
s = open(APP, encoding='utf8').read()
import re
cur = re.search(r"APP_VERSION = '([0-9.]+)'", s).group(1)
nxt = cur.rsplit('.', 1)[0] + '.' + str(int(cur.rsplit('.', 1)[1]) + 1)
open(os.path.join(W, 'upd/app.html'), 'w', encoding='utf8').write(s.replace(f"APP_VERSION = '{cur}'", f"APP_VERSION = '{nxt}'"))
json.dump({'app': nxt, 'shell': '1.0', 'notes': '- 測試更新說明'}, open(os.path.join(W, 'upd/latest.json'), 'w'), ensure_ascii=False)
print(cur, '->', nxt)

# PDF 編輯測試用：A.pdf 兩頁直式、B.pdf 一頁橫式且帶 90 度旋轉（內容都是假的）
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
c = canvas.Canvas(os.path.join(W, 'pdf/A.pdf'), pagesize=A4)
for t in ['PAGE-A1', 'PAGE-A2']:
    c.setFont('Helvetica', 40); c.drawString(80, 700, t); c.showPage()
c.save()
c = canvas.Canvas(os.path.join(W, 'pdf/B.pdf'), pagesize=landscape(A4))
c.setPageRotation(90); c.setFont('Helvetica', 40); c.drawString(80, 400, 'PAGE-B1'); c.showPage(); c.save()
# 中文字型（有系統字型才放；沒有時程式會改用圖片方式匯出文字）
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']:
    if os.path.exists(f): shutil.copy(f, os.path.join(W, 'root/字型', os.path.basename(f))); break
