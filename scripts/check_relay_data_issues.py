#!/usr/bin/env python3
"""
リレーデータの3つの問題を診断:
1. time_display が null なのに time_seconds がある
2. is_meet_record が false なのに CSV では大会新
3. dt_player_relay の player_id が null
"""
import csv, os, sys, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
from itertools import groupby
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

def normalize(s): return unicodedata.normalize('NFKC', s.strip()) if s else ''
def parse_time(s):
    if not s: return None
    s = s.strip()
    if s in ('DNS','DQ','NC','記録なし','-',''): return None
    try:
        return int(s.split(':')[0])*60+float(s.split(':')[1]) if ':' in s else float(s)
    except: return None

# ── 1. time_display が null なのに time_seconds がある ──────────────────────────
print("="*60)
print("【1. リレータイム表示なし（time_display=null, time_seconds有）】")
res = sb.table('dt_result_relay').select('id, time_seconds, time_display, mst_event(round)').is_('time_display', 'null').not_.is_('time_seconds', 'null').execute()
by_round = {}
for r in res.data:
    round_no = r['mst_event']['round']
    by_round.setdefault(round_no, []).append(r)
if not by_round:
    print("  問題なし")
else:
    for rnd in sorted(by_round):
        print(f"  第{rnd}回: {len(by_round[rnd])}件")
        for r in by_round[rnd][:3]:
            print(f"    id={r['id']} time_seconds={r['time_seconds']}")

# ── 2. is_meet_record の CSV vs DB 比較 ──────────────────────────────────────
print("\n" + "="*60)
print("【2. 大会新フラグ不一致（CSV=TRUE, DB=false）】")

csv_files = {
    74: 'data/第74回競技結果（チーム）.csv',
    75: 'data/第75回競技結果（チーム）.csv',
    76: 'data/第76回競技結果（チーム）.csv',
    77: 'data/第77回競技結果（チーム）.csv',
    78: 'data/第78回競技結果（チーム）.csv',
    79: 'data/第79回競技結果（チーム）.csv',
    80: 'data/第80回競技結果（チーム）.csv',
}

total_meet_fix = []

for round_no, csv_path in csv_files.items():
    if not os.path.exists(csv_path): continue

    with open(csv_path, encoding='utf-8-sig') as f:
        rows = [r for r in csv.DictReader(f) if r.get('タイプ','').strip() == 'チーム']

    # DBから該当大会のリレー結果を取得
    db_relay = sb.table('dt_result_relay')\
        .select('id, is_meet_record, rank, time_seconds, mst_team(name), mst_category(name), age_group_label')\
        .eq('event_id', sb.table('mst_event').select('id').eq('round', round_no).execute().data[0]['id'])\
        .execute().data

    # CSVから大会新のエントリを収集 (チームごとに集約)
    def rkey(r): return (r['競技名'], r['競技性別'], normalize(r['チーム名']), r['リレー年齢区分'], r['順位'])
    csv_meet_records = {}  # (cat_name+gender, team_name_norm, age, rank) -> True/False
    for key, group in groupby(sorted(rows, key=rkey), key=rkey):
        first = list(group)[0]
        cat_gender = first['競技性別'].strip()
        full_cat = f"{first['競技名'].strip()}（混合）" if cat_gender == '混合' else first['競技名'].strip()
        is_mr = bool(first.get('大会新','').strip())
        k = (full_cat, normalize(first['チーム名']), normalize(first['リレー年齢区分']), str(first['順位']).strip())
        csv_meet_records[k] = is_mr

    mismatch = 0
    for db in db_relay:
        team_n = normalize(db['mst_team']['name'])
        cat_n = db['mst_category']['name']
        age = normalize(db.get('age_group_label') or '')
        rank = str(db.get('rank','')).strip() if db.get('rank') is not None else ''
        k = (cat_n, team_n, age, rank)
        csv_mr = csv_meet_records.get(k)
        if csv_mr is not None and csv_mr != db['is_meet_record']:
            mismatch += 1
            total_meet_fix.append({'id': db['id'], 'is_meet_record': csv_mr})
            if mismatch <= 3:
                print(f"  第{round_no}回 [{db['mst_team']['name']}] {cat_n} {db['age_group_label']} rank={db['rank']}: CSV={csv_mr}, DB={db['is_meet_record']}")
    if mismatch:
        print(f"  第{round_no}回: {mismatch}件不一致")
    else:
        print(f"  第{round_no}回: OK")

print(f"\n合計大会新修正対象: {len(total_meet_fix)}件")

# ── 3. player_id が null の dt_player_relay ──────────────────────────────────
print("\n" + "="*60)
print("【3. リレーメンバー player_id=null】")
res3 = sb.table('dt_player_relay').select('id, swim_order, player_id, relay_result_id').is_('player_id', 'null').execute()
print(f"  player_id=null のメンバーレコード: {len(res3.data)}件")
if res3.data:
    for r in res3.data[:5]:
        print(f"    relay_result_id={r['relay_result_id']} swim_order={r['swim_order']}")

# ── 4. dt_player_relay の player_id が存在しない選手を参照 ────────────────────
print("\n" + "="*60)
print("【4. dt_player_relay → dt_player_person 参照切れ（broken FK）】")
# player_idがあるが、その選手がdt_player_personにいない
all_players = sb.table('dt_player_person').select('id').limit(20000).execute().data
player_ids = {p['id'] for p in all_players}
relay_members = sb.table('dt_player_relay').select('id, player_id, relay_result_id, swim_order').not_.is_('player_id', 'null').execute().data
broken = [m for m in relay_members if m['player_id'] not in player_ids]
print(f"  参照切れメンバー: {len(broken)}件")
if broken:
    for r in broken[:5]:
        print(f"    relay_result_id={r['relay_result_id']} swim_order={r['swim_order']} player_id={r['player_id']}")
