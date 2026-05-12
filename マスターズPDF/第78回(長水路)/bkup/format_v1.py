import csv
import re
import sys

in_file = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回元データ.csv'
out_file_indiv = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回（個人）V1.csv'
out_file_team = r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回（チーム）V1.csv'

def clean_str(s):
    if not s: return ""
    s = s.replace('ザノス', 'ザバス')
    s = s.replace('4ノ', '4x')
    s = s.replace('セ', ' ').replace('間', ' ')
    s = s.replace('己へェ', '記録').replace('己へx', '記録').replace('己へ', '記録')
    return s.strip()

state = {}
indiv_rows = []
team_rows = []

indiv_header = ["レース番号", "競技性別", "競技名", "世界記録", "日本記録", "年齢区分", "大会記録", "順位", "氏名", "所属", "水路", "時間", "飛込タイム", "LAPタイム"]
team_header = ["レース番号", "競技性別", "競技名", "世界記録", "日本記録", "年齢区分", "大会記録", "順位", "チーム名", "合計年齢", "水路", "時間", "LAPタイム", "第1泳者", "第1泳者飛込", "第1泳者タイム", "第2泳者", "第2泳者飛込", "第2泳者タイム", "第3泳者", "第3泳者飛込", "第3泳者タイム", "第4泳者", "第4泳者飛込", "第4泳者タイム"]

indiv_rows.append(indiv_header)
team_rows.append(team_header)

rows = list(csv.reader(open(in_file, encoding='utf-8-sig')))

def pop_state():
    return [state.get('no',''), state.get('gender',''), state.get('event',''), state.get('wr',''), state.get('nr',''), state.get('age',''), state.get('cr','')]

current_indiv = None
current_team = None
team_members = []
team_lap = ""

# Match Name, Team, Lane, Time
regex = re.compile(r'^(.*?)(・.+?|セ・.+?|cs.+?|ザノス.+?|ザバス.+?|ル・.+?|s.+?|曽谷・.+?|墨田区体育館|クリースパ|ミズノMT|・[^\d]+)\s*(\d+/\d+)\s*(\d[\d:.]*(?:[・*].*)?)$')

i = 0
fails = []

while i < len(rows):
    row = rows[i]
    if not row:
        i += 1
        continue
    
    col0 = clean_str(row[0])
    
    if col0.startswith('No.'):
        parts = col0.split(' ')
        parts = [p for p in parts if p]
        if len(parts) >= 3:
            state['no'] = parts[0]
            state['gender'] = parts[1]
            state['event'] = "".join(parts[2:])
        else:
            state['no'] = col0
    elif col0.startswith('世界'):
        m = re.search(r'[\d:.]+', col0)
        if m: state['wr'] = m.group(0)
    elif col0.startswith('日本'):
        m = re.search(r'[\d:.]+', col0)
        if m: state['nr'] = m.group(0)
    elif col0.startswith('《'):
        state['age'] = col0.replace('《','').replace('》','').strip()
    elif col0.startswith('大会'):
        m = re.search(r'[\d:.]+', col0)
        if m: state['cr'] = m.group(0)
    elif col0.isdigit():
        # Data row
        if 'リレ' in state.get('event', '') or 'メドレ' in state.get('event', ''):
            is_team_header = len(row) > 2 and '歳' in row[2]
            
            if is_team_header:
                # Team header
                if current_team and len(team_members) >= 4:
                    tr = pop_state() + current_team + [team_lap]
                    for m in team_members[:4]:
                        tr.extend(m)
                    team_rows.append(tr)
                
                rank = col0
                tname = clean_str(row[1]) if len(row) > 1 else ""
                tage = clean_str(row[2]) if len(row) > 2 else ""
                tdata = clean_str(row[3]) if len(row) > 3 else ""
                
                m_lane_time = re.search(r'(\d+/\s*\d+)\s+([\d:.]+)$', tdata)
                if m_lane_time:
                    lane = m_lane_time.group(1).replace(' ', '')
                    time = m_lane_time.group(2)
                else:
                    # fallback
                    m_lane = re.search(r'(\d+/\d+)', tdata.replace(' ', ''))
                    m_time = re.search(r'([\d:.]+)$', tdata.replace(' ', ''))
                    lane = m_lane.group(1) if m_lane else ""
                    time = m_time.group(1) if m_time else ""
                
                current_team = [rank, tname, tage, lane, time]
                team_members = []
                team_lap = ""
            else:
                # Team member
                m_name = clean_str(row[1]).replace('6', ' ') if len(row) > 1 else ""
                m_name = re.sub(r'(?<=.)(熊|子)(?=.)', ' ', m_name)
                m_react = clean_str(row[2]) if len(row) > 2 else ""
                if m_react.startswith('('):
                    m_react = m_react.replace('(', '').replace(')', '').replace('+', '')
                m_time = clean_str(row[3]) if len(row) > 3 else ""
                m_time = m_time.replace(' ', '')
                team_members.append([m_name, m_react, m_time])
                
        else:
            # Individual
            rank = col0
            data_col = clean_str(row[1]) if len(row) > 1 else ""
            reaction = clean_str(row[2]) if len(row) > 2 else ""
            if reaction.startswith('('):
                reaction = reaction.replace('(', '').replace(')', '').replace('+', '')
            
            data_nospaces = data_col.replace(' ', '')
            m = regex.match(data_nospaces)
            if m:
                name = m.group(1).replace('6', ' ')
                name = re.sub(r'(?<=.)(熊|子)(?=.)', ' ', name) # risky but based on fails.txt
                team = m.group(2)
                if team.startswith('・') or team.startswith('セ・'):
                    team = team.lstrip('セ・')
                lane = m.group(3)
                time = m.group(4)
            else:
                fails.append(data_col)
                name = data_col.replace('6', ' ')
                team = ""
                lane = ""
                time = ""
                
            current_indiv = pop_state() + [rank, name, team, lane, time, reaction, ""]
            indiv_rows.append(current_indiv)
            
    else:
        # Lap times
        lap = clean_str(row[0])
        # Replace multiple spaces with comma
        lap = re.sub(r'\s+', ',', lap)
        lap = lap.strip(',')
        
        if lap and lap[0].isdigit():
            if current_team and len(team_members) == 0 and not team_lap:
                team_lap = lap
            elif current_indiv and not current_indiv[-1]:
                current_indiv[-1] = lap

    i += 1

if current_team and len(team_members) >= 4:
    tr = pop_state() + current_team + [team_lap]
    for m in team_members[:4]:
        tr.extend(m)
    team_rows.append(tr)

with open(out_file_indiv, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(indiv_rows)
    
with open(out_file_team, 'w', encoding='utf-8-sig', newline='') as f:
    writer = csv.writer(f)
    writer.writerows(team_rows)

print(f"Done. Fails: {len(fails)}")
if fails:
    with open(r'c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\fails.txt', 'w', encoding='utf-8') as f:
        for fail in fails:
            f.write(fail + '\n')
