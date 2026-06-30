"""
共同記録（"/"区切り）の調査・修正
志手直子/西井良子 前橋/東青梅 → 2行に分割
"""
import os, sys
from supabase import create_client

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DRY_RUN = "--execute" not in sys.argv

print("=== '/' を含むレコード（共同記録候補）===")
for table in ["mst_record_tournament_short", "mst_record_tournament_long"]:
    rows = sb.table(table).select("*").execute().data
    bad = [r for r in rows if "/" in (r.get("name_team_raw") or "")]
    print(f"\n[{table}] 件数: {len(bad)}")
    for r in bad:
        print(f"  id={r['id']} {r['gender']} {r['event']} {r['distance']} age={r['age_group']}")
        print(f"    name_team_raw={r['name_team_raw']!r}")
        print(f"    team_name={r['team_name']!r}  record={r['record']!r}  date={r['established_date']!r}")

if DRY_RUN:
    print("\n[DRY RUN] 修正内容（--execute で実行）:")

# 修正: id=2183 を削除して2行に挿入
# (course, gender, event, distance, age_group) にユニーク制約あり → 1行で2人分を表現
UPDATE_ROW = {
    "name_team_raw": "志手直子・西井良子",
    "athlete_name": "志手直子・西井良子",
    "team_name": "前橋・東青梅",
    "record": "2:25.23",
    "established_date": "2012-03-10",  # 先に記録した方の日付
}

print(f"\n修正: id=2183 を上書き（共同記録 → '・'区切りで1行）")
print(f"  → {UPDATE_ROW['athlete_name']} ({UPDATE_ROW['team_name']}) {UPDATE_ROW['record']}")

if not DRY_RUN:
    sb.table("mst_record_tournament_short").update(UPDATE_ROW).eq("id", 2183).execute()
    print("\n修正完了")
