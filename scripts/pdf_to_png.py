"""
PDF → PNG変換スクリプト
使い方: python scripts/pdf_to_png.py <PDFファイルパス>
例:     python scripts/pdf_to_png.py "マスターズPDF/第80回(長水路)/第80回マスターズ結果_長水路.pdf"
"""

import sys
import fitz  # PyMuPDF
from pathlib import Path


def pdf_to_png(pdf_path: str, dpi: int = 200) -> None:
    pdf_file = Path(pdf_path)
    if not pdf_file.exists():
        print(f"エラー: ファイルが見つかりません: {pdf_path}")
        sys.exit(1)

    # 出力フォルダ: PDFと同じ場所に「{PDF名}_png」フォルダを作成
    out_dir = pdf_file.parent / f"{pdf_file.stem}_png"
    out_dir.mkdir(exist_ok=True)

    doc = fitz.open(pdf_path)
    total = len(doc)
    print(f"変換開始: {pdf_file.name} ({total}ページ)")
    print(f"出力先: {out_dir}")

    zoom = dpi / 72  # 72dpiがPDFの基本解像度
    mat = fitz.Matrix(zoom, zoom)

    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(matrix=mat)
        out_path = out_dir / f"page_{i:03d}.png"
        pix.save(str(out_path))
        print(f"  [{i:3d}/{total}] {out_path.name}")

    doc.close()
    print(f"\n完了！ {total}枚のPNGを生成しました → {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使い方: python scripts/pdf_to_png.py <PDFファイルパス>")
        sys.exit(1)

    pdf_to_png(sys.argv[1])
