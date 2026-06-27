-- ============================================================
-- Migration 005: 記録ボーナスポイント管理
-- ============================================================

-- マスター: 記録種別ごとのボーナスpt
CREATE TABLE mst_record_bonus (
  record_type   VARCHAR(20) PRIMARY KEY,  -- '大会新', '日本新', '世界新'
  bonus_points  NUMERIC(5,1) NOT NULL DEFAULT 10
);

INSERT INTO mst_record_bonus (record_type, bonus_points) VALUES
  ('大会新', 10),
  ('日本新', 10),
  ('世界新', 10);

-- 個人結果テーブルに日本新・世界新フラグを追加
-- (大会新は既存の is_meet_record で管理)
ALTER TABLE dt_result_person
  ADD COLUMN is_japan_record BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_world_record BOOLEAN NOT NULL DEFAULT FALSE;
