#!/usr/bin/env python3
"""おおたかチームのリレーメンバーを確認"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import os
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

# おおたかチームIDを取得
teams = sb.table('mst_team').select('id, name').execute().data
ohtaka = [t for t in teams if 'おおたか' in t['name'] or 'Ohtaka' in t['name'].lower()]
print("おおたかチーム候補:", ohtaka)

if not ohtaka:
    print("見つからない")
    exit()

tid = ohtaka[0]['id']

# おおたかのリレー結果を取得
relay_res = sb.table('dt_result_relay')\
    .select('id, rank, time_display, is_meet_record, mst_event(round), mst_category(name), mst_age(name), age_group_label, dt_player_relay(swim_order, split_seconds, player_id, dt_player_person(name, gender))')\
    .eq('team_id', tid)\
    .order('id')\
    .execute()

print(f"\nおおたかリレー件数: {len(relay_res.data)}")

for r in relay_res.data[:20]:
    rnd = r['mst_event']['round'] if r.get('mst_event') else '?'
    cat = r['mst_category']['name'] if r.get('mst_category') else '?'
    age = r['mst_age']['name'] if r.get('mst_age') else r.get('age_group_label', '?')
    members = r.get('dt_player_relay', [])
    null_person = [m for m in members if m.get('dt_player_person') is None]
    null_split = [m for m in members if m.get('split_seconds') is None]

    issues = []
    if null_person: issues.append(f"dt_player_person=null:{[m['player_id'] for m in null_person]}")
    if null_split: issues.append(f"split_seconds=null:{len(null_split)}件")
    if len(members) < 4: issues.append(f"メンバー不足:{len(members)}/4")

    status = "⚠️ " + ", ".join(issues) if issues else "OK"
    print(f"  第{rnd}回 {cat} {age} rank={r['rank']} time={r['time_display']} mr={r['is_meet_record']} | {status}")
