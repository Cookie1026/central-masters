#!/usr/bin/env python3
"""
21件の不完全リレーを OCR/PNG 検証済みの正しい名前で修正する。
repair_incomplete_relays.py が解決できなかった以下の2種類を対応:
  (A) OCR誤読: relay CSV の名前が誤読、DBには正しい名前で登録済み
  (B) 新規登録: リレー専門参加でDBに未登録（dt_player_person も作成）

Usage:
  python scripts/fix_relay_members_verified.py
  python scripts/fix_relay_members_verified.py --apply
"""

import argparse
import csv
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = Path("マスターズPDF")
ROUND_DIRS = {
    74: BASE / "第74回(短水路)" / "backup" / "generated",
    75: BASE / "第75回(長水路)" / "backup" / "generated",
    76: BASE / "第76回(短水路)" / "backup" / "generated",
    77: BASE / "第77回(長水路)" / "backup" / "generated",
    78: BASE / "第78回(長水路)" / "backup" / "generated",
    79: BASE / "第79回(短水路)" / "backup" / "generated",
}

# (relay_id, swim_order) -> (verified_correct_name, gender_or_None)
# OCR/PNG 検証済み (2026-07-03)
# gender=None: 混合リレー専門参加で性別不明
CORRECTIONS = {
    # --- (B) 新規プレイヤー作成が必要 ---
    (6229, 1): ("増淵毅",             "男子"),   # 74回 セ・トレッサ
    (6264, 1): ("石附仲也",           "男子"),   # 74回 セ・新浦安
    (6265, 1): ("井口穰",             "男子"),   # 74回 セ・東戸塚
    (6428, 1): ("島山敏雄",           "男子"),   # 75回 ザバス鶴見 race17 320〜
    (6497, 3): ("古澤弘幸",           "男子"),   # 75回 ザバス鶴見 race17 200〜
    (5704, 2): ("古池奈々",           "女子"),   # 76回 セ・二俣川
    (5743, 4): ("古澤隆",             "男子"),   # 76回 セ・清瀬
    (5749, 1): ("高橋翔",             "男子"),   # 76回 セ・葛西
    (5765, 4): ("田中沙衣",           "女子"),   # 76回 セ・阿佐谷

    # --- (A) OCR 誤読: DB に正しい名前で登録済み ---
    (6454, 2): ("佐藤正章",           None),     # 75回 セ・用賀  佐強→佐藤(藤→強 誤読)
    (6532, 4): ("バーンズノーマンウィ", None),    # 75回 セ・松戸  ！ アーティファクト
    (6529, 1): ("田代眞理子",          None),    # 75回 セ・成城  真/眞 字体違い
    (5750, 1): ("田之上ノブ",          None),    # 76回 セ・蘇我  ()アーティファクト
    (5756, 1): ("藤本豊和",           "男子"),   # 76回 セ・長津田 研究→藤本 誤読
    (6768, 4): ("佐藤玖弥",           "男子"),   # 77回 セ・目黒  佐報→佐藤(藤→報 誤読)
    (6904, 4): ("バーンズノーマンウィ", None),    # 77回 セ・松戸  .アーティファクト
    (5913, 1): ("小澤有未",           "女子"),   # 78回 セ・長津田 末→未 誤字
    (5947, 4): ("兼森伸児",           "男子"),   # 78回 ザバス八景 (repair_scriptで対応可能だが統合)
    (7146, 4): ("渡辺一",             "男子"),   # 79回 セ・市ヶ尾  一→－ 誤読
    (7151, 2): ("楠野美紀",           "女子"),   # 79回 セ・慶應日吉 楠→榑 誤読
    (7151, 3): ("楠野浩一",           "男子"),   # 79回 セ・慶應日吉 楠→榑 誤読
    (7170, 2): ("ニューボールード菜月", "女子"),  # 79回 セ・柏  ポ→ボ・ﾉ→月 誤読
}


def norm(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", "", text)


def norm_team(value):
    text = norm(value)
    for prefix in ("セ・", "CS", "ザバス", "クリーンスパ", "ミズノ"):
        if text.startswith(prefix):
            return text[len(prefix):]
    return text


def norm_event(value):
    return norm(value).replace("(混合)", "").replace("（混合）", "")


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def fetch_all(sb, table, columns):
    rows = []
    offset = 0
    while True:
        res = sb.table(table).select(columns).range(offset, offset + 999).execute()
        rows.extend(res.data)
        if len(res.data) < 1000:
            return rows
        offset += 1000


def nullable_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def nullable_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args_ns = parser.parse_args()

    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    events = fetch_all(sb, "mst_event", "id,round")
    teams = fetch_all(sb, "mst_team", "id,name")
    categories = fetch_all(sb, "mst_category", "id,name,gender")
    players = fetch_all(sb, "dt_player_person", "id,name,gender,team_id")
    relays = fetch_all(
        sb,
        "dt_result_relay",
        "id,event_id,team_id,category_id,age_group_label,rank,time_seconds,race_number,result_status",
    )
    members_existing = fetch_all(sb, "dt_player_relay", "id,relay_result_id,swim_order,player_id")

    round_by_event = {r["id"]: r["round"] for r in events}
    team_by_id = {r["id"]: r["name"] for r in teams}
    team_id_by_norm = {norm(r["name"]): r["id"] for r in teams}
    category_by_id = {r["id"]: r for r in categories}

    # player_index: (norm_name, team_id) -> [player]
    player_index = defaultdict(list)
    for p in players:
        player_index[(norm(p["name"]), p["team_id"])].append(p)

    existing_orders = defaultdict(set)
    for m in members_existing:
        existing_orders[m["relay_result_id"]].add(m["swim_order"])

    relay_by_id = {r["id"]: r for r in relays}
    target_ids = set(relay_id for relay_id, _ in CORRECTIONS)
    target_relays = [r for r in relays if r["id"] in target_ids and r["result_status"] == "FINISHED"]

    source_cache = {}
    errors = []
    plans = []
    new_players = []

    for relay in sorted(target_relays, key=lambda r: r["id"]):
        relay_id = relay["id"]
        round_no = round_by_event[relay["event_id"]]
        team_name = team_by_id[relay["team_id"]]
        category = category_by_id[relay["category_id"]]

        if round_no not in source_cache:
            src_dir = ROUND_DIRS[round_no]
            source_cache[round_no] = (
                read_csv(src_dir / "relay_results.csv"),
                read_csv(src_dir / "relay_members.csv"),
            )
        result_rows, member_rows = source_cache[round_no]

        # Find the CSV relay result row (same 6-criteria as repair script)
        candidates = [
            row for row in result_rows
            if (
                nullable_int(row.get("race_no")) == relay["race_number"]
                and norm_team(row.get("team_name")) == norm_team(team_name)
                and norm(row.get("age_group_label")) == norm(relay["age_group_label"])
                and nullable_int(row.get("rank")) == relay["rank"]
                and norm_event(row.get("event_name")) == norm_event(category["name"])
                and relay["time_seconds"] is not None
                and abs((nullable_float(row.get("time_seconds")) or 0) - float(relay["time_seconds"])) < 0.005
            )
        ]

        if len(candidates) != 1:
            errors.append(f"relay {relay_id}: CSV result matches={len(candidates)}")
            continue

        source_result = candidates[0]
        relay_key = "_".join([
            str(round_no),
            str(source_result["race_no"]),
            str(source_result["age_group_label"]),
            str(source_result["team_name"]),
            str(source_result["rank"]),
        ])

        for (corr_relay_id, corr_order), (correct_name, gender_hint) in CORRECTIONS.items():
            if corr_relay_id != relay_id:
                continue
            if corr_order in existing_orders.get(relay_id, set()):
                print(f"  relay {relay_id} order {corr_order}: 既存 (スキップ)")
                continue

            # Get split/dive from CSV (OCR garbage name row, matched by relay_key + swim_order)
            csv_member_rows = [
                row for row in member_rows
                if row.get("relay_key") == relay_key
                and nullable_int(row.get("swim_order")) == corr_order
            ]
            if len(csv_member_rows) != 1:
                errors.append(
                    f"relay {relay_id} order {corr_order}: CSV member rows={len(csv_member_rows)}"
                )
                continue

            csv_member = csv_member_rows[0]

            # Look up player by CORRECT name
            player_matches = player_index.get((norm(correct_name), relay["team_id"]), [])
            if not player_matches:
                # New player needed
                new_players.append({
                    "relay_id": relay_id,
                    "swim_order": corr_order,
                    "name": correct_name,
                    "team_id": relay["team_id"],
                    "team_name": team_name,
                    "gender": gender_hint,
                    "round": round_no,
                })
                plans.append({
                    "relay_result_id": relay_id,
                    "swim_order": corr_order,
                    "player_name": correct_name,
                    "team_name": team_name,
                    "player_id": None,  # to be filled after create
                    "split_seconds": nullable_float(csv_member.get("split_seconds")),
                    "dive_time": nullable_float(csv_member.get("dive_time")),
                    "round": round_no,
                    "is_new_player": True,
                })
            else:
                plans.append({
                    "relay_result_id": relay_id,
                    "swim_order": corr_order,
                    "player_name": correct_name,
                    "team_name": team_name,
                    "player_id": player_matches[0]["id"],
                    "split_seconds": nullable_float(csv_member.get("split_seconds")),
                    "dive_time": nullable_float(csv_member.get("dive_time")),
                    "round": round_no,
                    "is_new_player": False,
                })

    print(f"対象リレー: {len(target_relays)}件")
    print(f"新規プレイヤー作成: {len(new_players)}件")
    for np in new_players:
        print(f"  第{np['round']}回 relay={np['relay_id']} order={np['swim_order']} "
              f"{np['name']} ({np['team_name']}) gender={np['gender']}")
    print(f"追加候補 dt_player_relay: {len(plans)}件")
    for p in plans:
        status = "[NEW]" if p["is_new_player"] else "[既存]"
        print(f"  {status} 第{p['round']}回 relay={p['relay_result_id']} "
              f"order={p['swim_order']} {p['player_name']} ({p['team_name']})")

    if errors:
        print(f"\n解決不能: {len(errors)}件")
        for e in errors:
            print(f"  {e}")
        raise SystemExit("解決不能件あり — DB未変更")

    if not args_ns.apply:
        print("\nDRY RUN完了。DBは変更していません。")
        return

    # --- APPLY ---
    # Step 1: Create new players
    player_id_map = {}
    for np in new_players:
        payload = {
            "name": np["name"],
            "team_id": np["team_id"],
        }
        if np["gender"]:
            payload["gender"] = np["gender"]
        result = sb.table("dt_player_person").insert(payload).execute()
        new_id = result.data[0]["id"]
        player_id_map[(np["relay_id"], np["swim_order"])] = new_id
        print(f"  プレイヤー作成: {np['name']} ({np['team_name']}) id={new_id}")

    # Step 2: Insert relay members
    payloads = []
    for p in plans:
        pid = p["player_id"]
        if p["is_new_player"]:
            pid = player_id_map[(p["relay_result_id"], p["swim_order"])]
        payloads.append({
            "relay_result_id": p["relay_result_id"],
            "player_id": pid,
            "swim_order": p["swim_order"],
            "split_seconds": p["split_seconds"],
            "dive_time": p["dive_time"],
        })

    sb.table("dt_player_relay").insert(payloads).execute()
    print(f"\n{len(payloads)}件の dt_player_relay を追加しました。")


if __name__ == "__main__":
    main()
