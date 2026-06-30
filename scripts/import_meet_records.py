"""
mst_record_tournament 系テーブルへ CSV をインポートするスクリプト。

短水路は mst_record_tournament_short、長水路は mst_record_tournament_long へ入れる。
使用: python scripts/import_meet_records.py
"""
import csv
import os
import re
import sys
from datetime import datetime
from supabase import create_client

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]
CSV_PATH     = sys.argv[1] if len(sys.argv) > 1 else "data/mst_meet_records.csv"


def table_for_course(course: str) -> str:
    return "mst_record_tournament_long" if course == "長水路" else "mst_record_tournament_short"

def parse_date(s: str):
    """'YYYY/M/D' → ISO date string, None on failure."""
    for fmt in ("%Y/%m/%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except ValueError:
            pass
    return None

def normalize_record_time(value: str) -> str:
    text = (value or "").strip()
    m = re.match(r"^(\d+)-(\d{2})-(\d{2})$", text)
    if m:
        return f"{m.group(1)}:{m.group(2)}.{m.group(3)}"
    m = re.match(r"^(\d{1,2})-(\d{2})$", text)
    if m:
        return f"{m.group(1)}.{m.group(2)}"
    return text

def normalize_gender(value: str) -> str:
    text = (value or "").strip()
    if text in ("男", "男子"):
        return "男性"
    if text in ("女", "女子"):
        return "女性"
    return text

def main():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))

    records = []
    for r in rows:
        records.append({
            "course":           r["course"],
            "gender":           normalize_gender(r["gender"]),
            "event":            r["event"],
            "distance":         r["distance"],
            "age_group":        int(r["age_group"]),
            "is_relay":         r["is_relay"] == "1",
            "name_team_raw":    r["name_team_raw"],
            "record":           normalize_record_time(r["record"]),
            "established_date": parse_date(r["established_date"]),
            "athlete_name":     r.get("athlete_name") or None,
            "team_name":        r.get("team_name") or None,
        })

    records_by_table = {}
    for record in records:
        records_by_table.setdefault(table_for_course(record["course"]), []).append(record)

    CHUNK = 500
    for table, table_records in records_by_table.items():
        courses = sorted({r["course"] for r in table_records})
        for c in courses:
            sb.table(table).delete().eq("course", c).execute()

        for i in range(0, len(table_records), CHUNK):
            sb.table(table).insert(table_records[i:i+CHUNK]).execute()
            print(f"  {table}: inserted {min(i+CHUNK, len(table_records))}/{len(table_records)}")

    print(f"Done: {len(records)} records imported")

if __name__ == "__main__":
    main()
