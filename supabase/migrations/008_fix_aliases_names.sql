-- Migration 008: チーム名alias追加 + 選手名修正（OCR誤読・旧字体）

-- ① チーム名alias追加（CSVの表記 → DB正式名へのマッピング）
--   袖ケ浦 (ケ) → セ・袖ヶ浦 (ヶ) id=33
--   曽谷       → 曽谷・セ        id=51
INSERT INTO mst_team_alias (alias, team_id) VALUES
  ('袖ケ浦', 33),
  ('曽谷',   51)
ON CONFLICT (alias) DO NOTHING;

-- ② 選手名修正
UPDATE dt_player_person SET name = '兼森伸兒' WHERE id = 6873; -- 旧字体: 児→兒
UPDATE dt_player_person SET name = '山梨英克' WHERE id = 7299; -- OCR誤読: 亮→克
UPDATE dt_player_person SET name = '安髙祐三' WHERE id = 7156; -- はしご高: 高→髙
UPDATE dt_player_person SET name = '白井凜'   WHERE id = 7140; -- 字体統一: 凛→凜
