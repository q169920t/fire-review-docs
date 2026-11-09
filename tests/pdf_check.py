# 檢查 PDF 編輯匯出的結果：頁數、順序、旋轉、標註有沒有畫上去
import sys, json
from pypdf import PdfReader
import pypdfium2 as pdfium
f = sys.argv[1]
r = PdfReader(f)
out = {'pages': len(r.pages), 'text': [(p.extract_text() or '').strip() for p in r.pages], 'rot': [p.rotation for p in r.pages]}
doc = pdfium.PdfDocument(f)
boxes = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
res = []
for b in boxes:  # b = [頁, x, y, w, h]（畫面上看到的方向，單位 pt）→ 該範圍內紅色、深色像素數
    pg = doc[b[0]]; sc = 2
    img = pg.render(scale=sc).to_pil().convert('RGB')
    red = dark = 0
    for x in range(int(b[1] * sc), int((b[1] + b[3]) * sc)):
        for y in range(int(b[2] * sc), int((b[2] + b[4]) * sc)):
            if 0 <= x < img.width and 0 <= y < img.height:
                R, G, B = img.getpixel((x, y))
                if R > 150 and G < 90 and B < 90: red += 1
                if R + G + B < 300: dark += 1
    res.append({'red': red, 'dark': dark, 'size': [img.width / sc, img.height / sc]})
out['boxes'] = res
print(json.dumps(out, ensure_ascii=False))
