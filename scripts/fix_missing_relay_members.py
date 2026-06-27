#!/usr/bin/env python3
"""
リレーメンバー欠損補完スクリプト
relay_members.csv に存在するが dt_player_relay に存在しないメンバーを挿入する。
あわせて split_seconds が null の既存レコードを CSV 値で補完する。

使い方:
  python scripts/fix_missing_relay_members.py           # dry run（件数確認）
  python scripts/fix_missing_relay_members.py --fix     # 実際に挿入・更新

対象: 第74〜79回（第80回は欠損なし）
"""
import sys, os, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
import pandas as pd
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

do_fix = '--fix' in sys.argv
sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

ROUNDS = [
    (74, 1, 'マスターズPDF/第74回(短水路)/backup/generated'),
    (75, 2, 'マスターズPDF/第75回(長水路)/backup/generated'),
    (76, 3, 'マスターズPDF/第76回(短水路)/backup/generated'),
    (77, 4, 'マスターズPDF/第77回(長水路)/backup/generated'),
    (78, 5, 'マスターズPDF/第78回(長水路)/backup/generated'),
    (79, 6, 'マスターズPDF/第79回(短水路)/generated'),
]

def norm(s):
    if not s or not isinstance(s, str): return ''
    return unicodedata.normalize('NFKC', str(s)).strip()

TEAM_PREFIXES = ['セ・', 'CS', 'ザバス', 'クリーンスパ', 'ミズノ']

def norm_team(s):
    s = norm(s)
    for pfx in TEAM_PREFIXES:
        if s.startswith(pfx):
            return s[len(pfx):]
    return s

def norm_event(s):
    s = norm(s)
    return s.replace('(混合)', '').replace('（混合）', '').strip()

# ── 全選手をメモリにロード ────────────────────────────────────────
print('選手データ読み込み中...')
all_players = []
off = 0
while True:
    r = sb.table('dt_player_person').select('id, name, gender, team_id').range(off, off+999).execute()
    all_players.extend(r.data)
    if len(r.data) < 1000: break
    off += 1000
print(f'  {len(all_players)}件')

# name(norm) → [{id, gender, team_id}, ...]
players_by_name = {}
for p in all_players:
    n = norm(p['name'])
    players_by_name.setdefault(n, []).append(p)

# ── チームマスターをロード ────────────────────────────────────────
teams = sb.table('mst_team').select('id, name').execute().data
team_by_id = {t['id']: t['name'] for t in teams}
_team_id_map = {}
for t in teams:
    _team_id_map[norm(t['name'])] = t['id']
    _team_id_map[norm_team(t['name'])] = t['id']

def find_team_id(name):
    n = norm(name)
    if n in _team_id_map:
        return _team_id_map[n]
    return _team_id_map.get(norm_team(n))

def find_player(name, gender, team_id):
    """dt_player_person から player_id を検索（段階的フォールバック）"""
    n = norm(name)
    matches = players_by_name.get(n, [])
    if not matches:
        return None
    # 完全一致 (name + team + gender)
    for p in matches:
        if p['team_id'] == team_id and p['gender'] == gender:
            return p['id']
    # チームのみ
    for p in matches:
        if p['team_id'] == team_id:
            return p['id']
    # 性別のみ
    if gender:
        for p in matches:
            if p['gender'] == gender:
                return p['id']
    # 名前のみ（唯一）
    if len(matches) == 1:
        return matches[0]['id']
    return None

def create_player_db(name, gender, team_id):
    """新規選手を登録してキャッシュに追加"""
    r = sb.table('dt_player_person').insert({'name': norm(name), 'gender': gender, 'team_id': team_id}).execute()
    pid = r.data[0]['id']
    players_by_name.setdefault(norm(name), []).append({'id': pid, 'gender': gender, 'team_id': team_id})
    return pid


total_inserted = 0
total_split_updated = 0
total_skip_no_relay = 0
total_skip_no_player = 0

for round_no, event_id, gen_dir in ROUNDS:
    print(f'\n=== 第{round_no}回 (event_id={event_id}) ===')

    rr_path = f'{gen_dir}/relay_results.csv'
    rm_path = f'{gen_dir}/relay_members.csv'

    if not os.path.exists(rm_path):
        print(f'  relay_members.csv なし → スキップ')
        continue

    rr_df = pd.read_csv(rr_path, encoding='utf-8-sig')
    rm_df = pd.read_csv(rm_path, encoding='utf-8-sig')
    print(f'  CSV: relay_results={len(rr_df)}行 relay_members={len(rm_df)}行')

    # race_no → (event_name, gender)
    race_info = {}
    for _, row in rr_df.iterrows():
        rn = int(row['race_no'])
        if rn not in race_info:
            race_info[rn] = (norm_event(norm(row['event_name'])), norm(row['gender']))

    # ── DB リレー結果ロード ──
    relay_rows_db = []
    off = 0
    while True:
        r = sb.table('dt_result_relay')\
            .select('id, rank, time_seconds, mst_team(name), mst_age(name), mst_category(name, gender)')\
            .eq('event_id', event_id).range(off, off+999).execute()
        relay_rows_db.extend(r.data)
        if len(r.data) < 1000: break
        off += 1000

    relay_info_db = {}
    for row in relay_rows_db:
        cat = row.get('mst_category') or {}
        team_name = (row.get('mst_team') or {}).get('name', '')
        age_name  = (row.get('mst_age') or {}).get('name', '')
        relay_info_db[row['id']] = {
            'event_name': norm_event(norm(cat.get('name', ''))),
            'gender':     norm(cat.get('gender', '')),
            'age':        norm(age_name),
            'team':       team_name,
            'rank':       row['rank'],
            'time':       row.get('time_seconds'),
        }

    # (ev_name, gender, age, norm_team, rank) → relay_result_id（またはリスト）
    relay_key_map = {}
    for rid, info in relay_info_db.items():
        k = (info['event_name'], info['gender'], info['age'], norm_team(info['team']), info['rank'])
        if k in relay_key_map:
            existing = relay_key_map[k]
            if isinstance(existing, list):
                existing.append(rid)
            else:
                relay_key_map[k] = [existing, rid]
        else:
            relay_key_map[k] = rid

    # ── DB 既存メンバーロード ──
    rids_all = list(relay_info_db.keys())
    existing_members = {}  # (relay_result_id, swim_order) → dt_player_relay id
    existing_splits  = {}  # (relay_result_id, swim_order) → split_seconds
    for i in range(0, len(rids_all), 300):
        batch = rids_all[i:i+300]
        off = 0
        while True:
            r = sb.table('dt_player_relay')\
                .select('id, relay_result_id, swim_order, split_seconds')\
                .in_('relay_result_id', batch).range(off, off+999).execute()
            for m in r.data:
                mk = (m['relay_result_id'], m['swim_order'])
                existing_members[mk] = m['id']
                existing_splits[mk]  = m['split_seconds']
            if len(r.data) < 1000: break
            off += 1000

    print(f'  DB: relay={len(relay_info_db)}件 member={len(existing_members)}件')

    # 個人結果CSVから name → gender マップを構築（混合リレー選手の性別補完用）
    ind_path = f'{gen_dir}/individual_results.csv'
    ind_gender_map = {}  # norm(name) → gender
    if os.path.exists(ind_path):
        ind_df = pd.read_csv(ind_path, encoding='utf-8-sig')
        for _, ir in ind_df.iterrows():
            n = norm(str(ir.get('athlete_name', '')))
            g = str(ir.get('gender', '')).strip()
            if n and g in ('男子', '女子'):
                ind_gender_map[n] = g

    inserts = []
    split_updates = []  # [(dt_player_relay_id, split_value)]
    skip_no_relay  = 0
    skip_no_player = 0
    new_players    = []

    for _, row in rm_df.iterrows():
        relay_key = str(row['relay_key'])
        parts = relay_key.split('_')
        if len(parts) < 5:
            continue

        try:
            csv_race_no = int(parts[1])
        except ValueError:
            continue
        csv_age_grp  = parts[2]
        csv_team     = parts[3]
        csv_rank_str = parts[4]
        csv_rank     = int(csv_rank_str) if csv_rank_str.isdigit() else None

        if csv_race_no not in race_info:
            skip_no_relay += 1
            continue

        ev_name, gender = race_info[csv_race_no]
        csv_swim_order  = int(row['swim_order'])

        # relay_result_id 検索
        k = (ev_name, gender, norm(csv_age_grp), norm_team(csv_team), csv_rank)
        relay_result_id = relay_key_map.get(k)

        if relay_result_id is None:
            skip_no_relay += 1
            continue

        # 同キーに複数マッチ → まず既存メンバーがいない方を選ぶ
        if isinstance(relay_result_id, list):
            chosen = None
            for rid in relay_result_id:
                if (rid, csv_swim_order) not in existing_members:
                    chosen = rid
                    break
            if chosen is None:
                chosen = relay_result_id[0]
            relay_result_id = chosen

        member_key = (relay_result_id, csv_swim_order)

        # ── 既存レコードの場合 → split_seconds 補完チェック ──
        if member_key in existing_members:
            csv_split = float(row['split_seconds']) if pd.notna(row.get('split_seconds')) else None
            if existing_splits.get(member_key) is None and csv_split is not None:
                split_updates.append((existing_members[member_key], csv_split))
            continue

        # ── 欠損レコード → player_id 検索 ──
        csv_name = str(row['athlete_name'])
        team_id  = find_team_id(csv_team)

        # リレー性別から個人性別を推定（混合の場合は個人結果CSVで補完）
        if gender == '男子':
            member_gender = '男子'
        elif gender == '女子':
            member_gender = '女子'
        else:
            member_gender = ind_gender_map.get(norm(csv_name))  # 混合: 個人結果から推定

        player_id = find_player(csv_name, member_gender, team_id)

        if player_id is None:
            if member_gender and team_id:
                # 新規選手として作成
                new_players.append({'name': csv_name, 'gender': member_gender, 'team': csv_team})
                if do_fix:
                    player_id = create_player_db(csv_name, member_gender, team_id)
                else:
                    player_id = None  # dry-run では None のまま
            else:
                skip_no_player += 1
                continue

        csv_split = float(row['split_seconds']) if pd.notna(row.get('split_seconds')) else None
        csv_dive  = float(row['dive_time'])      if pd.notna(row.get('dive_time'))      else None

        inserts.append({
            'relay_result_id': relay_result_id,
            'player_id':       player_id,
            'swim_order':      csv_swim_order,
            'split_seconds':   csv_split,
            'dive_time':       csv_dive,
        })
        existing_members[member_key] = -1  # 重複挿入防止

    print(f'  INSERT候補: {len(inserts)}件 | split_UPDATE候補: {len(split_updates)}件 | '
          f'no_relay: {skip_no_relay} | no_player: {skip_no_player}')
    if new_players:
        print(f'  新規選手作成: {len(new_players)}件')
        for np_ in new_players[:5]:
            print(f'    {np_["name"]} {np_["gender"]} ({np_["team"]})')

    if do_fix:
        # INSERT（分割実行）
        for i in range(0, len(inserts), 200):
            batch = [r for r in inserts[i:i+200] if r['player_id'] is not None]
            if batch:
                sb.table('dt_player_relay').insert(batch).execute()
        # split_seconds UPDATE
        for pr_id, split_val in split_updates:
            sb.table('dt_player_relay').update({'split_seconds': split_val}).eq('id', pr_id).execute()
        total_inserted      += len([r for r in inserts if r['player_id'] is not None])
        total_split_updated += len(split_updates)
        print(f'  → {len(inserts)}件挿入, {len(split_updates)}件split更新 完了')
    else:
        total_skip_no_relay  += skip_no_relay
        total_skip_no_player += skip_no_player

if do_fix:
    print(f'\n全体完了: {total_inserted}件挿入 / {total_split_updated}件split更新')
else:
    print(f'\n--- dry run完了 ---')
    print(f'no_relay skip合計: {total_skip_no_relay} | no_player skip合計: {total_skip_no_player}')
    print('→ --fix で実行')
