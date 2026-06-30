"""
データ品質チェックスクリプト。
4つの懸念点を一括調査する:
1. dt_player_person の同一選手名・複数チーム
2. mst_record_tournament_long / short のパース精度
3. dt_result_person / dt_result_relay の異常値（OCR誤読候補）
4. mst_team の表記ゆれ候補
"""
import os
import re
import sys
import unicodedata
from collections import defaultdict
from supabase import create_client

# Windows コンソールの文字化け対策
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
SEP = "=" * 60

# -------------------------------------------------------
# 1. dt_player_person 同一選手名・複数チーム
# -------------------------------------------------------
print(f"\n{SEP}")
print("【1】dt_player_person: 同一選手名で複数チームに所属")
print(SEP)

players = sb.table("dt_player_person").select("id, name, gender, team_id").execute().data
teams   = sb.table("mst_team").select("id, name").execute().data
team_map = {t["id"]: t["name"] for t in teams}

# (name, gender) の組み合わせで重複チェック
name_gender_teams = defaultdict(list)
for p in players:
    key = (p["name"], p["gender"])
    name_gender_teams[key].append((p["id"], p["team_id"], team_map.get(p["team_id"], "?")))

multi = {k: v for k, v in name_gender_teams.items() if len(v) > 1}
print(f"  該当 (名前+性別) の組み合わせ: {len(multi)}件")
for (name, gender), entries in sorted(multi.items()):
    team_names = [e[2] for e in entries]
    print(f"  {name}({gender}): {team_names}")

# -------------------------------------------------------
# 2. mst_record_tournament_long / short のパース精度
# -------------------------------------------------------
print(f"\n{SEP}")
print("【2】mst_record_tournament_long / short: パース精度チェック")
print(SEP)

for table in ["mst_record_tournament_long", "mst_record_tournament_short"]:
    rows = sb.table(table).select("*").execute().data
    total = len(rows)
    indiv = [r for r in rows if not r["is_relay"]]
    relay = [r for r in rows if r["is_relay"]]

    indiv_no_team       = [r for r in indiv if not (r.get("team_name") or "").strip()]
    indiv_space_in_name = [r for r in indiv if " " in (r.get("name_team_raw") or "")]
    relay_no_dot        = [r for r in relay if "・" not in (r.get("name_team_raw") or "")]
    relay_no_team       = [r for r in relay if not (r.get("team_name") or "").strip()]

    print(f"\n  [{table}] 総件数:{total} (個人:{len(indiv)} リレー:{len(relay)})")
    print(f"  個人 / team_name が空: {len(indiv_no_team)}件")
    for r in indiv_no_team[:5]:
        print(f"    {r['event']} {r['distance']} age={r['age_group']} name={r['name_team_raw']!r}")
    print(f"  個人 / name_team_raw にスペースあり: {len(indiv_space_in_name)}件")
    for r in indiv_space_in_name[:5]:
        print(f"    {r['event']} {r['distance']} age={r['age_group']} name={r['name_team_raw']!r} team={r['team_name']!r}")
    print(f"  リレー / name_team_raw に「・」なし: {len(relay_no_dot)}件")
    for r in relay_no_dot[:10]:
        print(f"    {r['event']} {r['distance']} age={r['age_group']} name={r['name_team_raw']!r} team={r['team_name']!r}")
    print(f"  リレー / team_name が空: {len(relay_no_team)}件")
    for r in relay_no_team[:5]:
        print(f"    {r['event']} {r['distance']} age={r['age_group']} name={r['name_team_raw']!r}")

# -------------------------------------------------------
# 3. dt_result_person / dt_result_relay の異常値
# -------------------------------------------------------
print(f"\n{SEP}")
print("【3】dt_result_person / dt_result_relay: 異常値チェック")
print(SEP)

# dt_result_person: player_id が NULL のもの
persons = sb.table("dt_result_person").select("id, player_id, time_display, event_id").execute().data
p_no_player = [r for r in persons if r.get("player_id") is None]
# time_display に数字・コロン・ピリオド・ハイフン以外が含まれるもの（DNS/DNF/DQ等は除く）
p_bad_time = [r for r in persons
              if r.get("time_display")
              and not re.fullmatch(r"[\d:.\-]+|DNS|DNF|DQ|DSQ|失格|棄権", str(r["time_display"]).strip())]

print(f"\n  [dt_result_person] 総件数: {len(persons)}")
print(f"  player_id が NULL: {len(p_no_player)}件")
for r in p_no_player[:5]:
    print(f"    id={r['id']} event_id={r['event_id']} time={r['time_display']!r}")
print(f"  time_display に異常文字: {len(p_bad_time)}件")
for r in p_bad_time[:10]:
    print(f"    id={r['id']} time={r['time_display']!r}")

# dt_result_relay: team_id が NULL のもの（team_id カラムがある想定）
relays = sb.table("dt_result_relay").select("id, team_id, time_display, event_id").execute().data
rl_no_team = [r for r in relays if r.get("team_id") is None]
rl_bad_time = [r for r in relays
               if r.get("time_display")
               and not re.fullmatch(r"[\d:.\-]+|DNS|DNF|DQ|DSQ|失格|棄権", str(r["time_display"]).strip())]

print(f"\n  [dt_result_relay] 総件数: {len(relays)}")
print(f"  team_id が NULL: {len(rl_no_team)}件")
print(f"  time_display に異常文字: {len(rl_bad_time)}件")
for r in rl_bad_time[:10]:
    print(f"    id={r['id']} time={r['time_display']!r}")

# dt_player_person: name に疑わしい文字（OCR誤読候補）
suspect_chars = re.compile(r"[丁ｰ—－｜]")  # 「了→丁」「長音記号ゆれ」など
p_suspect = [p for p in players if suspect_chars.search(p["name"])]
print(f"\n  [dt_player_person] 名前に疑わしい文字を含む選手: {len(p_suspect)}件")
for p in p_suspect[:20]:
    print(f"    id={p['id']} name={p['name']!r} gender={p['gender']} team={team_map.get(p['team_id'],'?')!r}")

# -------------------------------------------------------
# 4. mst_team の表記ゆれ候補
# -------------------------------------------------------
print(f"\n{SEP}")
print("【4】mst_team: 表記ゆれ候補")
print(SEP)

def normalize_team(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("ヶ", "ケ").replace("ヵ", "カ")
    s = re.sub(r"[ー—－ｰ]", "ー", s)
    return s.strip()

norm_map = defaultdict(list)
for t in sorted(teams, key=lambda x: x["id"]):
    key = normalize_team(t["name"])
    norm_map[key].append((t["id"], t["name"]))

dup_norm = {k: v for k, v in norm_map.items() if len(v) > 1}
print(f"  正規化後に一致するチーム名: {len(dup_norm)}グループ")
for key, entries in sorted(dup_norm.items()):
    print(f"  {key!r}: {entries}")

# 疑わしい文字を含むチーム名
sus_chars = re.compile(r"[—－ｰ﨑]")
sus_teams = [t for t in teams if sus_chars.search(t["name"])]
print(f"\n  疑わしい文字を含むチーム名: {len(sus_teams)}件")
for t in sus_teams:
    print(f"  id={t['id']} name={t['name']!r}")

print(f"\n{SEP}")
print("チェック完了")
print(SEP)
