"""
第78回PDF元データ(claude)V2.csv 作成スクリプト
- PUA文字マッピングで文字化け対策
- 既知のマッピングエラーを修正（路→ル問題等）
- PDFの行構成をそのまま1行=1行で出力
- UTF-8 BOM (Excel対応)
"""
import csv
import json
import re
import sys
import pdfplumber
import pdfplumber.utils

sys.stdout.reconfigure(encoding='utf-8')

mapping_path = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json'
pdf_path     = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf'
out_path     = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(claude)V2.csv'

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)

# 既知のマッピングエラー修正
# CIDFont+F2_ はタイトルの「路」(長水路) が誤って「ル」にマップされている
mapping['CIDFont+F2_'] = '路'

def clean_line(line):
    """pdfplumberの抽出アーティファクト（不要スペース）を最小限修正する"""
    # 水路番号: 数字/ 数字 → 数字/数字  (例: 1/ 9 → 1/9)
    line = re.sub(r'(\d)/ (\d)', r'\1/\2', line)
    # 反応時間の括弧内スペース: ( 数字 → (数字
    line = re.sub(r'\( ([+\-]?\d)', r'(\1', line)
    # 時 間 → 時間 (カラムヘッダーの誤スペース)
    line = line.replace('時 間', '時間')
    return line

lines_out = []

with pdfplumber.open(pdf_path) as pdf:
    total = len(pdf.pages)
    for page_num, page in enumerate(pdf.pages, 1):
        # PUAマッピングを適用した文字リストを作成
        fixed_chars = []
        for c in page.chars:
            c2 = c.copy()
            key = f"{c['fontname']}_{c['text']}"
            if key in mapping:
                c2['text'] = mapping[key]
            elif '' <= c['text'] <= '':
                c2['text'] = '?'  # 未マップPUA（実際は0件）
            fixed_chars.append(c2)

        # テキスト抽出（行構成を維持）
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

# UTF-8 BOM で書き出し（1列CSV: 各行がPDFの1行）
with open(out_path, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    for line in lines_out:
        writer.writerow([line])

print(f'出力完了: {out_path}')
