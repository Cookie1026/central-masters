import pdfplumber
import csv
import sys
import re

pdf_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第80回(長水路)\20260502_第80回セントラルマスターズ（全結果）.pdf"
csv_path = r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第80回(長水路)\第80回PDF元データ(anti).csv"

# クラブ名のキーワード
CLUB_KEYWORDS = r"セ・|CS|ザバス|Ｇ－ＳＰＡ|東急|ルネサンス|コナミ|イトマン|ＪＳＳ|ル・|あざみ野|目黒|西新井|新都心|上池袋"

def process_row(row):
    line = " ".join(row)
    
    # 個人結果のパターン
    pattern = rf'^(\d+)?\s*(.*?)\s*({CLUB_KEYWORDS})(.*?)\s*(\d+/\s*\d+)\s*(\d+:?\d*\.\d+)\s*(.*?)\s*(\(.*\))?$'
    m = re.match(pattern, line)
    if m:
        g = m.groups()
        new_row = []
        if g[0]: new_row.append(g[0]) # 順位
        if g[1]: new_row.append(g[1]) # 氏名
        new_row.append((g[2] + g[3]).strip()) # 所属
        new_row.append(g[4].replace(" ", "")) # 水路
        new_row.append(g[5]) # タイム
        if g[6]: new_row.append(g[6].strip()) # 備考
        if g[7]: new_row.append(g[7]) # 反応時間
        return new_row

    # リレーメンバーのパターン
    relay_pattern = r'^(\d+)?\s*(.*?)\s*(\(.*\))\s*(\d*\.?\d+)$'
    m_r = re.match(relay_pattern, line)
    if m_r:
        g = m_r.groups()
        return [i.strip() for i in g if i]

    # リレーメンバーのパターン (反応時間なし)
    relay_pattern_no_rt = r'^(\d+)?\s*(.*?)\s*(\d+\.?\d*)$'
    m_rn = re.match(relay_pattern_no_rt, line)
    if m_rn:
        g = m_rn.groups()
        if re.match(r'^\d+\.?\d*$', g[2]):
            return [i.strip() for i in g if i]

    # それ以外
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
        # Results start from page 4 (index 3)
        for page_num, page in enumerate(pdf.pages[3:]):
            text = page.extract_text(x_tolerance=3, y_tolerance=3)
            if not text:
                continue
                
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                if line.startswith("No.") or line.startswith("≪") or line.startswith("大会記録"):
                    all_rows.append([line])
                    continue
                if line.startswith("順位") and "氏名" in line:
                    all_rows.append(["順位", "氏名", "所属", "水路", "時間"])
                    continue

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
