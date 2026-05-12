import pdfplumber
import json
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V9.csv"
mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"

with open(mapping_path, encoding='utf-8') as f:
    base_mapping = json.load(f)

# ページ別精密パッチ
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
    # さらに柔軟な「どこからでも削り出し」ロジック
    
    # A. 順位がカンマなしで密着している場合 (例: 1森川...)
    m_rank_no_comma = re.match(r'^(\d+)([^\d,].+セ・.+)', item)
    if m_rank_no_comma:
        return [m_rank_no_comma.group(1)] + split_merged_item(m_rank_no_comma.group(2))

    # B. 水路(1/9)を末尾から削り出し
    m_lane = re.search(r'(\d+/\d*)$', item)
    if m_lane:
        lane = m_lane.group(1)
        rest = item[:m_lane.start()]
        
        # C. 所属(セ・)を削り出し
        m_club = re.search(r'(セ・.+)$', rest)
        if m_club:
            club = m_club.group(1)
            name = rest[:m_club.start()]
            return [name, club, lane]
            
        # D. 合計年齢(歳)を削り出し
        m_age = re.search(r'(\d+歳)$', rest)
        if m_age:
            age = m_age.group(1)
            name = rest[:m_age.start()]
            return [name, age, lane]
            
    # E. 水路がないが所属のみ密着
    m_club_only = re.search(r'(セ・.+)$', item)
    if m_club_only:
        club = m_club_only.group(1)
        name = item[:m_club_only.start()]
        return [name, club]

    return [item]

def process_row(row):
    # 1. フィールドレベルでの再分割
    new_row = []
    for item in row:
        if ',' in item:
            # カンマで繋がっている場合はまずそこで切る
            sub_parts = item.split(',')
            for p in sub_parts:
                if p: new_row.extend(split_merged_item(p))
        else:
            new_row.extend(split_merged_item(item))
    row = new_row

    # 2. 物理的結合 (1/ + 9 -> 1/9)
    i = 0
    while i < len(row) - 1:
        if row[i] == '時' and row[i+1] == '間': row[i] = '時間'; del row[i+1]
        elif row[i].endswith('/') and row[i+1].isdigit(): row[i] = row[i] + row[i+1]; del row[i+1]
        else: i += 1

    # 3. リレーメンバー姓名結合 (順位 1-4)
    if len(row) >= 2 and row[0] in ['1', '2', '3', '4']:
        time_start_idx = -1
        for idx in range(1, len(row)):
            if any(c in row[idx] for c in '.:') or row[idx] in ['----', '-----', '棄権', '失格']:
                time_start_idx = idx; break
        if time_start_idx > 1:
            name = clean_all("".join(row[1:time_start_idx]))
            row = [row[0], name] + row[time_start_idx:]

    # 4. 個人種目氏名結合 (分割済み前提)
    lane_idx = -1
    for i, item in enumerate(row):
        if bool(re.match(r'^\d+/\d*$', item)): lane_idx = i; break
    if lane_idx != -1:
        start_name_idx = 1 if row[0].isdigit() else 0
        end_name_idx = lane_idx - 1
        if end_name_idx > start_name_idx:
            name = clean_all("".join(row[start_name_idx:end_name_idx]))
            row = row[:start_name_idx] + [name] + row[end_name_idx:]

    # 5. 全フィールド最終クリーンアップ
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
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=2, y_tolerance=3)
            if not text: continue
            
            # 表記揺れ修正
            text = text.replace('マススーターズ', 'マスターズ').replace('フェスティノノ', 'フェスティバル')
            text = text.replace('世界己記録', '世界記録').replace('日本己記録', '日本記録').replace('大会己記録', '大会記録')
            text = text.replace('世界己へ', '世界記録').replace('日本己へ', '日本記録').replace('大会己へ', '大会記録')
            
            for line in text.split('\n'):
                line = line.strip()
                if not line: continue
                # 空白または全角空白で分割
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row)
                if row: all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        csv.writer(f).writerows(all_rows)

    print(f"V9 successfully generated: {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
