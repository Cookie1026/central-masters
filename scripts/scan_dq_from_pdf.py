"""
競技結果PDFから失格・棄権エントリーをスキャンする。
失格コード（背3, 競12 等）がタイム欄に入っている行を抽出する。

Usage:
  python scan_dq_from_pdf.py <PDF_PATH>
"""
import re
import sys
import unicodedata
import fitz  # PyMuPDF

# 失格コードパターン: 出1, 自2, 背3, 平14, バ9, メ7, 競12, 水3（全角・半角数字両対応）
RE_DQ_CODE = re.compile(r"^(?:出|自|背|平|バ|メ|競|水)[0-9０-９]{1,2}$")
# 棄権パターン
RE_KIKEN = re.compile(r"^棄権$")

# レース番号ヘッダ: "No.5 女子 4×100mフリーリレー" 等
RE_RACE_HEADER = re.compile(r"No\.(\d+)\s+([男女混合]+)\s+(.+)")
# 年齢グループ: "≪ 65～69歳 ≫"
RE_AGE = re.compile(r"[≪《]\s*(\d{2,3}(?:～\d{2,3})?歳)\s*[≫》]")


def scan_pdf(pdf_path: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"PDF: {pdf_path}")
    print(f"     {total_pages}ページ")

    current_race_no = None
    current_gender = None
    current_event = None
    current_age = None

    dq_entries = []

    for page_idx in range(total_pages):
        page = doc[page_idx]
        words = page.get_text("words")  # (x0,y0,x1,y1,text,block,line,word)

        # 行ごとにグループ化（y座標でまとめる）
        lines: dict[int, list] = {}
        for w in words:
            y = round(w[1] / 5) * 5  # 5px単位に丸めて同行判定
            lines.setdefault(y, []).append(w)

        for y in sorted(lines):
            tokens = [w[4] for w in sorted(lines[y], key=lambda w: w[0])]
            line_text = " ".join(tokens)

            # レースヘッダ更新
            m = RE_RACE_HEADER.search(line_text)
            if m:
                current_race_no = int(m.group(1))
                current_gender = m.group(2)
                current_event = m.group(3).strip()
                current_age = None
                continue

            # 年齢グループ更新
            m = RE_AGE.search(line_text)
            if m:
                current_age = m.group(1)
                continue

            # 失格コード or 棄権を含む行を検出
            context = " ".join(tokens)
            for tok in tokens:
                if RE_DQ_CODE.match(tok):
                    normalized = unicodedata.normalize("NFKC", tok)
                    dq_entries.append({
                        "page": page_idx + 1,
                        "type": "失格",
                        "race_no": current_race_no,
                        "gender": current_gender,
                        "event": current_event,
                        "age": current_age,
                        "dq_code": normalized,
                        "line": context,
                    })
                    break
                elif RE_KIKEN.match(tok):
                    dq_entries.append({
                        "page": page_idx + 1,
                        "type": "棄権",
                        "race_no": current_race_no,
                        "gender": current_gender,
                        "event": current_event,
                        "age": current_age,
                        "dq_code": None,
                        "line": context,
                    })
                    break

    doc.close()
    return dq_entries


def print_results(dq_entries: list[dict]) -> None:
    shikkaku = [e for e in dq_entries if e["type"] == "失格"]
    kiken    = [e for e in dq_entries if e["type"] == "棄権"]
    print(f"\n失格: {len(shikkaku)}件 / 棄権: {len(kiken)}件  (計{len(dq_entries)}件)\n")
    for label, entries in [("【失格】", shikkaku), ("【棄権】", kiken)]:
        print(label)
        for e in entries:
            code = f" [{e['dq_code']}]" if e['dq_code'] else ""
            print(f"  p.{e['page']:02d}  No.{e['race_no']} {e['gender']} {e['event']} {e['age']}{code}")
            print(f"         {e['line'][:90]}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scan_dq_from_pdf.py <PDF_PATH>", file=sys.stderr)
        sys.exit(1)
    pdf_path = sys.argv[1]
    entries = scan_pdf(pdf_path)
    print_results(entries)
