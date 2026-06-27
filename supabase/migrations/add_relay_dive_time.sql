-- dt_player_relay に dive_time カラムを追加
-- swim_order=1: 絶対飛込タイム（秒）
-- swim_order=2〜4: 反応時間（前走者タッチから離台まで、秒）

ALTER TABLE dt_player_relay ADD COLUMN IF NOT EXISTS dive_time NUMERIC(5,3);
