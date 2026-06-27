-- ============================================================
-- mst_age 重複レコード整理
-- 原因: インポートスクリプトが 〜(波ダッシュ U+301C) を使って INSERT したため
--       既存の ～(全角チルダ U+FF5E) レコードにマッチせず重複が発生
-- 対象: id 51-72 (min_age=0 / max_age=NULL の全22件)
--
-- 手順:
--   1. dt_result_person の age_id を正規レコード(個人)に付け替え   (1,000件)
--   2. dt_result_relay  の age_id を正規レコード(リレー)に付け替え  (356件)
--   3. 重複レコードを削除
-- ============================================================

BEGIN;

-- 1. dt_result_person: age_id 51-65 → 正規 個人 age_id
--    REPLACE(dup.name, '〜', '～') で名称を正規化して JOIN
UPDATE dt_result_person AS dp
SET age_id = correct.id
FROM mst_age AS dup
JOIN mst_age AS correct
  ON replace(dup.name, '〜', '～') = correct.name
 AND correct.type   = '個人'
 AND correct.min_age > 0
WHERE dp.age_id = dup.id
  AND dup.id BETWEEN 51 AND 65;

-- 2. dt_result_relay: age_id 66-72 → 正規 リレー age_id
--    (DB上は type='個人' と誤登録されているが名称でリレー側に正しくマッピング)
UPDATE dt_result_relay AS dr
SET age_id = correct.id
FROM mst_age AS dup
JOIN mst_age AS correct
  ON replace(dup.name, '〜', '～') = correct.name
 AND correct.type   = 'リレー'
 AND correct.min_age > 0
WHERE dr.age_id = dup.id
  AND dup.id BETWEEN 66 AND 72;

-- 3. 重複レコードを削除
DELETE FROM mst_age WHERE id BETWEEN 51 AND 72;

COMMIT;
