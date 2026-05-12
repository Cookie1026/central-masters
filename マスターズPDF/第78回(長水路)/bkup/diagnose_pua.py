"""
PUA文字診断スクリプト
「っ」「れ」にマッピングされているPUA文字が実際には何であるか調べる。

対象: 数字コンテキスト（タイム・年齢）に現れる「っ」「れ」
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
# すでに修正済みの上書き
mapping['CIDFont+F2_'] = '路'  # 路の修正（元のキーは不明だが概念として）

# PUAコードポイント範囲
PUA_LO, PUA_HI = 0xE000, 0xF8FF

# 「っ」「れ」にマップされているキーを抽出
targets = {}  # key -> mapped_char
for k, v in mapping.items():
    if v in ('っ', 'れ'):
        targets[k] = v

print(f"「っ」「れ」にマップされているエントリ: {len(targets)}件")
for k, v in sorted(targets.items()):
    char = k.split('_', 1)[-1] if '_' in k else ''
    if char:
        print(f"  {k!r} → {v!r}  (U+{ord(char):04X})")
    else:
        print(f"  {k!r} → {v!r}")

print()
print("=" * 60)
print("PDF内での出現状況（前後のコンテキスト付き）:")
print("=" * 60)

# PDFを開き、問題のあるPUA文字が現れるページを探す
found = {}  # key -> list of (page_num, context_text, correct_guess)

with pdfplumber.open(PDF_PATH) as pdf:
    total = len(pdf.pages)
    for page_num, page in enumerate(pdf.pages, 1):
        if not page.chars:
            continue

        # ページのテキストを生成（マッピング前の生PUA文字も保持）
        page_chars_raw = page.chars  # 元のPUAコード

        # 問題のあるキーに一致するcharを探す
        for c in page_chars_raw:
            text_raw = c['text']
            font    = c['fontname']
            key     = f"{font}_{text_raw}"

            if key in targets:
                # このキーが出現するページとコンテキストを収集
                if key not in found:
                    found[key] = []
                found[key].append(page_num)

print(f"\n問題キーの出現ページ:")
for key, pages in sorted(found.items()):
    char = key.split('_', 1)[-1] if '_' in key else ''
    uniq = sorted(set(pages))
    print(f"  {key!r} (U+{ord(char):04X} if char) → ページ: {uniq[:10]}{'...' if len(uniq)>10 else ''}")

# 特定ページのコンテキスト詳細
print()
print("=" * 60)
print("特定ページの詳細コンテキスト（数字隣接）:")
print("=" * 60)

# 最初に出現するページのコンテキストを確認
sample_pages = set()
for key, pages in found.items():
    if pages:
        sample_pages.add(pages[0])
        if len(pages) > 1:
            sample_pages.add(pages[1])

with pdfplumber.open(PDF_PATH) as pdf:
    for page_num in sorted(sample_pages)[:5]:  # 最初の5ページ
        page = pdf.pages[page_num - 1]
        if not page.chars:
            continue

        text_lines = []
        line_chars = []

        # 文字をY座標でグループ化して行を作る
        prev_y = None
        current_line = []
        for c in sorted(page.chars, key=lambda x: (round(x['top'], 0), x['x0'])):
            y = round(c['top'], 0)
            if prev_y is not None and abs(y - prev_y) > 3:
                if current_line:
                    text_lines.append(current_line)
                current_line = []
            current_line.append(c)
            prev_y = y
        if current_line:
            text_lines.append(current_line)

        for line in text_lines:
            line_text = ''.join(c['text'] for c in line)
            # この行に問題のあるPUA文字があるか
            has_target = False
            for c in line:
                key = f"{c['fontname']}_{c['text']}"
                if key in targets:
                    has_target = True
                    break

            if has_target:
                # 行の文字を詳細表示
                detail = []
                for c in line:
                    raw = c['text']
                    font = c['fontname']
                    key  = f"{font}_{raw}"
                    mapped = mapping.get(key, raw)
                    if key in targets:
                        detail.append(f"[U+{ord(raw):04X}→{mapped!r}]")
                    elif '' <= raw <= chr(0xF8FF) and ord(raw) >= 0xE000:
                        detail.append(f"[U+{ord(raw):04X}→{mapped!r}]")
                    else:
                        detail.append(mapped)
                mapped_line = ''.join(detail)

                # 行内で問題文字の前後を確認
                for i, c in enumerate(line):
                    key = f"{c['fontname']}_{c['text']}"
                    if key in targets:
                        prev_ch = line[i-1]['text'] if i > 0 else ''
                        next_ch = line[i+1]['text'] if i < len(line)-1 else ''
                        prev_map = mapping.get(f"{line[i-1]['fontname']}_{prev_ch}", prev_ch) if i > 0 else ''
                        next_map = mapping.get(f"{line[i+1]['fontname']}_{next_ch}", next_ch) if i < len(line)-1 else ''

                        if re.search(r'[\d:]', prev_map) or re.search(r'[\d:\.:]', next_map):
                            print(f"  ページ{page_num}: {key!r}(→{targets[key]!r}) の前後: {prev_map!r}...{next_map!r}")
                            print(f"    行: {mapped_line[:80]}")
                            break
