import pdfplumber
import json
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V11.csv"
mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"

with open(mapping_path, encoding='utf-8') as f:
    base_mapping = json.load(f)

# ページ別パッチ
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
    # どこにキーワードがあっても強制的に分割するロジック
    
    # 1. 所属「セ」と水路「/」が含まれる場合 (個人)
    if 'セ' in item and '/' in item:
        idx_se = item.find('セ')
        m_lane = re.search(r'\d+/\d*$', item)
        if m_lane:
            idx_lane = m_lane.start()
            if idx_lane > idx_se:
                return [item[:idx_se], item[idx_se:idx_lane], item[idx_lane:]]

    # 2. 合計年齢「歳」と水路「/」が含まれる場合 (リレー)
    if '歳' in item and '/' in item:
        m_age = re.search(r'\d+歳', item)
        m_lane = re.search(r'\d+/\d*$', item)
        if m_age and m_lane:
            idx_age_end = m_age.end()
            idx_lane_start = m_lane.start()
            if idx_lane_start >= idx_age_end:
                return [item[:m_age.start()], item[m_age.start():idx_age_end], item[idx_lane_start:]]

    # 3. 水路「/」だけが密着している場合
    m_lane_only = re.search(r'([^\d])(\d+/\d*)$', item)
    if m_lane_only:
        return [item[:m_lane_only.start(2)], item[m_lane_only.start(2):]]

    # 4. 所属「セ」だけが密着している場合
    if 'セ' in item:
        idx_se = item.find('セ')
        if idx_se > 0:
            return [item[:idx_se], item[idx_se:]]

    return [item]

def process_row(row):
    # まずカンマで分解
    row_parts = []
    for item in row:
        row_parts.extend(item.split(','))
    
    # 密着項目の再分割
    new_row = []
    for item in row_parts:
        if not item: continue
        new_row.extend(split_merged_item(item))
    row = new_row

    # スラッシュ結合
    i = 0
    while i < len(row) - 1:
        if row[i].endswith('/') and row[i+1].isdigit():
            row[i] = row[i] + row[i+1]; del row[i+1]
        else: i += 1

    # リレーメンバー姓名結合 (1-4)
    if len(row) >= 2 and row[0] in ['1', '2', '3', '4']:
        time_idx = -1
        for idx in range(1, len(row)):
            if any(c in row[idx] for c in '.:') or row[idx] in ['----', '-----', '棄権', '失格']:
                time_idx = idx; break
        if time_idx > 1:
            name = clean_all("".join(row[1:time_idx]))
            row = [row[0], name] + row[time_idx:]

    # 個人種目氏名結合 (分割済み前提)
    lane_idx = -1
    for i, item in enumerate(row):
        if bool(re.match(r'^\d+/\d*$', item)): lane_idx = i; break
    if lane_idx != -1:
        start_name_idx = 1 if row[0].isdigit() else 0
        end_name_idx = lane_idx - 1
        if end_name_idx > start_name_idx:
            name = clean_all("".join(row[start_name_idx:end_name_idx]))
            row = row[:start_name_idx] + [name] + row[end_name_idx:]

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
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=3.0, y_tolerance=3)
            if not text: continue
            
            for line in text.split('\n'):
                line = line.strip()
                if not line: continue
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row)
                if row: all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(all_rows)

    print(f"V11 successfully generated: {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
