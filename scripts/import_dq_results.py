"""
第80回長水路大会の失格・棄権データをSupabaseに登録する。

前提:
  - migration 027 (disqualification_code, is_withdrawal 列) が適用済みであること
  - event_id=7 が第80回長水路大会であること

処理内容:
  1. event_id=7 の null-rank 個人結果に is_withdrawal=TRUE を一括設定
  2. 5件の失格エントリに disqualification_code を設定し is_withdrawal=FALSE に戻す
  3. event_id=7 の null-rank リレー結果に is_withdrawal=TRUE を一括設定
  4. セ・谷津 リレー失格に disqualification_code='競12' を設定し is_withdrawal=FALSE に戻す

実行:
  python scripts/import_dq_results.py           # dry-run（変更なし）
  python scripts/import_dq_results.py --execute  # 実際に更新
"""

import os
import sys

if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from supabase import create_client

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
sb = create_client(SUPABASE_URL, SUPABASE_KEY)

DRY_RUN = "--execute" not in sys.argv
EVENT_ID = 7  # 第80回長水路

# ============================================================
# 失格コード定義（PDFから確認済み）
# ============================================================
INDIVIDUAL_DQ = [
    {"name": "岡澤志織",   "team": "セ・茂原",   "code": "背5",  "age_hint": "25"},
    {"name": "鈴木加代子", "team": "セ・新三郷", "code": "出2",  "age_hint": "60"},
    {"name": "山崎裕子",   "team": "セ・西新井",  "code": "平14", "age_hint": "55"},
    {"name": "佐藤正章",   "team": "セ・用賀",   "code": "平1",  "age_hint": "55"},
]
RELAY_DQ = {
    "team": "セ・谷津",
    "code": "競12",
}

print(f"{'[DRY RUN] ' if DRY_RUN else ''}第80回失格・棄権データ登録\n")

# ============================================================
# 個人結果: null-rank 全件取得（event_id=7）
# ============================================================
print("── 個人結果 ──")
individual_rows = (
    sb.table("dt_result_person")
    .select("""
        id, lane, disqualification_code, is_withdrawal,
        dt_player_person!inner(name, mst_team!inner(name)),
        mst_category!inner(name),
        mst_age!inner(name)
    """)
    .eq("event_id", EVENT_ID)
    .is_("rank", None)
    .is_("time_seconds", None)
    .execute()
    .data
)
print(f"null-rank 個人結果: {len(individual_rows)}件")

# Step 1: 全件を棄権に設定
withdrawal_ids = [r["id"] for r in individual_rows]
print(f"  → 全{len(withdrawal_ids)}件を is_withdrawal=TRUE に設定")
if not DRY_RUN and withdrawal_ids:
    CHUNK = 100
    for i in range(0, len(withdrawal_ids), CHUNK):
        batch = withdrawal_ids[i : i + CHUNK]
        sb.table("dt_result_person").update({"is_withdrawal": True}).in_("id", batch).execute()
    print("  → 完了")

# Step 2: 失格エントリを特定してコードを設定
dq_found = []
for dq in INDIVIDUAL_DQ:
    matched = []
    for row in individual_rows:
        player = row["dt_player_person"][0] if isinstance(row["dt_player_person"], list) else row["dt_player_person"]
        team   = player["mst_team"][0] if isinstance(player["mst_team"], list) else player["mst_team"]
        age    = row["mst_age"][0] if isinstance(row["mst_age"], list) else row["mst_age"]
        if (
            player["name"] == dq["name"]
            and team["name"] == dq["team"]
            and age["name"].startswith(dq["age_hint"])
        ):
            matched.append(row)

    if len(matched) == 0:
        print(f"  [WARNING] 見つからず: {dq['name']} ({dq['team']}) age~{dq['age_hint']}")
    elif len(matched) > 1:
        print(f"  [WARNING] 複数マッチ: {dq['name']} ({dq['team']}) → {len(matched)}件 — 最初の1件のみ処理")
        matched = matched[:1]

    for row in matched:
        age = row["mst_age"][0] if isinstance(row["mst_age"], list) else row["mst_age"]
        cat = row["mst_category"][0] if isinstance(row["mst_category"], list) else row["mst_category"]
        print(f"  [DQ] id={row['id']} {dq['name']} ({dq['team']}) {cat['name']} {age['name']} → {dq['code']}")
        dq_found.append({"id": row["id"], "code": dq["code"]})
        if not DRY_RUN:
            sb.table("dt_result_person").update({
                "disqualification_code": dq["code"],
                "is_withdrawal": False,
            }).eq("id", row["id"]).execute()

print(f"  失格コード設定: {len(dq_found)}件 / {len(INDIVIDUAL_DQ)}件")

# ============================================================
# リレー結果: null-rank 全件取得（event_id=7）
# ============================================================
print("\n── リレー結果 ──")
relay_rows = (
    sb.table("dt_result_relay")
    .select("""
        id, disqualification_code, is_withdrawal,
        mst_team!inner(name),
        mst_category!inner(name, gender),
        mst_age(name)
    """)
    .eq("event_id", EVENT_ID)
    .is_("rank", None)
    .is_("time_seconds", None)
    .execute()
    .data
)
print(f"null-rank リレー結果: {len(relay_rows)}件")

# Step 3: 全件を棄権に設定
relay_withdrawal_ids = [r["id"] for r in relay_rows]
print(f"  → 全{len(relay_withdrawal_ids)}件を is_withdrawal=TRUE に設定")
if not DRY_RUN and relay_withdrawal_ids:
    CHUNK = 100
    for i in range(0, len(relay_withdrawal_ids), CHUNK):
        batch = relay_withdrawal_ids[i : i + CHUNK]
        sb.table("dt_result_relay").update({"is_withdrawal": True}).in_("id", batch).execute()
    print("  → 完了")

# Step 4: セ・谷津 リレー失格を特定（既存行 or 新規INSERT）
relay_dq_found = []
for row in relay_rows:
    team = row["mst_team"][0] if isinstance(row["mst_team"], list) else row["mst_team"]
    if team["name"] == RELAY_DQ["team"]:
        cat = row["mst_category"][0] if isinstance(row["mst_category"], list) else row["mst_category"]
        age = row.get("mst_age")
        age_name = ""
        if age:
            age_name = (age[0] if isinstance(age, list) else age)["name"]
        print(f"  [DQ] id={row['id']} {team['name']} {cat['name']} {age_name} → {RELAY_DQ['code']}")
        relay_dq_found.append(row["id"])
        if not DRY_RUN:
            sb.table("dt_result_relay").update({
                "disqualification_code": RELAY_DQ["code"],
                "is_withdrawal": False,
            }).eq("id", row["id"]).execute()

if not relay_dq_found:
    # dt_result_relay にエントリがない → 新規INSERT
    # セ・谷津 team_id=20, 混合4×50mフリーリレー category_id=31, 240～279歳 age_id=48
    new_relay_row = {
        "event_id":      7,
        "team_id":       20,   # セ・谷津
        "category_id":   31,   # 4×50mフリーリレー（混合）
        "age_id":        48,   # 240～279歳
        "age_group_label": "240～279歳",
        "combined_age":  None,
        "rank":          None,
        "time_seconds":  None,
        "time_display":  None,
        "team_points":   None,
        "is_meet_record": False,
        "race_number":   24,
        "disqualification_code": RELAY_DQ["code"],
        "is_withdrawal": False,
    }
    print(f"  [DQ INSERT] event_id={new_relay_row['event_id']} team_id={new_relay_row['team_id']}"
          f" cat_id={new_relay_row['category_id']} age={new_relay_row['age_group_label']}"
          f" race_no={new_relay_row['race_number']} → {RELAY_DQ['code']}")
    relay_dq_found.append("new")
    if not DRY_RUN:
        result = sb.table("dt_result_relay").insert(new_relay_row).execute()
        print(f"  → 挿入完了: id={result.data[0]['id']}")

print(f"  リレー失格コード設定: {len(relay_dq_found)}件")

# ============================================================
# 結果サマリ
# ============================================================
print(f"""
{'=' * 50}
{'[DRY RUN] ' if DRY_RUN else ''}処理結果サマリ
  個人 棄権: {len(withdrawal_ids)}件
  個人 失格: {len(dq_found)}件 (コード設定)
  リレー 棄権: {len(relay_withdrawal_ids)}件
  リレー 失格: {len(relay_dq_found)}件 (コード設定)
{'--execute を付けると実際に更新します' if DRY_RUN else '更新完了'}
""")
