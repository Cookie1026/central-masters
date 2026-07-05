#!/usr/bin/env python3
"""
Supabase Storage に PNG を一括アップロードする。

Usage:
  python scripts/upload_png_to_storage.py --round 80
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(".env.local")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BUCKET = "meet-programs"

PNG_DIRS = {
    80: Path("マスターズPDF/第80回(長水路)/第80回マスターズ結果_長水路(20260502)_png"),
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--round", type=int, required=True)
    args = parser.parse_args()

    png_dir = PNG_DIRS.get(args.round)
    if not png_dir or not png_dir.exists():
        raise SystemExit(f"フォルダが見つかりません: {png_dir}")

    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    files = sorted(png_dir.glob("*.png"))
    print(f"第{args.round}回: {len(files)}枚をアップロードします")

    for i, f in enumerate(files, 1):
        storage_path = f"round{args.round}/{f.name}"
        with open(f, "rb") as fp:
            data = fp.read()
        sb.storage.from_(BUCKET).upload(
            storage_path,
            data,
            {"content-type": "image/png", "x-upsert": "true"},
        )
        print(f"  [{i}/{len(files)}] {storage_path}")

    print(f"\n完了: {len(files)}枚アップロードしました。")
    print(f"URL例: {{SUPABASE_URL}}/storage/v1/object/public/{BUCKET}/round{args.round}/page_001.png")


if __name__ == "__main__":
    main()
