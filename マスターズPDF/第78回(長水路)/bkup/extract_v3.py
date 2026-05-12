"""
第78回PDF元データ(claude)V3.csv 作成スクリプト
V2からの追加修正:
- PDFの1-4ページ（男女総合成績、画像ページ）を完成CSVから追加
- (50 ) → (50m) 修正
- 世界/日本/大会己記録 → 世界/日本/大会記録 修正
- 世界/日本/大会己へ → 世界/日本/大会記録 修正
- 圭瀬 → 清瀬 修正
- 村田 斗 → 村田 拓斗 修正
"""
import csv
import json
import re
import sys
import pdfplumber
import pdfplumber.utils

sys.stdout.reconfigure(encoding='utf-8')

base         = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)'
mapping_path = base + r'\pua_mapping.json'
pdf_path     = base + r'\第78回マスターズ結果(2025-05-31).pdf'
sogo_path    = base + r'\完成\第78回男女総合成績(claude).csv'
out_path     = base + r'\第78回PDF元データ(claude)V3.csv'

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)
mapping['CIDFont+F2_'] = '路'
# 「3」に修正: リレーページのPUA文字（っ→3）
mapping['CIDFont+F14_\uf036'] = '3'  # F14 0xf036
mapping['CIDFont+F18_\uf037'] = '3'  # F18 0xf037
mapping['CIDFont+F21_\uf035'] = '3'  # F21 0xf035
mapping['CIDFont+F62_\uf03f'] = '3'  # F62 0xf03f
mapping['CIDFont+F65_\uf03a'] = '3'  # F65 0xf03a
mapping['CIDFont+F67_\uf03c'] = '3'  # F67 0xf03c
mapping['CIDFont+F46_\uf03e'] = '2'  # F46 0xf03e
mapping['CIDFont+F67_\uf025'] = ' '  # F67 0xf025

# 男女総合成績データ読み込み（テキスト形式: "X位 チーム名 Y点"）
sogo_rows = []
with open(sogo_path, encoding='utf-8-sig') as f:
    for line in f:
        line = line.strip()
        m = re.match(r'^(\d+)位\s+(.+?)\s+([\d.]+点)$', line)
        if m:
            sogo_rows.append((m.group(1), m.group(2), m.group(3)))

# ページ1-4の行を生成（各ページ: 先頭行 + 内容 + フッター）
PAGE_HEADER = [
    '第78回セントラルスポーツマスターズフェスティバル(長水路)',
    '会場:東京アクアティクスセンター(50m)',
    '期日:2025年5月31日(土)',
    '男女総合成績',
]
PAGE_FOOTER = [
    '配点: 個人 10 9 8 7 6 5 4 3 2 1 リレー 2 1',
    '出力日時: 5月31日 17:24',
]

# 画像確認に基づくページ区切り（0-based index）
# Page1: 1-19位(0-18), Page2: 20-38位first(19-37),
# Page3: 38位second-57位(38-56), Page4: 58-73位(57-72)
PAGE_SLICES = [(0, 19), (19, 38), (38, 57), (57, 73)]

sogo_lines = []
for page_num, (start, end) in enumerate(PAGE_SLICES, 1):
    sogo_lines.extend(PAGE_HEADER)
    for rank, name, points in sogo_rows[start:end]:
        sogo_lines.append(f'{rank}位 {name} {points}')
    sogo_lines.extend(PAGE_FOOTER)


def clean_line(line):
    line = re.sub(r'(\d)/ (\d)', r'\1/\2', line)
    line = re.sub(r'\( ([+\-]?\d)', r'(\1', line)
    line = line.replace('時 間', '時間')
    line = line.replace('(50 )', '(50m)')
    line = re.sub(r'(世界|日本|大会)己記録', r'\1記録', line)
    line = re.sub(r'(世界|日本|大会)己へ', r'\1記録', line)
    line = line.replace('圭瀬', '清瀬')
    line = line.replace('村田 斗', '村田 拓斗')
    return line


lines_out = list(sogo_lines)

with pdfplumber.open(pdf_path) as pdf:
    total = len(pdf.pages)
    for page_num, page in enumerate(pdf.pages, 1):
        # ページ1-4は画像のみでテキスト0文字（上で別途追加済み）
        if not page.chars:
            continue

        fixed_chars = []
        for c in page.chars:
            c2 = c.copy()
            key = f"{c['fontname']}_{c['text']}"
            if key in mapping:
                c2['text'] = mapping[key]
            elif '' <= c['text'] <= '':
                c2['text'] = '?'
            fixed_chars.append(c2)

        text = pdfplumber.utils.extract_text(fixed_chars, x_tolerance=5, y_tolerance=3)
        if not text:
            continue

        for line in text.split('\n'):
            line = line.strip()
            if line:
                line = clean_line(line)
                lines_out.append(line)

        if page_num % 20 == 0:
            print(f'  処理済み: {page_num}/{total} ページ')

print(f'合計行数: {len(lines_out)}')

with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    for line in lines_out:
        writer.writerow([line])

print(f'出力完了: {out_path}')
