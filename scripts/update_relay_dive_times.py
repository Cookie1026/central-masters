#!/usr/bin/env python3
"""
リレーメンバーの飛込タイムをOCRパース結果からDBに反映する

使い方:
  python scripts/update_relay_dive_times.py           # dry run（件数確認のみ）
  python scripts/update_relay_dive_times.py --fix     # 実際に更新

前提: dt_player_relay.dive_time カラムが追加済みであること
     (supabase/migrations/add_relay_dive_time.sql を実行済み)
"""
import sys, os, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
import pandas as pd
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

do_fix = '--fix' in sys.argv
sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# 対象大会: (回, event_id, relay_results.csv, relay_members.csv)
ROUNDS = [
    (76, 3,
     'マスターズPDF/第76回(短水路)/backup/generated/relay_results.csv',
     'マスターズPDF/第76回(短水路)/backup/generated/relay_members.csv'),
    (77, 4,
     'マスターズPDF/第77回(長水路)/backup/generated/relay_results.csv',
     'マスターズPDF/第77回(長水路)/backup/generated/relay_members.csv'),
    (78, 5,
     'マスターズPDF/第78回(長水路)/backup/generated/relay_results.csv',
     'マスターズPDF/第78回(長水路)/backup/generated/relay_members.csv'),
    (79, 6,
     'マスターズPDF/第79回(短水路)/generated/relay_results.csv',
     'マスターズPDF/第79回(短水路)/generated/relay_members.csv'),
    (80, 7,
     'マスターズPDF/第80回(長水路)/backup/generated/relay_results.csv',
     'マスターズPDF/第80回(長水路)/backup/generated/relay_members.csv'),
]

def norm(s):
    if not s or not isinstance(s, str):
        return ''
    return unicodedata.normalize('NFKC', str(s)).strip()

TEAM_PREFIXES = ['セ・', 'CS', 'ザバス', 'クリーンスパ', 'ミズノ']

def norm_team(s):
    """チーム名から共通プレフィックスを除いた短縮名（マッチング用）"""
    s = norm(s)
    for pfx in TEAM_PREFIXES:
        if s.startswith(pfx):
            return s[len(pfx):]
    return s

def norm_event(s):
    """種目名から（混合）サフィックスを除去（CSVでは gender=混合 で別管理されるため）
    NFKC正規化後は（）→() になるため両パターンを対応"""
    s = norm(s)
    return s.replace('(混合)', '').replace('（混合）', '').strip()

def parse_relay_key(key):
    """relay_key '{round}_{race_no}_{age_group}_{team_name}_{rank}' を分解"""
    parts = str(key).split('_')
    if len(parts) < 5:
        return None, None, None, None
    return int(parts[1]), parts[2], parts[3], parts[4]  # race_no, age_group, team_name, rank

total_updates = 0

for round_no, event_id, rr_path, rm_path in ROUNDS:
    print(f'\n=== 第{round_no}回 (event_id={event_id}) ===')

    # ---- CSV読み込み ----
    rr_df = pd.read_csv(rr_path, encoding='utf-8-sig')
    rm_df = pd.read_csv(rm_path, encoding='utf-8-sig')

    # race_no → (event_name, gender) マッピング（同一race_noで複数行あるが内容は同じ）
    race_info = {}
    for _, row in rr_df.iterrows():
        rn = int(row['race_no'])
        if rn not in race_info:
            race_info[rn] = (norm(row['event_name']), norm(row['gender']))

    # CSV lookup: (event_name, gender, age_group, team_name, swim_order, split_sec) → dive_time
    # split_secondsを追加することで同一チームが同カテゴリに複数エントリある場合も一意にする
    csv_lookup = {}
    rm_with_dive = rm_df[rm_df['dive_time'].notna()]
    for _, row in rm_with_dive.iterrows():
        race_no, age_grp, team, _rank = parse_relay_key(row['relay_key'])
        if race_no is None or race_no not in race_info:
            continue
        ev_name, gender = race_info[race_no]
        split = round(float(row['split_seconds']), 2) if pd.notna(row.get('split_seconds')) else None
        key = (ev_name, gender, norm(age_grp), norm_team(team), int(row['swim_order']), split)
        csv_lookup[key] = float(row['dive_time'])

    print(f'CSV dive_time エントリ: {len(csv_lookup)}件')

    # ---- DB読み込み ----
    # 1. dt_result_relay → relay_result_id ごとに (category_name, gender, age_group, team_name) 取得
    relay_results = []
    offset, batch = 0, 1000
    while True:
        r = sb.table('dt_result_relay')\
            .select('id, mst_team(name), mst_age(name), mst_category(id, name, gender)')\
            .eq('event_id', event_id)\
            .range(offset, offset + batch - 1).execute()
        relay_results.extend(r.data)
        if len(r.data) < batch:
            break
        offset += batch

    # relay_result_id → info dict
    relay_info_db = {}
    for row in relay_results:
        cat = row.get('mst_category') or {}
        team = (row.get('mst_team') or {}).get('name', '')
        age = (row.get('mst_age') or {}).get('name', '')
        relay_info_db[row['id']] = {
            'event_name': norm_event(cat.get('name', '')),
            'gender': norm(cat.get('gender', '')),
            'age': norm(age),
            'team': norm(team),
        }

    # 2. dt_player_relay → (relay_result_id, swim_order) → dt_player_relay_id
    # relay_result_idを300件ずつのバッチに分け、各バッチ内もpaginationで全件取得
    rids = list(relay_info_db.keys())
    members_db = []
    for i in range(0, len(rids), 300):
        batch_ids = rids[i:i+300]
        off = 0
        while True:
            r = sb.table('dt_player_relay')\
                .select('id, relay_result_id, swim_order, split_seconds, dive_time')\
                .in_('relay_result_id', batch_ids)\
                .range(off, off + 999).execute()
            members_db.extend(r.data)
            if len(r.data) < 1000:
                break
            off += 1000

    # DB lookup: (event_name, gender, age_group, team_name, swim_order, split_sec) → {id, dive_time}
    db_lookup = {}
    for m in members_db:
        info = relay_info_db.get(m['relay_result_id'], {})
        split = round(float(m['split_seconds']), 2) if m.get('split_seconds') is not None else None
        key = (info.get('event_name', ''), info.get('gender', ''),
               info.get('age', ''), norm_team(info.get('team', '')), m['swim_order'], split)
        db_lookup[key] = {'id': m['id'], 'current_dive': m['dive_time']}

    print(f'DB エントリ: {len(db_lookup)}件')

    # ---- マッチング ----
    updates = []
    no_match = 0
    for key, dive_time in csv_lookup.items():
        if key in db_lookup:
            entry = db_lookup[key]
            if entry['current_dive'] is None:
                updates.append({'id': entry['id'], 'dive_time': dive_time})
        else:
            no_match += 1

    print(f'UPDATE候補: {len(updates)}件 / マッチなし: {no_match}件')
    for u in updates[:3]:
        print(f'  id={u["id"]} dive_time={u["dive_time"]}')

    # ---- 適用 ----
    if do_fix and updates:
        print('--- UPDATE実行 ---')
        for i, u in enumerate(updates):
            sb.table('dt_player_relay').update({'dive_time': u['dive_time']}).eq('id', u['id']).execute()
            if (i + 1) % 100 == 0:
                print(f'  {i+1}/{len(updates)}件...')
        print(f'完了: {len(updates)}件更新')
        total_updates += len(updates)

if do_fix:
    print(f'\n全体完了: {total_updates}件更新')
else:
    print('\n--- 確認のみ（--fix で実行） ---')
