#!/usr/bin/env python3
"""mst_ageの重複チェック（チルダ違いによる重複）"""
import sys, unicodedata
sys.stdout.reconfigure(encoding='utf-8')
import os
from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

ages = sb.table('mst_age').select('id, name, min_age, max_age').execute().data
print(f"mst_age 総件数: {len(ages)}")

# NFKC正規化して重複を探す
def norm(s): return unicodedata.normalize('NFKC', s) if s else ''

by_norm = {}
for a in ages:
    n = norm(a['name'])
    by_norm.setdefault(n, []).append(a)

duplicates = {n: items for n, items in by_norm.items() if len(items) > 1}
if not duplicates:
    print("重複なし")
else:
    print(f"\n重複あり: {len(duplicates)}種類")
    for n, items in sorted(duplicates.items()):
        print(f"  norm='{n}':")
        for i in items:
            print(f"    id={i['id']} name={repr(i['name'])} min={i['min_age']} max={i['max_age']}")
