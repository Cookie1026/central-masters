import pdfplumber
import json
import csv
import sys
import re

mapping_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\pua_mapping.json"
pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回マスターズ結果(2025-05-31).pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDF元データ(anti)V3.csv"

with open(mapping_path, encoding='utf-8') as f:
    mapping = json.load(f)

# V3要件パッチ
mapping["CIDFont+F2_" + chr(0xf05e)] = ""  # 姓名間の「良」を排除
mapping["CIDFont+F2_" + chr(0xf036)] = "0" # 順位の誤判定を修正 (1ィ -> 10)
mapping["CIDFont+F2_" + chr(0xf065)] = "藤"
mapping["CIDFont+F2_" + chr(0xf064)] = "佐"

def clean_value(s):
    # (+0.39) -> 0.39, (,1.26) -> 1.26, などの括弧・符号・カンマ除去
    s = re.sub(r'[\(\)\+,]', '', s)
    # ・大会新 -> 大会新
    if s == '・大会新':
        s = '大会新'
    return s.strip()

def deduplicate_chars(s):
    # 人名の重複文字（子子など）を1つに
    if len(s) < 2: return s
    res = ""
    for i in range(len(s)):
        if i > 0 and s[i] == s[i-1] and not s[i].isdigit() and s[i] not in ".:/-":
            continue
        res += s[i]
    return res

def is_lane_marker(s):
    # 水路（1/9など）の判定
    return bool(re.match(r'^\d+/\d*$', s))

def process_row(row):
    # 1. 物理的な分割を結合
    i = 0
    while i < len(row) - 1:
        if row[i] == '時' and row[i+1] == '間':
            row[i] = '時間'
            del row[i+1]
        elif row[i].endswith('/') and row[i+1].isdigit():
            row[i] = row[i] + row[i+1]
            del row[i+1]
        else:
            i += 1
            
    # 2. 氏名フィールドの特定と結合
    lane_idx = -1
    for i, item in enumerate(row):
        if is_lane_marker(item):
            lane_idx = i
            break
            
    if lane_idx != -1:
        start_name_idx = 1 if row[0].isdigit() else 0
        end_name_idx = lane_idx - 1 # 所属
        if end_name_idx > start_name_idx + 1:
            name = "".join(row[start_name_idx:end_name_idx])
            name = deduplicate_chars(name)
            row = row[:start_name_idx] + [name] + row[end_name_idx:]
            
    # 3. 値のクリーンアップ（括弧・符号除去）と「宮」の補正
    row = [clean_value(item).replace('宀', '宮') for item in row]
    
    return [item for item in row if item] # 空の要素を除去

try:
    with pdfplumber.open(pdf_path) as pdf:
        all_rows = []
        for page in pdf.pages:
            modified_chars = []
            for c in page.chars:
                c_copy = c.copy()
                key = f"{c['fontname']}_{c['text']}"
                if key in mapping:
                    c_copy['text'] = mapping[key]
                elif '\uf000' <= c['text'] <= '\uf8ff':
                    c_copy['text'] = '' 
                modified_chars.append(c_copy)
                
            text = pdfplumber.utils.extract_text(modified_chars, x_tolerance=4, y_tolerance=3)
            if not text: continue
            
            # 定型文の辞書補正
            text = text.replace('セントラノ', 'セントラル')
            text = text.replace('フェスティノノ', 'フェスティバル')
            text = text.replace('世界己へ', '世界記録')
            text = text.replace('日本己へ', '日本記録')
            text = text.replace('大会己へ', '大会記録')
            
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line: continue
                row = re.split(r'[\s\u3000]+', line)
                row = process_row(row)
                if row:
                    all_rows.append(row)

    with open(csv_path, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(all_rows)

    print(f"Successfully generated V3: {csv_path}")

except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
