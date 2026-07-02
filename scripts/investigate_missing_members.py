#!/usr/bin/env python3
"""
21件の不完全リレーを特定し、元CSV の選手名と大会・レース情報を出力する。
PNG照合のための情報収集スクリプト。DB は読み取りのみ。
"""

import csv
import os
import sys
import unicodedata
import re
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
    80: BASE / "第80回(長水路)" / "backup" / "generated",
}
PNG_DIRS = {
    74: BASE / "第74回(短水路)" / "backup" / "第74回png変換",
    75: BASE / "第75回(長水路)" / "backup" / "第75回png変換",
    76: BASE / "第76回(短水路)" / "backup" / "第76回png変換",
    77: BASE / "第77回(長水路)" / "backup" / "第77回png変換",
    78: BASE / "第78回(長水路)" / "backup" / "第78回png変換",
    79: BASE / "第79回(短水路)" / "backup" / "第79回png変換",
    80: BASE / "第80回(長水路)" / "backup" / "第80回png変換",
}


def norm(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", "", text)


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


def main():
    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    events     = fetch_all(sb, "mst_event",      "id,round")
    teams      = fetch_all(sb, "mst_team",        "id,name")
    categories = fetch_all(sb, "mst_category",   "id,name,gender")
    players    = fetch_all(sb, "dt_player_person","id,name,team_id")
    relays     = fetch_all(sb, "dt_result_relay",
                           "id,event_id,team_id,category_id,age_group_label,"
                           "rank,time_display,race_number,result_status")
    members    = fetch_all(sb, "dt_player_relay", "id,relay_result_id,swim_order,player_id")

    round_by_event   = {r["id"]: r["round"]   for r in events}
    team_by_id       = {r["id"]: r["name"]    for r in teams}
    category_by_id   = {r["id"]: r           for r in categories}
    player_name_by_id = {r["id"]: r["name"]   for r in players}

    member_orders = defaultdict(set)
    member_map    = defaultdict(dict)   # relay_id -> {order: player_name}
    for m in members:
        member_orders[m["relay_result_id"]].add(m["swim_order"])
        member_map[m["relay_result_id"]][m["swim_order"]] = player_name_by_id.get(m["player_id"], "?")

    targets = [
        r for r in relays
        if r["result_status"] == "FINISHED"
        and member_orders[r["id"]] != {1, 2, 3, 4}
    ]

    # Group by round
    by_round = defaultdict(list)
    for relay in targets:
        rnd = round_by_event.get(relay["event_id"], 0)
        by_round[rnd].append(relay)

    source_cache = {}
    print("=" * 80)
    print("不完全リレー 21件 — 元CSVとPNG照合用リスト")
    print("=" * 80)

    for rnd in sorted(by_round):
        relays_in_round = sorted(by_round[rnd], key=lambda r: r["race_number"] or 0)
        src_dir = ROUND_DIRS[rnd]
        png_dir = PNG_DIRS[rnd]

        if rnd not in source_cache:
            source_cache[rnd] = (
                read_csv(src_dir / "relay_results.csv"),
                read_csv(src_dir / "relay_members.csv"),
            )
        result_rows, member_rows = source_cache[rnd]

        png_files = sorted(png_dir.glob("*.png")) if png_dir.exists() else []
        print(f"\n【第{rnd}回】  PNG: {len(png_files)}枚  ({png_dir})")
        print("-" * 70)

        for relay in relays_in_round:
            team     = team_by_id.get(relay["team_id"], "?")
            cat      = category_by_id.get(relay["category_id"], {})
            cat_name = cat.get("name", "?")
            race_no  = relay["race_number"]
            missing  = sorted({1, 2, 3, 4} - member_orders[relay["id"]])

            # CSVから対応する行を探す
            csv_result = [
                row for row in result_rows
                if str(row.get("race_no", "")).strip() == str(race_no or "")
                and norm(row.get("team_name", "")) == norm(team)
            ]

            # リレーキー → メンバーCSVを引く
            csv_members_by_order = {}
            for res in csv_result:
                relay_key = "_".join([
                    str(rnd),
                    str(res.get("race_no", "")),
                    str(res.get("age_group_label", "")),
                    str(res.get("team_name", "")),
                    str(res.get("rank", "")),
                ])
                for m in member_rows:
                    if m.get("relay_key") == relay_key:
                        order = int(m.get("swim_order", 0))
                        csv_members_by_order[order] = m.get("athlete_name", "?")

            print(f"  relay_id={relay['id']}  race_no={race_no}  "
                  f"チーム={team}  種目={cat_name}  年齢区分={relay['age_group_label']}  "
                  f"順位={relay['rank']}  タイム={relay['time_display']}")

            # 既存メンバー
            existing = member_map[relay["id"]]
            all_orders = {1, 2, 3, 4}
            for order in sorted(all_orders):
                if order in missing:
                    csv_name = csv_members_by_order.get(order, "（CSV未発見）")
                    print(f"    泳順{order}: ❌ 欠損  CSV名={csv_name}")
                else:
                    print(f"    泳順{order}: ✅ {existing.get(order, '?')}")

    print(f"\n合計: {len(targets)}件")


if __name__ == "__main__":
    main()
