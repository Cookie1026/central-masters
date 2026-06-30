"""
成瀬/成城パターンの調査: 同一選手が複数チームに登録されている理由を特定する
"""
import os
import sys
from collections import defaultdict
from supabase import create_client

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

teams   = sb.table("mst_team").select("id, name").execute().data
team_map = {t["id"]: t["name"] for t in teams}
events  = sb.table("mst_event").select("id, round, pool_type").execute().data
event_map = {e["id"]: f"第{e['round']}回({e['pool_type']})" for e in events}

players = sb.table("dt_player_person").select("id, name, gender, team_id").execute().data
name_gender_teams = defaultdict(list)
for p in players:
    key = (p["name"], p["gender"])
    name_gender_teams[key].append(p)

multi = {k: v for k, v in name_gender_teams.items() if len(v) > 1}

# 成瀬/成城パターンの選手を抽出
print("=" * 60)
print("成瀬 ↔ 成城 パターンの選手（各大会の出場履歴）")
print("=" * 60)

target_names = [name for (name, gender), entries in multi.items()
                if any("成瀬" in team_map.get(e["team_id"], "") or "成城" in team_map.get(e["team_id"], "")
                       for e in entries)]

for name in sorted(target_names)[:5]:  # まず5名
    # この選手名に一致するdt_player_personのid一覧
    pids = [p["id"] for p in players if p["name"] == name]
    pid_to_team = {p["id"]: (p["team_id"], team_map.get(p["team_id"], "?")) for p in players if p["name"] == name}
    print(f"\n{name}: player_ids={pids}")
    for pid, (tid, tname) in pid_to_team.items():
        # この player_id で出場した大会を確認
        results = sb.table("dt_result_person").select("id, event_id, player_id").eq("player_id", pid).execute().data
        event_ids = sorted({r["event_id"] for r in results})
        event_labels = [event_map.get(eid, f"event_{eid}") for eid in event_ids]
        print(f"  id={pid} team={tname}: 出場大会={event_labels} ({len(results)}件)")

print()
print("=" * 60)
print("成瀬/成城以外のパターン")
print("=" * 60)
other_multi = {(n, g): entries for (n, g), entries in multi.items()
               if not any("成瀬" in team_map.get(e["team_id"], "") or "成城" in team_map.get(e["team_id"], "")
                          for e in entries)}
for (name, gender), entries in sorted(other_multi.items()):
    team_names = [team_map.get(e["team_id"], "?") for e in entries]
    pids = [e["id"] for e in entries]
    print(f"\n{name}({gender}): {team_names}")
    for entry in entries:
        results = sb.table("dt_result_person").select("id, event_id").eq("player_id", entry["id"]).execute().data
        event_ids = sorted({r["event_id"] for r in results})
        event_labels = [event_map.get(eid, f"event_{eid}") for eid in event_ids]
        print(f"  id={entry['id']} team={team_map.get(entry['team_id'],'?')}: {event_labels}")
