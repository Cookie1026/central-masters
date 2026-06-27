#!/usr/bin/env python3
"""各大会CSVの飛込タイム有無とDBの欠損を比較チェック"""
import csv, os, sys, unicodedata
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
load_dotenv('.env.local')
from supabase import create_client

sb = create_client(os.getenv('NEXT_PUBLIC_SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

def parse_time(s):
    if not s or not s.strip(): return None
    s = s.strip()
    if s in ('DNS','DQ','NC','記録なし','-',''): return None
    try:
        return float(s.split(':')[0])*60+float(s.split(':')[1]) if ':' in s else float(s)
    except: return None

rounds = [74, 75, 76, 77, 78, 79, 80]

print(f"{'大会':6} | {'CSV飛込あり':>10} | {'DB飛込null':>10} | {'CSVにあるがDBにない':>16}")
print('-' * 60)

for r in rounds:
    csv_path = f'data/第{r}回競技結果（個人）.csv'
    if not os.path.exists(csv_path):
        print(f"第{r}回  | CSVなし")
        continue

    with open(csv_path, encoding='utf-8-sig') as f:
        rows = [row for row in csv.DictReader(f) if row.get('タイプ','').strip() == '個人']

    csv_with_dive = sum(1 for row in rows if parse_time(row.get('飛込タイム','')) is not None)

    # DBの該当大会の飛込タイムnull件数
    res = sb.table('dt_result_person').select('id, dive_time, mst_event!inner(round)').eq('mst_event.round', r).is_('dive_time', 'null').execute()
    db_null = len(res.data)

    # DBの総件数
    res2 = sb.table('dt_result_person').select('id', count='exact').eq('event_id',
        sb.table('mst_event').select('id').eq('round', r).execute().data[0]['id']
    ).execute()
    db_total = res2.count

    print(f"第{r}回  | {csv_with_dive:>10} | {db_null:>10}/{db_total} | {'要確認' if csv_with_dive > 0 and db_null > 0 else 'OK'}")
