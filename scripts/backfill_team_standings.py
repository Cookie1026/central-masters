"""第74〜79回の総合成績CSVを dt_ranking_team に補完する。

既定はドライラン。実際に更新する場合は --apply を付ける。
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from import_to_supabase import SupabaseImporter, get_client, norm_name  # noqa: E402


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def source_for_round(round_no: int) -> Path:
    event_dir = next((ROOT / "マスターズPDF").glob(f"第{round_no}回(*)"))
    backup_candidates = sorted((event_dir / "backup").glob(f"2-第{round_no}回M*総合成績.csv"))
    if backup_candidates:
        return backup_candidates[0]
    return event_dir / f"第{round_no}回M総合成績.csv"


def parse_rank(value: str) -> int | None:
    match = re.search(r"\d+", value or "")
    return int(match.group()) if match else None


def parse_points(value: str) -> float | None:
    try:
        return float((value or "").replace("点", "").strip())
    except ValueError:
        return None


def resolve_team_id(row: dict[str, str], importer: SupabaseImporter) -> int | None:
    raw_name = row.get("チーム名", "").strip()
    canonical = importer._normalize_central_team(raw_name)
    team_id = importer._get_team_id(canonical)
    if team_id is not None:
        return team_id

    short_name = {
        "長津田みなみ台": "長津田",
        "おおたかの森": "おおたか",
        "袖ヶ浦駅前": "袖ヶ浦",
        "さいたま新都心": "新都心",
        "フッサ": "福生",
        "越谷レイクタウン": "越谷ＬＴ",
        "湘南LT": "湘南ＬＴ",
        "曽谷": "曽谷・セ",
    }.get(raw_name, raw_name)
    kana = unicodedata.normalize("NFKC", row.get("フリガナ", "")).replace(" ", "")

    candidates: list[str] = []
    if "クリーンスパ" in kana:
        candidates.append("クリーンスパ")
    if "ザバススポーツクラブ" in kana:
        candidates.append(f"ザバス{short_name}")
    if "セントラルフィットネスクラブ" in kana:
        candidates.extend([f"セ・F{short_name}", f"Ｆ{short_name}"])
    if "セントラルスポーツクラブ" in kana:
        candidates.extend([f"セ・S{short_name}", f"Ｓ{short_name}"])
    if "セントラルスイムクラブ" in kana:
        candidates.extend([f"セ・S{short_name}", f"Ｓ{short_name}"])
    candidates.extend([f"セ・{short_name}", short_name])

    for candidate in candidates:
        team_id = importer._get_team_id(candidate)
        if team_id is not None:
            return team_id
    return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Supabaseへupsertする")
    args = parser.parse_args()

    client = get_client()
    importer = SupabaseImporter(client, ROOT, "")

    teams = client.table("mst_team").select("id, name").execute().data
    for team in teams:
        importer.team_ids[team["name"]] = team["id"]
        importer.team_ids[norm_name(team["name"])] = team["id"]
    importer._load_team_aliases()

    events = client.table("mst_event").select("id, round").execute().data
    event_ids = {int(event["round"]): int(event["id"]) for event in events}

    total_resolved = 0
    total_unresolved = 0
    for round_no in range(74, 80):
        source = source_for_round(round_no)
        resolved: list[dict[str, int | float | None]] = []
        unresolved: list[str] = []

        for row in read_rows(source):
            rank = parse_rank(row.get("順位", ""))
            team_id = resolve_team_id(row, importer)
            if rank is None or team_id is None:
                unresolved.append(row.get("チーム名", ""))
                continue

            resolved.append(
                {
                    "event_id": event_ids[round_no],
                    "team_id": team_id,
                    "rank": rank,
                    "total_points": parse_points(row.get("得点", "")),
                    "male_points": parse_points(row.get("男子", "")),
                    "female_points": parse_points(row.get("女子", "")),
                    "mixed_points": parse_points(row.get("混合", "")),
                }
            )

        print(
            f"第{round_no}回: {len(resolved)}件解決 / "
            f"{len(unresolved)}件未解決 ({source.relative_to(ROOT)})"
        )
        if unresolved:
            print("  未解決: " + ", ".join(unresolved))
        if args.apply and resolved:
            client.table("dt_ranking_team").upsert(
                resolved,
                on_conflict="event_id,team_id",
            ).execute()

        total_resolved += len(resolved)
        total_unresolved += len(unresolved)

    mode = "更新完了" if args.apply else "ドライラン完了"
    print(f"{mode}: 解決 {total_resolved}件 / 未解決 {total_unresolved}件")


if __name__ == "__main__":
    main()
