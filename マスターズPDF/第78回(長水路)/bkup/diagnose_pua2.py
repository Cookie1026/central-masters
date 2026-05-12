"""
PUA文字の詳細コンテキスト診断（特定フォント・ページ）
問題のあるPUA文字が実際にどの文字として使われているかを確認する
"""
import json
import re
import sys
import pdfplumber
import pdfplumber.utils

sys.stdout.reconfigure(encoding='utf-8')

BASE     = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)'
PDF_PATH = BASE + r'\第78回マスターズ結果(2025-05-31).pdf'
MAP_PATH = BASE + r'\pua_mapping.json'

with open(MAP_PATH, encoding='utf-8') as f:
    mapping = json.load(f)
# 既存修正
mapping['CIDFont+F2_'] = '路'

# 調査対象キー（「れ」→ 実際には何か？）
INVESTIGATE = {
    'CIDFont+F12_': 'れ',  # page 17
    'CIDFont+F68_': 'れ',  # page 94
    'CIDFont+F80_': 'れ',  # page 111
    # 確認済み（2かもしれない）:
    'CIDFont+F30_': 'れ',  # page 38
    'CIDFont+F46_': 'れ',  # pages 61-63
}

def extract_lines_from_page(page, target_keys):
    """ページから行テキストを抽出し、問題文字を含む行を返す"""
    if not page.chars:
        return []

    # Y座標でソート→行ごとに文字をグループ化
    lines = []
    current_line = []
    prev_y = None

    for c in sorted(page.chars, key=lambda x: (round(x['top'], 0), x['x0'])):
        y = round(c['top'], 0)
        if prev_y is not None and abs(y - prev_y) > 3:
            if current_line:
                lines.append(current_line)
            current_line = []
        current_line.append(c)
        prev_y = y
    if current_line:
        lines.append(current_line)

    results = []
    for line_chars in lines:
        has_target = any(
            f"{c['fontname']}_{c['text']}" in target_keys
            for c in line_chars
        )
        if has_target:
            # 行テキストを構築（マッピング適用済み、問題文字は[??]表示）
            parts = []
            for c in line_chars:
                raw = c['text']
                font = c['fontname']
                key  = f"{font}_{raw}"
                if key in target_keys:
                    parts.append(f'[??={target_keys[key]}]')
                else:
                    mapped = mapping.get(key, raw)
                    if ord(raw) >= 0xE000:
                        parts.append(mapped)
                    else:
                        parts.append(raw)
            results.append(''.join(parts))
    return results

with pdfplumber.open(PDF_PATH) as pdf:
    total = len(pdf.pages)

    for key, val in INVESTIGATE.items():
        font_part = key.split('_')[0]  # e.g., CIDFont+F12
        print(f"\n=== {key} (現在: '{val}') ===")

        # どのページに出現するか確認
        target = {key: val}
        for page_num, page in enumerate(pdf.pages, 1):
            if not page.chars:
                continue
            lines = extract_lines_from_page(page, target)
            if lines:
                print(f"  ページ{page_num}:")
                for line in lines[:5]:  # 最大5行
                    print(f"    {line}")
                if len(lines) > 5:
                    print(f"    ... 他{len(lines)-5}行")
