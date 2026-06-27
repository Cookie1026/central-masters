#!/usr/bin/env python3
"""インポートで作成された不正チームとそのデータを削除"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
import os
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# 不正チームを検索（空名 or 颯介含む）
teams = sb.table('mst_team').select('id, name').execute().data
bad_teams = [t for t in teams if not t['name'].strip() or '颯介' in t['name']]
if not bad_teams:
    print("不正チームなし")
    exit(0)

for t in bad_teams:
    print(f"不正チーム: id={t['id']} name={repr(t['name'])}")

# 各不正チームのプレイヤーと成績を削除
for t in bad_teams:
    tid = t['id']
    # まず選手を取得
    players = sb.table('dt_player_person').select('id, name').eq('team_id', tid).execute().data
    player_ids = [p['id'] for p in players]
    print(f"  選手数: {len(player_ids)}: {[p['name'] for p in players]}")

    if player_ids:
        # 個人成績削除
        for pid in player_ids:
            sb.table('dt_result_person').delete().eq('player_id', pid).execute()
        # 選手削除
        for pid in player_ids:
            sb.table('dt_player_person').delete().eq('id', pid).execute()

    # チーム成績削除
    relay_ids = sb.table('dt_result_relay').select('id').eq('team_id', tid).execute().data
    if relay_ids:
        print(f"  チームリレー: {len(relay_ids)}件")
        for r in relay_ids:
            sb.table('dt_player_relay').delete().eq('relay_result_id', r['id']).execute()
            sb.table('dt_result_relay').delete().eq('id', r['id']).execute()

    # チーム削除
    sb.table('mst_team').delete().eq('id', tid).execute()
    print(f"  チーム削除完了: {repr(t['name'])}")

print("クリーンアップ完了")
