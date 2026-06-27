-- リレーメンバー個人記録フラグを追加
-- 大会新・日本新・世界新をスプリット単位で管理する
ALTER TABLE dt_player_relay
  ADD COLUMN IF NOT EXISTS is_meet_record  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_japan_record BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_world_record BOOLEAN NOT NULL DEFAULT FALSE;
