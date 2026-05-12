import anthropic
import base64
import csv
import os
import sys
import time
from pathlib import Path

PNG_DIR = Path(r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\元PDF\第78回(長水路)\第78回PDFをpngに変換")
OUTPUT_CSV = Path(r"c:\Users\user\OneDrive\デスクトップ\antigravity\central_masters\第78回PDFデータ抽出.csv")

def encode_image(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")

def extract_text_from_image(client: anthropic.Anthropic, image_path: Path) -> str:
    image_data = encode_image(image_path)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": "この画像に含まれる全てのテキストを、見えている順序通りに抽出してください。表や列のデータはタブ区切りで抽出し、改行はそのまま保持してください。余計な説明は不要です。テキストのみを出力してください。",
                    },
                ],
            }
        ],
    )
    return message.content[0].text

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("エラー: ANTHROPIC_API_KEY 環境変数が設定されていません。")
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    png_files = sorted(PNG_DIR.glob("page_*.png"))
    if not png_files:
        print(f"エラー: {PNG_DIR} にPNGファイルが見つかりません。")
        sys.exit(1)

    print(f"処理対象: {len(png_files)} ファイル")
    print(f"出力先: {OUTPUT_CSV}")

    already_done = set()
    if OUTPUT_CSV.exists():
        with open(OUTPUT_CSV, encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if row:
                    already_done.add(row[1])

    mode = "a" if already_done else "w"
    with open(OUTPUT_CSV, mode, encoding="utf-8-sig", newline="") as csvfile:
        writer = csv.writer(csvfile)
        if not already_done:
            writer.writerow(["ページ番号", "ファイル名", "テキスト"])

        for i, png_path in enumerate(png_files, 1):
            if png_path.name in already_done:
                print(f"[{i:3d}/{len(png_files)}] {png_path.name} スキップ（処理済み）")
                continue
            print(f"[{i:3d}/{len(png_files)}] {png_path.name} を処理中...", end=" ", flush=True)
            try:
                text = extract_text_from_image(client, png_path)
                writer.writerow([i, png_path.name, text])
                csvfile.flush()
                print("完了")
            except anthropic.RateLimitError:
                for wait in [60, 120, 180]:
                    print(f"レート制限。{wait}秒待機...", end=" ", flush=True)
                    time.sleep(wait)
                    try:
                        text = extract_text_from_image(client, png_path)
                        writer.writerow([i, png_path.name, text])
                        csvfile.flush()
                        print("完了")
                        break
                    except anthropic.RateLimitError:
                        continue
            except Exception as e:
                print(f"エラー: {e}")
                writer.writerow([i, png_path.name, f"エラー: {e}"])
                csvfile.flush()

    print(f"\n完了！CSV出力先: {OUTPUT_CSV}")

if __name__ == "__main__":
    main()
