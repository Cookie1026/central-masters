#!/usr/bin/env python3
"""
Generate same-team player duplicate/alias candidates for each meet folder.

This script does not correct source CSVs. It only writes review files:
  マスターズPDF/第xx回(...)/player_duplicate_candidates.csv

Inputs are read from each meet folder, especially:
  backup/generated/individual_results.csv
  backup/generated/relay_results.csv
  backup/generated/relay_members.csv
  第xx回M選手一覧.csv, when present
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


HEADERS = [
    "round",
    "pool_type",
    "team_key",
    "team_names",
    "gender",
    "name_a",
    "name_b",
    "normalized_a",
    "normalized_b",
    "score",
    "reason",
    "age_groups_a",
    "age_groups_b",
    "sources_a",
    "sources_b",
    "evidence_a",
    "evidence_b",
    "review_status",
    "review_note",
]


VARIANT_TRANSLATION = str.maketrans(
    {
        "髙": "高",
        "﨑": "崎",
        "嵜": "崎",
        "㟢": "崎",
        "濵": "浜",
        "邉": "辺",
        "邊": "辺",
        "齋": "斎",
        "齊": "斎",
        "斉": "斎",
        "澤": "沢",
        "國": "国",
        "廣": "広",
        "惠": "恵",
        "兒": "児",
        "亞": "亜",
        "眞": "真",
        "榮": "栄",
        "德": "徳",
        "塚": "塚",
        "冨": "富",
        "神": "神",
        "𠮷": "吉",
        "凜": "凛",
        "桒": "桑",
    }
)


OCR_CONFUSABLE_TRANSLATION = str.maketrans(
    {
        "髙": "高",
        "﨑": "崎",
        "嵜": "崎",
        "㟢": "崎",
        "邉": "辺",
        "邊": "辺",
        "齋": "斎",
        "齊": "斎",
        "斉": "斎",
        "兒": "児",
        "凜": "凛",
        # Keep these only for candidate scoring, never automatic correction.
        "亮": "克",
    }
)


@dataclass
class NameEvidence:
    name: str
    team_names: set[str] = field(default_factory=set)
    genders: set[str] = field(default_factory=set)
    age_groups: set[str] = field(default_factory=set)
    sources: set[str] = field(default_factory=set)
    evidence: list[str] = field(default_factory=list)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=HEADERS)
        writer.writeheader()
        writer.writerows(rows)


def find_pdf_root(base: Path) -> Path:
    exact = base / "マスターズPDF"
    if exact.exists():
        return exact
    candidates = [p for p in base.iterdir() if p.is_dir() and "PDF" in p.name]
    if not candidates:
        raise FileNotFoundError("Could not find マスターズPDF folder under cwd")
    return candidates[0]


def event_sort_key(path: Path) -> tuple[int, str]:
    m = re.search(r"第(\d+)回", path.name)
    return (int(m.group(1)) if m else 9999, path.name)


def round_no_from_name(name: str) -> str:
    m = re.search(r"第(\d+)回", name)
    return m.group(1) if m else ""


def normalize_team(team: str) -> str:
    text = unicodedata.normalize("NFKC", team or "").strip()
    text = re.sub(r"^セ[・\.\s]*", "", text)
    text = re.sub(r"[\s・･\-.ー－_]", "", text)
    return text


def normalize_name(name: str, *, fold_ocr: bool = False) -> str:
    text = unicodedata.normalize("NFKC", name or "").strip()
    text = re.sub(r"[\s　・･\-.ー－_]", "", text)
    text = text.translate(VARIANT_TRANSLATION)
    if fold_ocr:
        text = text.translate(OCR_CONFUSABLE_TRANSLATION)
    return text


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(
                min(
                    prev[j] + 1,
                    cur[j - 1] + 1,
                    prev[j - 1] + (0 if ca == cb else 1),
                )
            )
        prev = cur
    return prev[-1]


def similarity_reason(name_a: str, name_b: str, ev_a: NameEvidence, ev_b: NameEvidence) -> tuple[int, str]:
    norm_a = normalize_name(name_a)
    norm_b = normalize_name(name_b)
    ocr_a = normalize_name(name_a, fold_ocr=True)
    ocr_b = normalize_name(name_b, fold_ocr=True)

    if norm_a == norm_b and name_a != name_b:
        return 98, "variant_normalized_match"

    if norm_a == norm_b and ev_a.age_groups and ev_b.age_groups and ev_a.age_groups != ev_b.age_groups:
        return 96, "same_name_conflicting_age_group"

    if ocr_a == ocr_b and name_a != name_b:
        return 94, "ocr_confusable_match"

    distance = levenshtein(norm_a, norm_b)
    if distance == 1 and min(len(norm_a), len(norm_b)) >= 2:
        return 90, "edit_distance_1"
    if distance == 2 and min(len(norm_a), len(norm_b)) >= 4 and norm_a[:2] == norm_b[:2]:
        return 84, "edit_distance_2"

    ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
    if ratio >= 0.88:
        return int(ratio * 100), "high_name_similarity"

    # Japanese surnames are not reliably separable without a dictionary, but
    # first two characters are still useful as a review hint inside one team.
    if len(norm_a) >= 4 and len(norm_b) >= 4 and norm_a[:2] == norm_b[:2] and ratio >= 0.78:
        return int(ratio * 100), "same_prefix_similarity"

    return 0, ""


def add_occurrence(
    grouped: dict[tuple[str, str], dict[str, NameEvidence]],
    *,
    name: str,
    team: str,
    gender: str,
    age_group: str,
    source: str,
    evidence_text: str,
) -> None:
    name = (name or "").strip()
    team = (team or "").strip()
    gender = (gender or "").strip()
    if not name or not team:
        return
    if gender not in {"男子", "女子"}:
        return
    if len(normalize_name(name)) < 2:
        return
    if re.search(r"[0-9０-９/／]", name):
        return

    team_key = normalize_team(team)
    group_key = (team_key, gender)
    ev = grouped[group_key].setdefault(name, NameEvidence(name=name))
    ev.team_names.add(team)
    if gender:
        ev.genders.add(gender)
    if age_group:
        ev.age_groups.add(age_group)
    ev.sources.add(source)
    if evidence_text and evidence_text not in ev.evidence:
        ev.evidence.append(evidence_text)


def collect_event(event_dir: Path) -> tuple[str, str, dict[tuple[str, str], dict[str, NameEvidence]]]:
    round_no = round_no_from_name(event_dir.name)
    pool_type = "短水路" if "短水路" in event_dir.name else "長水路" if "長水路" in event_dir.name else ""
    grouped: dict[tuple[str, str], dict[str, NameEvidence]] = defaultdict(dict)
    gen_dir = event_dir / "backup" / "generated"

    for row in read_csv(gen_dir / "individual_results.csv"):
        add_occurrence(
            grouped,
            name=row.get("athlete_name", ""),
            team=row.get("team_name", ""),
            gender=row.get("gender", ""),
            age_group=row.get("age_group", ""),
            source="individual_results",
            evidence_text=(
                f"race={row.get('race_no','')},event={row.get('event_name','')},"
                f"age={row.get('age_group','')},rank={row.get('rank','')}"
            ),
        )

    relay_results = {}
    for row in read_csv(gen_dir / "relay_results.csv"):
        relay_key = (
            f"{row.get('round','')}_{row.get('race_no','')}_{row.get('age_group_label','')}"
            f"_{row.get('team_name','')}_{row.get('rank','')}"
        )
        relay_results[relay_key] = row

    for row in read_csv(gen_dir / "relay_members.csv"):
        relay = relay_results.get(row.get("relay_key", ""), {})
        add_occurrence(
            grouped,
            name=row.get("athlete_name", ""),
            team=relay.get("team_name", ""),
            gender=relay.get("gender", ""),
            age_group=relay.get("age_group_label", ""),
            source="relay_members",
            evidence_text=(
                f"race={relay.get('race_no','')},event={relay.get('event_name','')},"
                f"age={relay.get('age_group_label','')},order={row.get('swim_order','')}"
            ),
        )

    player_files = sorted(event_dir.glob("*M選手一覧.csv"))
    for path in player_files:
        for row in read_csv(path):
            add_occurrence(
                grouped,
                name=row.get("選手名", ""),
                team=row.get("チーム名", ""),
                gender=row.get("性別", ""),
                age_group=row.get("個人年齢区分", ""),
                source=path.name,
                evidence_text=(
                    f"player_csv_id={row.get('ID','')},age={row.get('個人年齢区分','')},"
                    f"points={row.get('取得得点','')}"
                ),
            )

    return round_no, pool_type, grouped


def build_candidates(event_dir: Path, min_score: int) -> list[dict[str, str]]:
    round_no, pool_type, grouped = collect_event(event_dir)
    rows: list[dict[str, str]] = []

    for (team_key, gender), names in sorted(grouped.items()):
        values = sorted(names.values(), key=lambda ev: normalize_name(ev.name))
        for i, ev_a in enumerate(values):
            for ev_b in values[i + 1 :]:
                score, reason = similarity_reason(ev_a.name, ev_b.name, ev_a, ev_b)
                if score < min_score:
                    continue
                rows.append(
                    {
                        "round": round_no,
                        "pool_type": pool_type,
                        "team_key": team_key,
                        "team_names": " / ".join(sorted(ev_a.team_names | ev_b.team_names)),
                        "gender": gender,
                        "name_a": ev_a.name,
                        "name_b": ev_b.name,
                        "normalized_a": normalize_name(ev_a.name),
                        "normalized_b": normalize_name(ev_b.name),
                        "score": str(score),
                        "reason": reason,
                        "age_groups_a": " / ".join(sorted(ev_a.age_groups)),
                        "age_groups_b": " / ".join(sorted(ev_b.age_groups)),
                        "sources_a": " / ".join(sorted(ev_a.sources)),
                        "sources_b": " / ".join(sorted(ev_b.sources)),
                        "evidence_a": " | ".join(ev_a.evidence[:5]),
                        "evidence_b": " | ".join(ev_b.evidence[:5]),
                        "review_status": "candidate",
                        "review_note": "",
                    }
                )

    rows.sort(key=lambda r: (r["team_key"], r["gender"], -int(r["score"]), r["name_a"], r["name_b"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--round", type=int, help="Generate only one round, e.g. 80")
    parser.add_argument("--min-score", type=int, default=90)
    parser.add_argument("--root", type=Path, default=None, help="Path to マスターズPDF")
    args = parser.parse_args()

    root = args.root if args.root else find_pdf_root(Path.cwd())
    if not root.exists():
        raise FileNotFoundError(root)

    event_dirs = sorted([p for p in root.iterdir() if p.is_dir()], key=event_sort_key)
    if args.round:
        event_dirs = [p for p in event_dirs if round_no_from_name(p.name) == str(args.round)]

    total = 0
    for event_dir in event_dirs:
        rows = build_candidates(event_dir, args.min_score)
        out_path = event_dir / "player_duplicate_candidates.csv"
        write_csv(out_path, rows)
        total += len(rows)
        print(f"{event_dir.name}: {len(rows)} candidates -> {out_path.name}")

    print(f"Total candidates: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
