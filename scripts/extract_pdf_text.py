#!/usr/bin/env python3
"""
Extract embedded text from a meet result PDF into the page-marker TXT format.

This is intentionally not image OCR. Many Central Masters result PDFs include
an embedded text layer, which is usually more accurate than OCR and avoids
mojibake caused by image-to-text tools.

Usage:
  python scripts/extract_pdf_text.py <pdf-path> [--out <txt-path>] [--layout]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pdfplumber


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def page_marker(page_no: int) -> str:
    return f"{'=' * 40} Page {page_no} {'=' * 40}"


def extract_pdf_text(pdf_path: Path, out_path: Path, *, layout: bool) -> None:
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)

    with pdfplumber.open(pdf_path) as pdf, out_path.open("w", encoding="utf-8", newline="\n") as f:
        for idx, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(layout=layout) or ""
            f.write(page_marker(idx))
            f.write("\n")
            f.write(text.rstrip())
            f.write("\n\n")

    print(f"Extracted {idx if 'idx' in locals() else 0} pages -> {out_path}")


def default_out_path(pdf_path: Path) -> Path:
    m = None
    for part in pdf_path.parts:
        if part.startswith("第") and "回" in part:
            m = part
            break
    prefix = ""
    if m:
        import re

        found = re.search(r"第(\d+)回", m)
        if found:
            prefix = f"第{found.group(1)}回"
    filename = f"1-{prefix}PDFテキスト抽出.txt" if prefix else f"{pdf_path.stem}_text.txt"
    return pdf_path.parent / "backup" / filename


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--layout", action="store_true", help="Preserve approximate PDF layout")
    args = parser.parse_args()

    out_path = args.out if args.out else default_out_path(args.pdf)
    extract_pdf_text(args.pdf, out_path, layout=args.layout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
