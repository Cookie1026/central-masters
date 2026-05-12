import pdfplumber
import json
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V12.csv"
mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"
debug_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\debug_log.txt"

with open(mapping_path, encoding='utf-8') as f:
    base_mapping = json.load(f)

PAGE_PATCHES = {
    4: { "CIDFont+F2_0xf06a": "内", "CIDFont+F2_0xf06b": "田", "CIDFont+F2_0xf05e": "良", "CIDFont+F2_0xf06c": "子", "CIDFont+F2_0xf054": "子" },
    5: { "CIDFont+F2_0xf0c4": "長", "CIDFont+F2_0xf0c5": "野", "CIDFont+F2_0xf0c6": "愛", "CIDFont+F2_0xf054": "子" },
    9: { "CIDFont+F6_0xf06a": "若", "CIDFont+F6_0xf06b": "宮", "CIDFont+F6_0xf06c": "強", "CIDFont+F6_0xf076": "折", "CIDFont+F6_0xf077": "居", "CIDFont+F6_0xf078": "彰", "CIDFont+F6_0xf054": "" },
    11: { "CIDFont+F2_0xf032": "悠", "CIDFont+F6_0xf032": "悠" }
}

NAME_REPLACEMENTS = {
    "柴崎良徳子": "柴崎徳子", "熊谷良一枝": "熊谷一枝", "内田良子子": "内田良子", "内田子": "内田良子",
    "圭瀬": "清瀬", "大宮原": "大宮宮原", "ィ野愛子": "長野愛子", "0野愛子": "長野愛子", "ィ津田": "津田", "0津田": "津田"
}

debug_out = []

def clean_all(s):
    s = s.replace('(', '').replace(')', '').replace('+', '').replace(',', '').replace('・大会新', '大会新')
    if len(s) >= 2:
        res = ""
        for i in range(len(s)):
            if i > 0 and s[i] == s[i-1] and not s[i].isdigit() and s[i] not in ".:/-": continue
            res += s[i]
        s = res
    for old, new in NAME_REPLACEMENTS.items(): s = s.replace(old, new)
    return s.strip()

def split_merged_item(item):
    # 究極のパターンマッチング
    # A. 氏名 + セ... + 水路
    m = re.search(r'^(.*?)(セ.+?)(\d+/\d*)$', item)
    if m: return [m.group(1), m.group(2), m.group(3)]
    
    # B. チーム + 歳 + 水路
    m = re.search(r'^(.*?)(\d+歳)(\d+/\d*)$', item)
    if m: return [m.group(1), m.group(2), m.group(3)]
    
    # C. 氏名 + セ... (水路なし)
    m = re.search(r'^(.*?)(セ.+)$', item)
    if m: return [m.group(1), m.group(2)]

    return [item]

def process_row(row, original_line=""):
    if '森川' in original_line or '圭瀬' in original_line or '成城' in original_line:
        debug_out.append(f"INPUT: {row}")

    # まず全要素をカンマでバラバラにする
    new_row_pre = []
    for item in row:
        new_row_pre.extend(item.split(','))
    
    # 各要素に対して分離ロジック適用
    new_row = []
    for item in new_row_pre:
        if not item: continue
        parts = split_merged_item(item)
        new_row.extend(parts)
    
    row = new_row
    if '森川' in original_line or '圭瀬' in original_line or '成城' in original_line:
        debug_out.append(f"SPLIT: {row}")

    # スラッシュ結合 (1/ + 9 -> 1/9)
    i = 0
    while i < len(row) - 1:
        if row[i].endswith('/') and row[i+1].isdigit():
            row[i] = row[i] + row[i+1]; del row[i+1]
        else: i += 1

    # リレー姓名結合
    if len(row) >= 2 and row[0] in ['1', '2', '3', '4']:
        time_idx = -1
        for idx in range(1, len(row)):
            if any(c in row[idx] for c in '.:') or row[idx] in ['----', '-----', '棄権', '失格']:
                time_idx = idx; break
        if time_idx > 1:
            name = clean_all("".join(row[1:time_idx]))
            row = [row[0], name] + row[time_idx:]

    # 個人姓名結合
    lane_idx = -1
    for i, item in enumerate(row):
        if bool(re.match(r'^\d+/\d*$', item)): lane_idx = i; break
    if lane_idx != -1:
        start_idx = 1 if row[0].isdigit() else 0
        end_idx = lane_idx - 1
        if end_idx > start_idx:
            name = clean_all("".join(row[start_idx:end_idx]))
            row = row[:start_idx] + [name] + row[end_idx:]

    final_row = [clean_all(item).replace('宀', '宮').replace('っ', '5') for item in row if item]
    if '森川' in original_line or '圭瀬' in original_line or '成城' in original_line:
        debug_out.append(f"FINAL: {final_row}")
    return final_row

try:
    with pdfplumber.open(pdf_path) as pdf:
        all_rows = []
        for page_idx, page in enumerate(pdf.pages):
            modified_chars = []
            page_patch = PAGE_PATCHES.get(page_idx, {})
            for c in page.chars:
                c_copy = c.copy()
                p_key = f"{c['fontname']}_{hex(ord(c['text']))}"
                key = f"{c['fontname']}_{c['text']}"
                if p_key in page_patch: c_copy['text'] = page_patch[p_key]
                elif key in base_mapping: c_copy['text'] = base_mapping[key]
                elif '\uf000' <= c['text'] <= '\uf8ff': c_copy['text'] = '?'
                modified_chars.append(c_copy)
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=3.0, y_tolerance=3)
            if not text: continue
            
            for line in text.split('\n'):
                line = line.strip()
                if not line: continue
                row = re.split(r'[\s\u3000]+', line)
                processed = process_row(row, line)
                if processed: all_rows.append(processed)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(all_rows)

    with open(debug_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(debug_out))

    print(f"V12 generated with debug log: {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
