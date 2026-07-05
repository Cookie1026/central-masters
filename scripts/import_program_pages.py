#!/usr/bin/env python3
"""
OCRテキストをページ単位でmst_program_pagesテーブルにインポートする。

Usage:
  python scripts/import_program_pages.py --round 80
"""

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OCR_FILES = {
    80: Path("マスターズPDF/第80回(長水路)/backup/1-第80回PNG画像を文字起こし.txt"),
}

PAGE_SEPARATOR = re.compile(r"={40,}\s*Page\s+(\d+)\s*={40,}")


def parse_pages(txt_path: Path) -> list[tuple[int, str]]:
    """OCRテキストをページ単位に分割し [(page_no, text), ...] を返す"""
    text = txt_path.read_text(encoding="utf-8")
    parts = PAGE_SEPARATOR.split(text)

    # split result: [before_page1, '1', text1, '2', text2, ...]
    pages = []
    i = 1
    while i < len(parts) - 1:
        page_no = int(parts[i])
        page_text = parts[i + 1].strip()
        pages.append((page_no, page_text))
        i += 2

    return pages


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--round", type=int, required=True)
    parser.add_argument("--dry-run", action="store_true", help="DBに書き込まずに確認のみ")
    args = parser.parse_args()

    txt_path = OCR_FILES.get(args.round)
    if not txt_path or not txt_path.exists():
        raise SystemExit(f"OCRファイルが見つかりません: {txt_path}")

    pages = parse_pages(txt_path)
    print(f"第{args.round}回: {len(pages)}ページ読み込みました")

    if args.dry_run:
        for page_no, text in pages[:3]:
            print(f"\n--- Page {page_no} (先頭100文字) ---")
            print(text[:100])
        print("\n(dry-run: DBには書き込みません)")
        return

    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    # upsert で冪等にする
    rows = [
        {"round": args.round, "page_no": page_no, "text_content": text}
        for page_no, text in pages
    ]

    BATCH = 20
    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        sb.table("mst_program_pages").upsert(batch, on_conflict="round,page_no").execute()
        print(f"  [{i + len(batch)}/{len(rows)}] upsert完了")

    print(f"\n完了: {len(rows)}ページをmst_program_pagesに保存しました。")


if __name__ == "__main__":
    main()
