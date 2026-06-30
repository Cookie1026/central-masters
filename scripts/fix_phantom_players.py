"""
幽霊レコード調査・削除スクリプト
- dt_result_person / dt_player_relay に紐付きのない dt_player_person を特定して削除
- 成瀬/成城問題の根本修正
"""
import os
import sys
from supabase import create_client

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DRY_RUN = "--execute" not in sys.argv

teams    = sb.table("mst_team").select("id, name").execute().data
team_map = {t["id"]: t["name"] for t in teams}

# dt_result_person に登場する player_id セット
result_pids = set()
offset = 0
while True:
    chunk = sb.table("dt_result_person").select("player_id").range(offset, offset + 999).execute().data
    if not chunk:
        break
    for r in chunk:
        if r["player_id"] is not None:
            result_pids.add(r["player_id"])
    if len(chunk) < 1000:
        break
    offset += 1000

# dt_player_relay に登場する player_id セット
relay_pids = set()
offset = 0
while True:
    chunk = sb.table("dt_player_relay").select("player_id").range(offset, offset + 999).execute().data
    if not chunk:
        break
    for r in chunk:
        if r["player_id"] is not None:
            relay_pids.add(r["player_id"])
    if len(chunk) < 1000:
        break
    offset += 1000

used_pids = result_pids | relay_pids
print(f"結果に登場するplayer_id: {len(used_pids)}件")

# 全 dt_player_person を取得
all_players = []
offset = 0
while True:
    chunk = sb.table("dt_player_person").select("id, name, gender, team_id").range(offset, offset + 999).execute().data
    if not chunk:
        break
    all_players.extend(chunk)
    if len(chunk) < 1000:
        break
    offset += 1000

print(f"dt_player_person 総件数: {len(all_players)}")

# 結果に紐付かない = 幽霊レコード
phantoms = [p for p in all_players if p["id"] not in used_pids]
print(f"\n幽霊レコード（結果0件）: {len(phantoms)}件")

# チーム別集計
from collections import Counter
team_counts = Counter(team_map.get(p["team_id"], f"team_{p['team_id']}") for p in phantoms)
print("\nチーム別内訳:")
for team, count in team_counts.most_common():
    print(f"  {team}: {count}件")

print("\n幽霊レコード一覧:")
for p in sorted(phantoms, key=lambda x: (team_map.get(x["team_id"], ""), x["name"])):
    print(f"  id={p['id']} {p['name']}({p['gender']}) team={team_map.get(p['team_id'], '?')}")

if DRY_RUN:
    print(f"\n[DRY RUN] --execute を付けると {len(phantoms)}件を削除します")
else:
    phantom_ids = [p["id"] for p in phantoms]
    CHUNK = 50
    deleted = 0
    for i in range(0, len(phantom_ids), CHUNK):
        batch = phantom_ids[i:i+CHUNK]
        sb.table("dt_player_person").delete().in_("id", batch).execute()
        deleted += len(batch)
        print(f"  削除済み: {deleted}/{len(phantom_ids)}")
    print(f"\n削除完了: {deleted}件")
