#!/usr/bin/env python3
"""Repair only incomplete FINISHED relay member sets from reviewed generated CSVs.

Default is read-only. The script aborts unless every target relay, source member,
team, and existing player resolves uniquely.

Usage:
  python scripts/repair_incomplete_relays.py
  python scripts/repair_incomplete_relays.py --apply
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
    80: BASE / "第80回(長水路)" / "backup" / "generated",
}


def norm(value):
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", "", text).replace("〜", "～")


def norm_team(value):
    text = norm(value)
    for prefix in ("セ・", "CS", "ザバス", "クリーンスパ", "ミズノ"):
        if text.startswith(prefix):
            return text[len(prefix):]
    return text


def norm_event(value):
    return norm(value).replace("(混合)", "").replace("（混合）", "")


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def fetch_all(sb, table, columns):
    rows = []
    offset = 0
    while True:
        response = sb.table(table).select(columns).range(offset, offset + 999).execute()
        rows.extend(response.data)
        if len(response.data) < 1000:
            return rows
        offset += 1000


def nullable_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def nullable_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

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
        "id,event_id,team_id,category_id,age_group_label,rank,time_seconds,"
        "race_number,result_status",
    )
    members = fetch_all(
        sb,
        "dt_player_relay",
        "id,relay_result_id,player_id,swim_order",
    )

    round_by_event = {row["id"]: row["round"] for row in events}
    team_by_id = {row["id"]: row["name"] for row in teams}
    category_by_id = {row["id"]: row for row in categories}

    player_index = defaultdict(list)
    for player in players:
        player_index[(norm(player["name"]), player["team_id"])].append(player)

    member_orders = defaultdict(set)
    for member in members:
        member_orders[member["relay_result_id"]].add(member["swim_order"])

    targets = [
        relay for relay in relays
        if relay["result_status"] == "FINISHED"
        and member_orders[relay["id"]] != {1, 2, 3, 4}
    ]

    source_cache = {}
    plans = []
    errors = []

    for relay in sorted(targets, key=lambda row: (round_by_event[row["event_id"]], row["id"])):
        round_no = round_by_event[relay["event_id"]]
        source_dir = ROUND_DIRS[round_no]
        if round_no not in source_cache:
            result_rows = read_csv(source_dir / "relay_results.csv")
            member_rows = read_csv(source_dir / "relay_members.csv")
            source_cache[round_no] = (result_rows, member_rows)
        result_rows, member_rows = source_cache[round_no]

        team_name = team_by_id[relay["team_id"]]
        category = category_by_id[relay["category_id"]]
        candidates = []
        for row in result_rows:
            row_time = nullable_float(row.get("time_seconds"))
            same_time = (
                row_time is not None
                and relay["time_seconds"] is not None
                and abs(row_time - float(relay["time_seconds"])) < 0.005
            )
            if (
                nullable_int(row.get("race_no")) == relay["race_number"]
                and norm_team(row.get("team_name")) == norm_team(team_name)
                and norm(row.get("age_group_label")) == norm(relay["age_group_label"])
                and nullable_int(row.get("rank")) == relay["rank"]
                and norm_event(row.get("event_name")) == norm_event(category["name"])
                and same_time
            ):
                candidates.append(row)

        if len(candidates) != 1:
            errors.append(
                f"relay {relay['id']} round {round_no}: source result matches={len(candidates)}"
            )
            continue

        source_result = candidates[0]
        relay_key = "_".join([
            str(round_no),
            str(source_result["race_no"]),
            str(source_result["age_group_label"]),
            str(source_result["team_name"]),
            str(source_result["rank"]),
        ])

        for order in sorted({1, 2, 3, 4} - member_orders[relay["id"]]):
            source_members = [
                row for row in member_rows
                if row.get("relay_key") == relay_key
                and nullable_int(row.get("swim_order")) == order
            ]
            names = {norm(row.get("athlete_name")) for row in source_members if norm(row.get("athlete_name"))}
            if len(names) != 1:
                errors.append(
                    f"relay {relay['id']} order {order}: source member names={sorted(names)}"
                )
                continue

            source_member = next(row for row in source_members if norm(row.get("athlete_name")) in names)
            player_matches = player_index[(next(iter(names)), relay["team_id"])]
            if category["gender"] in ("男子", "女子"):
                player_matches = [
                    player for player in player_matches
                    if player["gender"] == category["gender"]
                ]
            if len(player_matches) != 1:
                errors.append(
                    f"relay {relay['id']} order {order} {source_member['athlete_name']}: "
                    f"existing player matches={len(player_matches)}"
                )
                continue

            plans.append({
                "round": round_no,
                "relay_result_id": relay["id"],
                "player_id": player_matches[0]["id"],
                "swim_order": order,
                "split_seconds": nullable_float(source_member.get("split_seconds")),
                "dive_time": nullable_float(source_member.get("dive_time")),
                "athlete_name": source_member["athlete_name"],
                "team_name": team_name,
            })

    print(f"対象リレー: {len(targets)}件")
    print(f"追加候補: {len(plans)}件")
    for plan in plans:
        print(
            f"  第{plan['round']}回 relay={plan['relay_result_id']} "
            f"order={plan['swim_order']} {plan['athlete_name']} ({plan['team_name']})"
        )

    if errors:
        print(f"\n解決不能: {len(errors)}件")
        for error in errors:
            print(f"  {error}")
        raise SystemExit("全件が一意に解決できないためDB更新を中止しました")

    expected_missing_members = sum(4 - len(member_orders[relay["id"]]) for relay in targets)
    if len(plans) != expected_missing_members:
        raise SystemExit(
            f"追加候補数が不足しています: expected={expected_missing_members} actual={len(plans)}"
        )

    if not args.apply:
        print("\nDRY RUN完了。DBは変更していません。")
        return

    payloads = [
        {
            "relay_result_id": plan["relay_result_id"],
            "player_id": plan["player_id"],
            "swim_order": plan["swim_order"],
            "split_seconds": plan["split_seconds"],
            "dive_time": plan["dive_time"],
        }
        for plan in plans
    ]
    sb.table("dt_player_relay").insert(payloads).execute()
    print(f"\n{len(payloads)}件を追加しました。")


if __name__ == "__main__":
    main()
