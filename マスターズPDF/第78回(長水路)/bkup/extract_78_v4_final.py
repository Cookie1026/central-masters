import pdfplumber
import json
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V4.csv"
mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"

with open(mapping_path, encoding='utf-8') as f:
    base_mapping = json.load(f)

# 1. ページ別精密パッチ
PAGE_PATCHES = {
    4: { "CIDFont+F2_0xf06a": "内", "CIDFont+F2_0xf06b": "田", "CIDFont+F2_0xf05e": "良", "CIDFont+F2_0xf06c": "子", "CIDFont+F2_0xf054": "子" },
    5: { "CIDFont+F2_0xf0c4": "長", "CIDFont+F2_0xf0c5": "野", "CIDFont+F2_0xf0c6": "愛", "CIDFont+F2_0xf054": "子" },
    9: { "CIDFont+F6_0xf06a": "若", "CIDFont+F6_0xf06b": "宮", "CIDFont+F6_0xf06c": "強", "CIDFont+F6_0xf076": "折", "CIDFont+F6_0xf077": "居", "CIDFont+F6_0xf078": "彰", "CIDFont+F6_0xf054": "" },
    11: { "CIDFont+F2_0xf032": "悠", "CIDFont+F6_0xf032": "悠" }
}

# 2. 強制置換リスト (部分一致で適用)
NAME_REPLACEMENTS = {
    "柴崎良徳子": "柴崎徳子", "熊谷良一枝": "熊谷一枝", "竹原良君枝": "竹原君枝", "松木良弘美": "松木弘美",
    "馬場良悦子": "馬場悦子", "菅野良泰子": "菅野泰子", "中平良信子": "中平信子", "岡村良悦子": "岡村悦子",
    "菅良良和江": "菅和江", "太田良拓江": "太田拓江", "内田良子子": "内田良子", "内田子": "内田良子",
    "長谷川子": "長谷川良子", "ィ野愛子": "長野愛子", "0野愛子": "長野愛子", "ィ津田": "津田", "0津田": "津田"
}

def deduplicate_chars(s):
    if len(s) < 2: return s
    res = ""
    for i in range(len(s)):
        if i > 0 and s[i] == s[i-1] and not s[i].isdigit() and s[i] not in ".:/-": continue
        res += s[i]
    return res

def clean_all(s):
    # 括弧と記号を除去
    s = s.replace('(', '').replace(')', '').replace('+', '').replace(',', '').replace('・大会新', '大会新')
    # 重複除去
    s = deduplicate_chars(s)
    # 特定名置換
    for old, new in NAME_REPLACEMENTS.items():
        s = s.replace(old, new)
    return s.strip()

def process_row(row):
    # 物理的結合 (1/ + 9 -> 1/9)
    i = 0
    while i < len(row) - 1:
        if row[i] == '時' and row[i+1] == '間': row[i] = '時間'; del row[i+1]
        elif row[i].endswith('/') and row[i+1].isdigit(): row[i] = row[i] + row[i+1]; del row[i+1]
        else: i += 1

    # リレーメンバー行の解体と再結合
    if len(row) >= 2 and row[0] in ['1', '2', '3', '4']:
        full_line = "".join(row[1:])
        match = re.match(r'^([^\d\-]+)([\d\.\-]{3,})([\d:\.]{4,})?$', full_line)
        if match:
            name = clean_all(match.group(1))
            rt = match.group(2)
            time = match.group(3) if match.group(3) else ""
            row = [row[0], name, rt]
            if time: row.append(time)

    # 個人種目の氏名結合
    lane_idx = -1
    for i, item in enumerate(row):
        if bool(re.match(r'^\d+/\d*$', item)): lane_idx = i; break
    if lane_idx != -1:
        start_name_idx = 1 if row[0].isdigit() else 0
        end_name_idx = lane_idx - 1
        if end_name_idx > start_name_idx: # 1つ以上あれば結合とクリーンアップ対象
            name = "".join(row[start_name_idx:end_name_idx])
            name = clean_all(name)
            row = row[:start_name_idx] + [name] + row[end_name_idx:]

    # 全フィールドへの最終クリーンアップ
    return [clean_all(item).replace('宀', '宮').replace('っ', '5') for item in row if item]

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
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=4, y_tolerance=3)
            if not text: continue
            
            # 定型文の補正
            text = text.replace('マススーターズ', 'マスターズ').replace('フェスティノノ', 'フェスティバル')
            text = text.replace('大会己記録', '大会記録').replace('世界己記録', '世界記録').replace('日本己記録', '日本記録')
            
            for line in text.split('\n'):
                line = line.strip()
                if not line: continue
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row)
                if row: all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(all_rows)

    print(f"Final V4 truly successfully generated: {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
