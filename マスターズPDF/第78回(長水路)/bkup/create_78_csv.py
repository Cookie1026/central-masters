import csv
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

in_file = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回元データ.csv'
out_file = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\第78回claude元データ.csv'

header = ['種別', 'No', '種目', '年齢区分', '順位', '氏名_チーム名', '所属_合計年齢', '水路', '時間', '備考', 'メンバー1', 'メンバー2', 'メンバー3', 'メンバー4']

# 総合成績 data (pages 1-4, not in raw CSV)
sogo_data = [
    (1, 'セントラルフィットネスクラブ二俣川', '832.0点'),
    (2, 'セントラルウェルネスクラブ成城', '644.0点'),
    (3, 'セントラルウェルネスクラブ慶應日吉', '574.0点'),
    (4, 'セントラルウェルネスクラブ葛西', '571.0点'),
    (5, 'セントラルウェルネスクラブ長津田みなみ台', '483.0点'),
    (6, 'セントラルフィットネスクラブ市ヶ尾', '465.0点'),
    (7, 'トーアセントラルフィットネスクラブ阿佐谷', '419.0点'),
    (8, 'セントラルフィットネスクラブ天王洲', '418.0点'),
    (9, 'セントラルウェルネスクラブおおたかの森', '406.0点'),
    (10, 'セントラルウェルネスクラブ大森', '326.0点'),
    (11, 'セントラルウェルネスクラブ越谷', '306.0点'),
    (12, 'セントラルウェルネスクラブ大宮宮原', '297.0点'),
    (13, 'セントラルウェルネスクラブ清瀬', '287.0点'),
    (14, 'セントラルウェルネスクラブ南千住', '240.0点'),
    (15, 'ニッセイセントラルフィットネスクラブ松戸', '223.0点'),
    (16, 'セントラルフィットネスクラブ市川', '202.0点'),
    (17, 'ザバススポーツクラブ川崎', '184.0点'),
    (18, 'セントラルウェルネスクラブ上池袋', '174.0点'),
    (19, 'セントラルウェルネスクラブ我孫子', '172.0点'),
    (20, 'セントラルフィットネスクラブ用賀', '169.0点'),
    (21, 'セントラルフィットネスクラブ南青山', '153.0点'),
    (22, 'セントラルウェルネスクラブ成瀬', '148.0点'),
    (23, 'セントラルウェルネスクラブ志木', '142.0点'),
    (24, 'セントラルフィットネスクラブ24袖ケ浦駅前', '127.0点'),
    (25, 'セントラルフィットネスクラブ八王子', '122.0点'),
    (26, 'セントラルウェルネスクラブ柏', '121.0点'),
    (27, 'ザバススポーツクラブ金沢八景', '120.0点'),
    (28, 'セントラルフィットネスクラブ茂原', '116.0点'),
    (29, 'セントラルフィットネスクラブ谷津', '113.0点'),
    (30, 'セントラルフィットネスクラブ流山', '110.0点'),
    (30, 'セントラルスイムクラブ横浜', '110.0点'),
    (32, 'セントラルウェルネスクラブ桶川北本', '103.0点'),
    (33, 'ラヴィセントラルフィットネスクラブ蒲田', '102.0点'),
    (34, 'セントラルフィットネスクラブ平塚', '95.0点'),
    (35, 'セントラルフィットネスクラブ武蔵小杉', '87.0点'),
    (36, 'セントラルスイムクラブ湘南台', '75.0点'),
    (37, 'セントラルウェルネスクラブ能見台', '67.0点'),
    (38, 'セントラルウェルネスクラブさいたま新都心', '63.0点'),
    (38, 'セントラルフィットネスクラブ藤沢', '63.0点'),
    (40, 'セントラルウェルネスクラブときわ台', '62.0点'),
    (40, 'セントラルウェルネスクラブトレッサ(大倉山)', '62.0点'),
    (42, 'セントラルフィットネスクラブ自由が丘', '59.0点'),
    (43, 'セントラルスポーツクラブ館山', '54.0点'),
    (44, 'セントラルスポーツクラブ戸塚', '51.0点'),
    (45, 'セントラルスポーツクラブ東戸塚', '50.0点'),
    (46, 'セントラルウェルネスクラブ西新井', '48.0点'),
    (46, 'ザバススポーツクラブ鶴見', '48.0点'),
    (48, 'セントラルフィットネスクラブ府中', '47.0点'),
    (48, 'セントラルフィットネスクラブ目黒', '47.0点'),
    (50, 'セントラルスポーツクリーンスパイチカワ', '46.0点'),
    (51, 'セントラルスポーツクラブ南宇都宮', '45.0点'),
    (51, 'ゴールデンスパ・ニューオータニ', '45.0点'),
    (53, 'セントラルウェルネスクラブ福島', '40.0点'),
    (54, 'セントラルスポーツフッサ', '39.0点'),
    (55, 'セントラルフィットネスクラブ稲毛海岸', '36.0点'),
    (56, '墨田区総合体育館', '33.0点'),
    (57, 'セントラルフィットネスクラブ新川崎', '28.0点'),
    (58, '曽谷セントラルスイムクラブ', '27.0点'),
    (58, 'セントラルスイムクラブ川越', '27.0点'),
    (58, 'セントラルフィットネスクラブ東戸塚', '27.0点'),
    (61, 'セントラルフィットネスクラブ西東京', '26.0点'),
    (62, 'セントラルフィットネスクラブ下北沢', '21.0点'),
    (63, 'セントラルフィットネスクラブ宇都宮', '19.0点'),
    (64, 'セントラルスポーツクラブ岩槻', '12.0点'),
    (64, 'セントラルウェルネスクラブ24久喜', '12.0点'),
    (64, 'セントラルフィットネスクラブ青砥', '12.0点'),
    (64, 'ザバススポーツクラブ藤が丘', '12.0点'),
    (68, 'セントラルウェルネスクラブ東十条', '11.0点'),
    (69, 'セントラルフィットネスクラブ溝ノ口', '10.0点'),
    (70, 'セントラルフィットネスクラブ越谷レイクタウン', '7.0点'),
    (71, 'セントラルウェルネスクラブ高崎', '6.0点'),
    (71, 'セントラルスポーツクラブ宇都宮', '6.0点'),
    (73, 'セントラルフィットネスクラブ亀有', '4.0点'),
]

def normalize_event_name(gender, name):
    """Normalize event name."""
    name = name.replace('フリ-', 'フリー').replace('メドレ-', 'メドレー')
    name = name.replace('リレ-', 'リレー')
    # Fix relay marker: '4X' or '4,' prefix → '4×'
    name = re.sub(r'^4[X×,]', '4×', name)
    if not name.startswith('4×') and name.startswith('4'):
        name = '4×' + name[1:]
    return gender + name

def is_relay_event(event_name):
    return 'リレ' in event_name

def parse_event_header(row):
    """Parse event header row. Returns (no, gender, name) or None."""
    if not row:
        return None
    col0 = row[0]

    # Pattern: ['No.X', 'gender', 'name'] (3+ columns)
    if col0.startswith('No.') and len(row) >= 3:
        no = col0
        gender = row[1]
        name = ''.join(row[2:])
        return no, gender, name

    # Pattern: ['No.XOgenderOname'] (single column with O separator)
    if col0.startswith('No.') and 'O' in col0:
        parts = col0.split('O', 2)
        if len(parts) >= 3:
            no = parts[0]
            gender = parts[1]
            name = parts[2]
            return no, gender, name

    return None

def parse_age_group(row):
    """Parse age group row. Returns age string or None."""
    if not row:
        return None
    col0 = row[0]

    # Pattern: ['《', 'XX~XX歳', '》']
    if col0 == '《' and len(row) >= 2:
        return row[1].replace('歳', '').strip()

    # Pattern: ['《OXX~XX歳O》']
    if col0.startswith('《'):
        inner = col0.replace('《', '').replace('》', '').replace('O', '').strip()
        if inner:
            return inner.replace('歳', '').strip()

    return None

def is_lap_row(row):
    """Check if row is LAP times."""
    if not row:
        return False
    # LAP rows have time patterns in first cell
    return bool(re.match(r'^\d+[\d:.]+$', row[0]))

def is_individual_data_row(row):
    """Check if row is an individual swimmer data row."""
    if not row or len(row) < 3:
        return False
    if not row[0].isdigit():
        return False
    # Check for lane pattern (digit/digit) in columns 2-5
    for col in row[2:6]:
        if re.match(r'^\d+/\d*$', col.replace(' ', '')):
            return True
    # Also check if col[3] is partial lane like '5/' and col[4] starts with digit
    if len(row) > 4 and re.match(r'^\d+/$', row[3]) and row[4] and row[4][0].isdigit():
        return True
    return False

def is_relay_team_row(row):
    """Check if row is a relay team data row."""
    if not row or len(row) < 4:
        return False
    if not row[0].isdigit():
        return False
    # Has '歳' in col[2]
    if len(row) > 2 and '歳' in row[2]:
        return True
    return False

def is_relay_member_row(row):
    """Check if row is a relay member row."""
    if not row or len(row) < 3:
        return False
    if not row[0].isdigit():
        return False
    # col[2] starts with '('
    if len(row) > 2 and row[2].startswith('('):
        return True
    return False

def extract_time_and_notes(time_str):
    """Extract time and any notes from time string."""
    notes = ''
    time_str = time_str.strip()
    # Check for ・大会新 or similar
    m = re.search(r'(・[^(]+)', time_str)
    if m:
        notes = m.group(1).strip()
        time_str = time_str[:m.start()].strip()
    return time_str, notes

# Read raw CSV
rows = list(csv.reader(open(in_file, encoding='utf-8-sig')))
print(f'Read {len(rows)} rows from raw CSV')

# Output rows
output_rows = [header]

# Add 総合成績
for rank, team, points in sogo_data:
    output_rows.append(['総合', '', '総合成績', '', str(rank), team, points, '', '', '', '', '', '', ''])

# Parse event data
current_no = ''
current_gender = ''
current_event = ''
current_age = ''
current_is_relay = False

# For relay: collect team + members
pending_team = None   # [rank, name, total_age, lane, time, notes]
pending_members = []  # [name, ...]

def flush_relay_team():
    """Flush pending relay team row."""
    global pending_team, pending_members
    if pending_team is None:
        return
    rank, name, total_age, lane, time, notes = pending_team
    members = pending_members[:4]
    while len(members) < 4:
        members.append('')
    row = [
        'リレー', current_no, normalize_event_name(current_gender, current_event),
        current_age, rank, name, total_age, lane, time, notes
    ] + members
    output_rows.append(row)
    pending_team = None
    pending_members = []

skip_patterns = {'順位', '出力日時:', '会場:', '期日:', '第78回セントラル', '配点'}

for i, row in enumerate(rows):
    if not row or not row[0]:
        continue

    col0 = row[0].strip()

    # Skip header/footer lines
    if any(col0.startswith(p) for p in skip_patterns):
        continue
    if col0.startswith('世界') or col0.startswith('日本') or col0.startswith('大会'):
        continue

    # Event header
    parsed = parse_event_header(row)
    if parsed:
        # Flush any pending relay team
        if current_is_relay:
            flush_relay_team()
        current_no, current_gender, current_event = parsed
        current_is_relay = is_relay_event(current_event)
        continue

    # Age group
    age = parse_age_group(row)
    if age is not None:
        # Flush any pending relay team on age group change
        if current_is_relay:
            flush_relay_team()
        current_age = age + '歳'
        continue

    # LAP times - skip
    if is_lap_row(row):
        continue

    if not current_no:
        continue

    if current_is_relay:
        # Relay team row
        if is_relay_team_row(row):
            flush_relay_team()
            rank = row[0]
            name = row[1] if len(row) > 1 else ''
            total_age = row[2] if len(row) > 2 else ''
            lane = row[3] if len(row) > 3 else ''
            time_raw = row[4] if len(row) > 4 else ''
            time, notes = extract_time_and_notes(time_raw)
            pending_team = [rank, name, total_age, lane, time, notes]
            pending_members = []
        elif is_relay_member_row(row):
            # Member row: [num, name, (react), split]
            member_name = row[1] if len(row) > 1 else ''
            if member_name:
                pending_members.append(member_name)
        # else: might be a continuation or other line
    else:
        # Individual event row
        if is_individual_data_row(row):
            rank = row[0]
            name = row[1] if len(row) > 1 else ''
            club = row[2] if len(row) > 2 else ''
            lane = ''
            time_raw = ''
            notes = ''

            # Find lane column
            found_lane = False
            for j in range(2, min(len(row), 6)):
                col = row[j].replace(' ', '')
                if re.match(r'^\d+/\d+$', col):
                    lane = col
                    time_raw = row[j+1] if j+1 < len(row) else ''
                    for extra in row[j+2:]:
                        if extra.startswith('('):
                            break
                        elif extra.startswith('・'):
                            notes += extra
                    found_lane = True
                    break
                elif re.match(r'^\d+/$', col) and j+1 < len(row):
                    # Partial lane: digit/ + next col starts with digit
                    next_col = row[j+1]
                    m_digit = re.match(r'^(\d+)', next_col)
                    if m_digit:
                        lane = col + m_digit.group(1)
                        # Time is the rest of next_col after the digit prefix
                        rest = next_col[len(m_digit.group(1)):]
                        # Strip leading 'O' junk characters
                        rest = re.sub(r'^[O\s]+', '', rest)
                        time_raw = rest if rest else (row[j+2] if j+2 < len(row) else '')
                        found_lane = True
                    break

            if not found_lane:
                # fallback: treat col[3] as lane, col[4] as time
                lane = row[3] if len(row) > 3 else ''
                time_raw = row[4] if len(row) > 4 else ''

            time, extra_notes = extract_time_and_notes(time_raw)
            if extra_notes:
                notes = extra_notes

            output_row = [
                '個人', current_no, normalize_event_name(current_gender, current_event),
                current_age, rank, name, club, lane, time, notes,
                '', '', '', ''
            ]
            output_rows.append(output_row)

# Flush final relay team if any
if current_is_relay:
    flush_relay_team()

print(f'Generated {len(output_rows)-1} data rows (excluding header)')

# Write output with UTF-8 BOM
with open(out_file, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(output_rows)

print(f'Written to {out_file}')
