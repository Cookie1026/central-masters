-- ============================================================
-- 選手レコード重複修正
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- ① 友田智哲 (team_id=46)
--    id=13194 gender=女子 → OCR誤判定の偽物（成績5件が誤紐付き）
--    id=14944 gender=男子 → 正規レコード（成績1件）
--    成績を正規レコードに付け替えて偽物を削除
-- ──────────────────────────────────────────────────────────────
UPDATE dt_result_person SET player_id = 14944 WHERE player_id = 13194;
UPDATE dt_player_relay  SET player_id = 14944 WHERE player_id = 13194;
DELETE FROM dt_player_person WHERE id = 13194;

-- ──────────────────────────────────────────────────────────────
-- ② 兼森伸兒(旧字 U+5152) → 兼森伸児(新字 U+5150) に統合
--    OCR が旧字体で誤読したため同一人物が2レコード存在
--
--    ザバス八景(team=70):
--      兼森伸兒 id=13920 (個人6件・リレー3件) → 兼森伸児 id=16025 に付け替え
--    ザバス金沢八(team=73):
--      兼森伸兒 id=12090 (個人1件・リレー0件) → 兼森伸児 id=11527 に付け替え
-- ──────────────────────────────────────────────────────────────
-- team=70
UPDATE dt_result_person SET player_id = 16025 WHERE player_id = 13920;
UPDATE dt_player_relay  SET player_id = 16025 WHERE player_id = 13920;
DELETE FROM dt_player_person WHERE id = 13920;

-- team=73
UPDATE dt_result_person SET player_id = 11527 WHERE player_id = 12090;
UPDATE dt_player_relay  SET player_id = 11527 WHERE player_id = 12090;
DELETE FROM dt_player_person WHERE id = 12090;

-- ──────────────────────────────────────────────────────────────
-- 今後のインポートで再発しないよう兼森伸兒 → 兼森伸児 をエイリアス登録
-- ──────────────────────────────────────────────────────────────
INSERT INTO mst_player_alias (alias, canonical_name)
VALUES ('兼森伸兒', '兼森伸児')
ON CONFLICT (alias) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

COMMIT;
