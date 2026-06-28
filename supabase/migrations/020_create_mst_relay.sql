-- Migration 020: mst_medley_relay — メドレーリレー泳順マスター
-- メドレーリレーのみ泳順ルールが固定（背泳ぎ→平泳ぎ→バタフライ→フリー）
-- フリーリレーは全泳順クロールのためマスター不要
-- relay_stroke は mst_category.stroke の値と一致させる

CREATE TABLE mst_medley_relay (
  id            SERIAL PRIMARY KEY,
  relay_stroke  VARCHAR(100) NOT NULL,            -- mst_category.stroke の値（例: 'メドレーリレー', 'メドレーリレー（混合）'）
  swim_order    INTEGER      NOT NULL CHECK (swim_order BETWEEN 1 AND 4),
  stroke        VARCHAR(50)  NOT NULL,             -- この泳順で泳ぐ個人ストローク（mst_category.stroke と一致）
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (relay_stroke, swim_order)
);

-- メドレーリレー（男子・女子）
INSERT INTO mst_medley_relay (relay_stroke, swim_order, stroke) VALUES
  ('メドレーリレー', 1, '背泳ぎ'),
  ('メドレーリレー', 2, '平泳ぎ'),
  ('メドレーリレー', 3, 'バタフライ'),
  ('メドレーリレー', 4, '自由形');

-- 混合メドレーリレー（同じ泳順ルール）
INSERT INTO mst_medley_relay (relay_stroke, swim_order, stroke) VALUES
  ('メドレーリレー（混合）', 1, '背泳ぎ'),
  ('メドレーリレー（混合）', 2, '平泳ぎ'),
  ('メドレーリレー（混合）', 3, 'バタフライ'),
  ('メドレーリレー（混合）', 4, '自由形');

-- アクセス権限
ALTER TABLE mst_medley_relay DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON mst_medley_relay TO service_role;
GRANT SELECT ON mst_medley_relay TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE mst_medley_relay_id_seq TO service_role;

COMMENT ON TABLE  mst_medley_relay                IS 'メドレーリレー泳順マスター: relay_stroke × swim_order → individual stroke';
COMMENT ON COLUMN mst_medley_relay.relay_stroke   IS 'mst_category.stroke の値（メドレーリレー / メドレーリレー（混合））';
COMMENT ON COLUMN mst_medley_relay.swim_order     IS '泳順（1=背泳ぎ 2=平泳ぎ 3=バタフライ 4=フリー）';
COMMENT ON COLUMN mst_medley_relay.stroke         IS 'この泳順で泳ぐ個人ストローク（mst_category.stroke と対応）';
