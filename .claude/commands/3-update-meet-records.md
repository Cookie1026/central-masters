# 大会新記録一覧表を更新する（毎大会）

## 概要
プログラムPDFに掲載されている「セントラルマスターズ最高記録一覧表」を解析し、
`mst_record_tournament_long`（長水路）または `mst_record_tournament_short`（短水路）テーブルを更新する。

引数 `$ARGUMENTS` に回数（例: `81`）または PDF パスが渡された場合はそれを使用する。
なければユーザーに確認する。

---

## ステップ0: 前提確認

以下を確認・収集してからスクリプトを実行すること。

| 確認項目 | 説明 |
|---|---|
| **プログラムPDFパス** | `マスターズPDF\第N回(水路)\プログラムXXX.pdf` |
| **水路** | 長水路 or 短水路（奇数回=長水路、偶数回=短水路 が多いが要確認） |
| **PNGフォルダ** | `マスターズPDF\第N回(水路)\第N回プログラムpng変換\` |
| **対象ページ** | 「最高記録一覧表」が掲載されているページ（PNG目視で確認） |
| **性別-ページ対応** | どのページが女子/男子/混合か（PNG先頭行のタイトルを確認） |

> **注意**: PNGフォルダは `第N回プログラムpng変換` （backup フォルダではない）。
> PDFのPNG変換がまだの場合は先に実行する（PyMuPDF等で変換済みの前提）。

---

## ステップ1: PNG目視でページ・性別マッピングを確認

```
マスターズPDF\第N回(水路)\第N回プログラムpng変換\page-XX.png  （または page_0XX.png）
```

各ページ先頭の「（女子 短水路）」「（男子 長水路）」等のタイトルを読み取り、
以下の形式でマッピングを決める:

```
例（第80回長水路）: 11:女,12:女,13:女,14:男,15:男,16:男,17:混合
例（第79回短水路）: 13:女,14:女,15:女,16:男,17:男,18:男,19:混合
```

一般的なパターン: 女子→男子→混合の順。各水路種別 3〜4 ページずつ。

---

## ステップ2: CSV生成

```powershell
python scripts/parse_meet_records_program.py `
  --pdf  "マスターズPDF\第N回(水路)\プログラムXXX.pdf" `
  --out  "data\mst_meet_records.csv" `
  --course  "長水路"  # または "短水路"
  --page-from  11  `
  --page-to    17  `
  --gender-pages "11:女,12:女,13:女,14:男,15:男,16:男,17:混合"
```

出力確認:
- `抽出件数: NNN` が出ること
- `event/distance 未確定: 0件` になること（1件でもあれば種目名・距離名を要確認）

---

## ステップ3: CSVを目視サンプルチェック

生成された `data/mst_meet_records.csv` を確認:
- 個人: `name_team_raw` と `athlete_name` が選手名のみ（チーム名が混入していない）
- 個人: `team_name` に所属が入っている
- リレー: `name_team_raw` が `選手A・選手B・選手C・選手D` 形式（チーム名なし）
- リレー: `team_name` に所属チームが入っている

**よくある問題と対処:**

| 問題 | 原因 | 対処 |
|---|---|---|
| リレー名が `選手A 選手B` になっている（スペース区切り） | PyMuPDF が苗字を分割 | スクリプト修正済み（`team_cands[-1]` / 空文字結合）。再現する場合はPNGで確認 |
| 共同記録が `志手直子/西井良子前橋/東青梅` になっている | "/" 区切りの共同記録 | DBに `志手直子・西井良子` / `前橋・東青梅` で手動修正（後述） |
| `event/distance 未確定` が出る | 種目名・距離名のOCR誤読 | スクリプト内 `EVENT_NORM` や `DIST_NORM` に追記 |

---

## ステップ4: DBインポート

```powershell
# .env.local から環境変数を読み込んでからインポート
$env_content = Get-Content .env.local
foreach ($line in $env_content) {
    if ($line -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)") { $env:NEXT_PUBLIC_SUPABASE_URL = $matches[1] }
    if ($line -match "^SUPABASE_SERVICE_KEY=(.+)") { $env:SUPABASE_SERVICE_KEY = $matches[1] }
}
python scripts/import_meet_records.py data/mst_meet_records.csv
```

- `course='長水路'` → `mst_record_tournament_long` に上書きインポート
- `course='短水路'` → `mst_record_tournament_short` に上書きインポート
- インポート前に同一 `course` の既存レコードを全削除してから再挿入する（スクリプト仕様）

---

## ステップ5: データ品質チェック（任意）

```powershell
$env:PYTHONUTF8 = "1"
python scripts/data_quality_check.py
```

チェック内容:
- 個人 `team_name` が空のもの
- 個人 `name_team_raw` にスペースが残っているもの
- リレー `name_team_raw` に「・」がないもの（=4人分の名前が揃っていない）
- リレー `team_name` が空のもの

---

## 共同記録の手動修正

"/" 区切りの共同記録（例: `志手直子/西井良子 前橋/東青梅`）が出た場合:

`(course, gender, event, distance, age_group)` にユニーク制約があるため1行で表現する。
Supabase ダッシュボードまたは下記で直接修正:

```python
sb.table("mst_record_tournament_short").update({
    "name_team_raw": "志手直子・西井良子",
    "athlete_name": "志手直子・西井良子",
    "team_name": "前橋・東青梅",
    "established_date": "2012-03-10",  # 先の日付を使用
}).eq("id", <対象ID>).execute()
```

---

## 参考: 過去大会のパラメータ

| 大会 | 水路 | ページ範囲 | 性別マッピング |
|---|---|---|---|
| 第80回 | 長水路 | 11〜17 | 11:女,12:女,13:女,14:男,15:男,16:男,17:混合 |
| 第79回 | 短水路 | 13〜19 | 13:女,14:女,15:女,16:男,17:男,18:男,19:混合 |
