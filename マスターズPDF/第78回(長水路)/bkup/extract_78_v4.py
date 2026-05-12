import pdfplumber
import json
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V4.csv"
memo_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\メモ.txt"
mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"

with open(mapping_path, encoding='utf-8') as f:
    base_mapping = json.load(f)

# ページ別特別パッチ (Page Index 0-based)
PAGE_PATCHES = {
    4: { # P5
        "CIDFont+F2_0xf06a": "内", "CIDFont+F2_0xf06b": "田", 
        "CIDFont+F2_0xf05e": "良", "CIDFont+F2_0xf06c": "子",
        "CIDFont+F2_0xf054": "子"
    },
    5: { # P6
        "CIDFont+F2_0xf0c4": "長", "CIDFont+F2_0xf0c5": "野", 
        "CIDFont+F2_0xf0c6": "愛", "CIDFont+F2_0xf054": "子"
    },
    9: { # P10
        "CIDFont+F6_0xf06a": "若", "CIDFont+F6_0xf06b": "宮", 
        "CIDFont+F6_0xf06c": "強", "CIDFont+F6_0xf076": "折",
        "CIDFont+F6_0xf077": "居", "CIDFont+F6_0xf078": "彰",
        "CIDFont+F6_0xf054": "" # Space
    },
    11: { # P12
        "CIDFont+F2_0xf032": "悠", # 山内イ -> 山内悠
        "CIDFont+F6_0xf032": "悠"
    }
}

memo_entries = []

def clean_value(s):
    # 括弧や符号を削除
    s = re.sub(r'[\(\)\+,]', '', s)
    if s == '・大会新': s = '大会新'
    return s.strip()

def deduplicate_chars(s):
    if len(s) < 2: return s
    res = ""
    for i in range(len(s)):
        if i > 0 and s[i] == s[i-1] and not s[i].isdigit() and s[i] not in ".:/-":
            continue
        res += s[i]
    return res

def is_lane_marker(s):
    return bool(re.match(r'^\d+/\d*$', s))

def process_row(row, line_num):
    # 物理的分割の結合
    i = 0
    while i < len(row) - 1:
        if row[i] == '時' and row[i+1] == '間':
            row[i] = '時間'; del row[i+1]
        elif row[i].endswith('/') and row[i+1].isdigit():
            row[i] = row[i] + row[i+1]; del row[i+1]
        else:
            i += 1
            
    # リレーメンバー行の検知と結合 (1, 氏名, RT, Time)
    if len(row) >= 3 and row[0] in ['1', '2', '3', '4'] and '.' in row[-1]:
        # 2番目からRT(数値)の前までを結合
        rt_idx = -1
        for idx in range(1, len(row)):
            if re.match(r'^[\d\-\+]{2,}', row[idx]): # 0.xx or ----
                rt_idx = idx; break
        if rt_idx > 1:
            name = "".join(row[1:rt_idx])
            row = [row[0], name] + row[rt_idx:]

    # 個人種目の氏名結合
    lane_idx = -1
    for i, item in enumerate(row):
        if is_lane_marker(item):
            lane_idx = i; break
    if lane_idx != -1:
        start_name_idx = 1 if row[0].isdigit() else 0
        end_name_idx = lane_idx - 1
        if end_name_idx > start_name_idx + 1:
            name = "".join(row[start_name_idx:end_name_idx])
            name = deduplicate_chars(name)
            row = row[:start_name_idx] + [name] + row[end_name_idx:]

    # メモ機能: 疑わしい文字のチェック
    for item in row:
        if '?' in item:
            memo_entries.append(f"L{line_num}: 未定義文字(?)あり -> {item}")
        if 'ィ' in item and any(c.isdigit() for c in item):
            memo_entries.append(f"L{line_num}: 数字とィの混在（誤判定の疑い） -> {item}")

    # クリーンアップ
    row = [clean_value(item).replace('宀', '宮') for item in row]
    # 特定の地名補正
    row = [item.replace('0津田', '津田').replace('0野', '長野') for item in row]
    
    return [item for item in row if item]

try:
    with pdfplumber.open(pdf_path) as pdf:
        all_rows = []
        line_count = 0
        for page_idx, page in enumerate(pdf.pages):
            modified_chars = []
            page_patch = PAGE_PATCHES.get(page_idx, {})
            
            for c in page.chars:
                c_copy = c.copy()
                key = f"{c['fontname']}_{c['text']}"
                p_key = f"{c['fontname']}_{hex(ord(c['text']))}"
                
                # ページ別パッチを優先
                if p_key in page_patch:
                    c_copy['text'] = page_patch[p_key]
                elif key in base_mapping:
                    c_copy['text'] = base_mapping[key]
                elif '\uf000' <= c['text'] <= '\uf8ff':
                    c_copy['text'] = '?'
                modified_chars.append(c_copy)
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=4, y_tolerance=3)
            if not text: continue
            
            # 定型文の辞書補正
            text = text.replace('セントラノ', 'セントラル').replace('フェスティノノ', 'フェスティバル')
            text = text.replace('世界己へ', '世界記録').replace('日本己へ', '日本記録')
            
            for line in text.split('\n'):
                line = line.strip()
                if not line: continue
                line_count += 1
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row, line_count)
                if row: all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(all_rows)
        
    with open(memo_path, 'w', encoding='utf-8') as f:
        f.write("\n".join(memo_entries))

    print(f"Successfully generated V4: {csv_path}")
    print(f"Memo created: {memo_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
