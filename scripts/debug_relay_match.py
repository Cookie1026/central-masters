#!/usr/bin/env python3
"""第80回の部分欠損リレーのCSVマッチングをデバッグ"""
import csv, os, sys, re, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
from itertools import groupby
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

def normalize(s): return unicodedata.normalize('NFKC', s.strip()) if s else ''

# 対象
targets = [
    {'id': 5080, 'team': 'セ・二俣川', 'cat': '4×50mメドレーリレー（混合）', 'age': '240～279歳', 'rank': 1},
    {'id': 5089, 'team': 'セ・市ヶ尾',  'cat': '4×50mメドレーリレー（混合）', 'age': '160～199歳', 'rank': 1},
]

with open('data/第80回競技結果（チーム）.csv', encoding='utf-8-sig') as f:
    rows = [r for r in csv.DictReader(f) if r.get('タイプ','').strip() == 'チーム']

print(f"CSVチーム行: {len(rows)}行")

teams = sb.table('mst_team').select('id, name').execute().data
team_by_name = {normalize(t['name']): t['id'] for t in teams}
alias_data = sb.table('mst_team_alias').select('alias, team_id').execute().data
alias_map = {normalize(a['alias']): a['team_id'] for a in alias_data}

def resolve_team_id(name):
    n = normalize(name)
    return team_by_name.get(n) or alias_map.get(n)

for target in targets:
    team_id = resolve_team_id(target['team'])
    age_str = target['age']
    cat_name = target['cat']
    rank = target['rank']

    print(f"\n=== {target['team']} {cat_name} {age_str} rank={rank} ===")
    print(f"  team_id解決: {team_id}")
    print(f"  normalize(age_str): {repr(normalize(age_str))}")

    # CSVから該当グループを探す
    found_any = False
    for row in rows:
        csv_team_id = resolve_team_id(row['チーム名'])
        csv_gender = row['競技性別'].strip()
        csv_cat_raw = row['競技名'].strip()
        full_csv_cat = f"{csv_cat_raw}（混合）" if csv_gender == '混合' else csv_cat_raw

        if csv_team_id == team_id:
            found_any = True
            csv_age_norm = normalize(row['リレー年齢区分'])
            age_match = csv_age_norm == normalize(age_str)
            cat_match = full_csv_cat == cat_name
            rank_match = str(row['順位']).strip() == str(rank)
            if csv_gender == '混合' and normalize(row['リレー年齢区分']) == normalize(age_str):
                print(f"  CSV候補: {row['競技名']} / {csv_gender} / {row['リレー年齢区分']} / rank={row['順位']}")
                print(f"    full_csv_cat={repr(full_csv_cat)} == cat_name={repr(cat_name)} → {cat_match}")
                print(f"    age csv={repr(csv_age_norm)} == db={repr(normalize(age_str))} → {age_match}")
                print(f"    rank csv={repr(row['順位'])} == {repr(str(rank))} → {rank_match}")

    if not found_any:
        print(f"  [!] このチームのCSV行自体が見つからない")
        # CSVのチーム名一覧を表示
        csv_teams = sorted(set(r['チーム名'] for r in rows))
        for ct in csv_teams:
            if 'ヶ尾' in ct or '二俣' in ct:
                print(f"    候補チーム名: {repr(ct)} → ID: {resolve_team_id(ct)}")
