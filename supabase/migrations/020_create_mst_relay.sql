-- Migration 020: mst_relay — リレー泳順マスター
-- リレー種別ごとの泳順と使用ストロークを定義する
-- relay_stroke は mst_category.stroke の値と一致させる

CREATE TABLE mst_relay (
  id            SERIAL PRIMARY KEY,
  relay_stroke  VARCHAR(100) NOT NULL,            -- mst_category.stroke の値（例: 'フリーリレー', 'メドレーリレー'）
  swim_order    INTEGER      NOT NULL CHECK (swim_order BETWEEN 1 AND 8),
  stroke        VARCHAR(50)  NOT NULL,             -- この泳順で泳ぐ個人ストローク（mst_category.stroke と一致）
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (relay_stroke, swim_order)
);

-- フリーリレー（4×50m / 4×100m 共通）
INSERT INTO mst_relay (relay_stroke, swim_order, stroke) VALUES
  ('フリーリレー', 1, '自由形'),
  ('フリーリレー', 2, '自由形'),
  ('フリーリレー', 3, '自由形'),
  ('フリーリレー', 4, '自由形');

-- メドレーリレー（男子・女子）
INSERT INTO mst_relay (relay_stroke, swim_order, stroke) VALUES
  ('メドレーリレー', 1, '背泳ぎ'),
  ('メドレーリレー', 2, '平泳ぎ'),
  ('メドレーリレー', 3, 'バタフライ'),
  ('メドレーリレー', 4, '自由形');

-- 混合メドレーリレー（同じ泳順ルール）
INSERT INTO mst_relay (relay_stroke, swim_order, stroke) VALUES
  ('メドレーリレー（混合）', 1, '背泳ぎ'),
  ('メドレーリレー（混合）', 2, '平泳ぎ'),
  ('メドレーリレー（混合）', 3, 'バタフライ'),
  ('メドレーリレー（混合）', 4, '自由形');

-- アクセス権限
ALTER TABLE mst_relay DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON mst_relay TO service_role;
GRANT SELECT ON mst_relay TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE mst_relay_id_seq TO service_role;

COMMENT ON TABLE  mst_relay                IS 'リレー泳順マスター: relay_stroke × swim_order → individual stroke';
COMMENT ON COLUMN mst_relay.relay_stroke   IS 'mst_category.stroke の値（フリーリレー / メドレーリレー / メドレーリレー（混合））';
COMMENT ON COLUMN mst_relay.swim_order     IS '泳順（1 = 第1泳者, 4 = アンカー）';
COMMENT ON COLUMN mst_relay.stroke         IS 'その泳順で泳ぐ個人ストローク（mst_category.stroke と対応）';
