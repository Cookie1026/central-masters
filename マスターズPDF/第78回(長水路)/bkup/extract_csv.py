import pdfplumber
import json
import csv
import sys
import re

mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"
pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回元データ.csv"

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)

def is_lane_marker(s):
    # '2/' のような水路マーカー、または '468/' のようなポイントマーカー
    return bool(re.match(r'^\d+/$', s))

def is_reaction_time_marker(s):
    # '(' または '(+0.65)' のような反応時間マーカー
    return s.startswith('(')

def process_row(row):
    lane_idx = -1
    reaction_idx = -1
    
    for i, item in enumerate(row):
        if is_lane_marker(item):
            lane_idx = i
            break
            
    if lane_idx == -1:
        for i, item in enumerate(row):
            if is_reaction_time_marker(item):
                reaction_idx = i
                break

    if lane_idx != -1:
        # 個人種目の行と想定される
        if row[0].isdigit():
            start_name_idx = 1
        else:
            start_name_idx = 0
            
        end_name_idx = lane_idx - 1 # 所属要素のインデックス
        
        # 氏名部分が複数要素に分かれている場合、結合する
        if end_name_idx > start_name_idx + 1:
            name = "".join(row[start_name_idx:end_name_idx])
            row = row[:start_name_idx] + [name] + row[end_name_idx:]
            
    elif reaction_idx != -1:
        # リレーのメンバー行と想定される
        if row[0].isdigit():
            start_name_idx = 1
        else:
            start_name_idx = 0
            
        end_name_idx = reaction_idx
        
        # 氏名部分が複数要素に分かれている場合、結合する
        if end_name_idx > start_name_idx + 1:
            name = "".join(row[start_name_idx:end_name_idx])
            row = row[:start_name_idx] + [name] + row[end_name_idx:]
            
    # さらに、水路やポイント、括弧の分離、および「時」「間」の分離をくっつける
    i = 0
    while i < len(row) - 1:
        if row[i] == '時' and row[i+1] == '間':
            row[i] = '時間'
            del row[i+1]
        elif row[i].endswith('/') and row[i+1].isdigit():
            row[i] = row[i] + row[i+1]
            del row[i+1]
        elif row[i] == '(' and row[i+1].endswith(')'):
            row[i] = row[i] + row[i+1]
            del row[i+1]
        else:
            i += 1
            
    return row

try:
    with pdfplumber.open(pdf_path) as pdf:
        all_rows = []
        for page_num, page in enumerate(pdf.pages[4:]): # Results start from page 5
            # Modify chars
            modified_chars = []
            for c in page.chars:
                c_copy = c.copy()
                key = f"{c['fontname']}_{c['text']}"
                if key in mapping:
                    c_copy['text'] = mapping[key]
                elif '\uf000' <= c['text'] <= '\uf8ff':
                    # REMOVED: Fallback to plain character matching
                    # This was causing mis-mapping (e.g. space -> 'セ')
                    c_copy['text'] = '?' # Unknown PUA
                modified_chars.append(c_copy)
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=5, y_tolerance=3)
            if not text:
                continue
                
            # Cleanup known artifacts
            text = text.replace('?', ' ') # Treat unknown PUA as space for now
            text = text.replace('第787回', '第78回')
            text = text.replace('タ787回', '第78回')
            text = text.replace('フ787回', '第78回')
            text = text.replace('ズ787回', '第78回')
            text = text.replace('ィ787回', '第78回')
            text = text.replace('回787回', '第78回')
            text = text.replace('第78回 78回', '第78回')
            
            # Fix common OCR errors if any (from mapping votes)
            text = text.replace('77時77間', '時間')
            text = text.replace('77時77門', '時間')
            
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Split by space, handle double spaces as single separator
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row)
                all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(all_rows)

    print(f"Successfully converted to {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
