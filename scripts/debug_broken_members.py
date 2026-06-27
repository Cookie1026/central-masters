#!/usr/bin/env python3
"""参照切れリレーメンバーの詳細分析"""
import sys, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
import os
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

def fetch_all(table, select_cols, **filters):
    """ページネーションで全件取得"""
    all_data, offset, batch = [], 0, 1000
    while True:
        q = sb.table(table).select(select_cols).range(offset, offset + batch - 1).order('id')
        for k, v in filters.items():
            q = q.eq(k, v)
        r = q.execute()
        all_data.extend(r.data)
        if len(r.data) < batch:
            break
        offset += batch
    return all_data

# 全選手ID取得（全件）
all_players = fetch_all('dt_player_person', 'id')
player_ids = {p['id'] for p in all_players}
print(f"dt_player_person 総件数: {len(player_ids)}")

# dt_player_relay 全件取得
relay_members_all = fetch_all('dt_player_relay', 'id, player_id, relay_result_id, swim_order')
relay_members = [m for m in relay_members_all if m['player_id'] is not None]
print(f"dt_player_relay 総件数: {len(relay_members)}")

broken = [m for m in relay_members if m['player_id'] not in player_ids]
print(f"参照切れ: {len(broken)}件")

# relay_result_idを使って大会回を引く
broken_relay_ids = list({m['relay_result_id'] for m in broken})
relay_results = sb.table('dt_result_relay')\
    .select('id, mst_event(round)')\
    .in_('id', broken_relay_ids[:200])\
    .execute().data
round_map = {r['id']: r['mst_event']['round'] for r in relay_results}

by_round = {}
for m in broken:
    rnd = round_map.get(m['relay_result_id'], '?')
    by_round.setdefault(rnd, []).append(m)

print("\n大会回別:")
for rnd in sorted(by_round, key=lambda x: int(x) if str(x).isdigit() else 99):
    items = by_round[rnd]
    unique_players = {m['player_id'] for m in items}
    print(f"  第{rnd}回: {len(items)}件 (選手ID種類: {len(unique_players)})")
    for pid in list(unique_players)[:3]:
        print(f"    player_id={pid}")
