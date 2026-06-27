#!/usr/bin/env python3
import os, sys, json
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

cats = sb.table('mst_category').select('id, name, gender, pool_type').like('name', '%×%').execute().data
for c in cats[:10]:
    print(json.dumps(c, ensure_ascii=False))

# 第75回で部分欠損している最初のリレー結果を詳細表示
print("\n--- 第75回 ザバス鶴見 混合メドレー ---")
r = sb.table('dt_result_relay')\
    .select('id, rank, age_group_label, mst_event(round), mst_category(id, name, gender, pool_type), mst_team(name)')\
    .eq('id', 3324).execute()
for row in r.data:
    print(json.dumps(row, ensure_ascii=False))
