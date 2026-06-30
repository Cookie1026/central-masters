-- 024: mst_record_tournament 整備
-- ① タイム書式変換: "SS-ss" → "SS.ss" / "M-SS-ss" → "M:SS.ss"
-- ② 選手名・チーム名の分離カラムを追加（個人種目のみ）

-- ① タイム書式変換
UPDATE mst_record_tournament
SET record = CASE
  WHEN record ~ '^\d+-\d+-\d+$' THEN
    SPLIT_PART(record, '-', 1) || ':' ||
    SPLIT_PART(record, '-', 2) || '.' ||
    SPLIT_PART(record, '-', 3)
  WHEN record ~ '^\d+-\d+$' THEN
    SPLIT_PART(record, '-', 1) || '.' ||
    SPLIT_PART(record, '-', 2)
  ELSE record
END
WHERE record ~ '^[\d-]+$';

-- ② 分離カラム追加
ALTER TABLE mst_record_tournament ADD COLUMN IF NOT EXISTS athlete_name TEXT;
ALTER TABLE mst_record_tournament ADD COLUMN IF NOT EXISTS team_name TEXT;

-- 個人種目: name_team_raw の最後のスペースで分割
-- 例) "大野　祐紀 岐阜"  → athlete_name="大野　祐紀" / team_name="岐阜"
-- 例) "綿貫　麻衣子 横浜北" → athlete_name="綿貫　麻衣子" / team_name="横浜北"
UPDATE mst_record_tournament
SET
  team_name    = REVERSE(SPLIT_PART(REVERSE(TRIM(name_team_raw)), ' ', 1)),
  -- 選手名の中間スペースを除去（半角スペース U+0020 / 全角スペース U+3000 両方）
  -- 例) "大野　祐紀" → "大野祐紀"（mst_player の name フィールドと一致させるため）
  athlete_name = REGEXP_REPLACE(
    TRIM(LEFT(
      TRIM(name_team_raw),
      LENGTH(TRIM(name_team_raw))
        - LENGTH(REVERSE(SPLIT_PART(REVERSE(TRIM(name_team_raw)), ' ', 1)))
        - 1
    )),
    '[ 　]+',
    '',
    'g'
  )
WHERE is_relay = false;
