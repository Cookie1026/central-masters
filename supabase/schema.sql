-- ============================================================
-- セントラルマスターズ記録検索サイト スキーマ
-- ============================================================

-- ============================================================
-- 1. 大会
-- ============================================================
CREATE TABLE mst_event (
  id          SERIAL PRIMARY KEY,
  round       INTEGER     NOT NULL,                          -- 回 (例: 80)
  date        DATE        NOT NULL,
  pool_type   VARCHAR(10) NOT NULL CHECK (pool_type IN ('長水路', '短水路')),
  name        VARCHAR(100),                                  -- 大会名 (例: 第80回中央マスターズ水泳競技会)
  venue       VARCHAR(100),                                  -- 会場
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (round, pool_type)
);

-- ============================================================
-- 2. チーム
-- ============================================================
CREATE TABLE mst_team (
  id           INTEGER      PRIMARY KEY,
  name         VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(100),
  prefecture   VARCHAR(20),
  team_code    VARCHAR(20)  UNIQUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 3. チーム名エイリアス（OCR表記ゆれ → 正規チームへのマッピング）
-- ============================================================
CREATE TABLE mst_team_alias (
  alias   VARCHAR(100) PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES mst_team(id)
);

-- ============================================================
-- 3b. 選手名エイリアス（OCR誤認識による表記ゆれ → 正規選手名へのマッピング）
-- ============================================================
CREATE TABLE mst_player_alias (
  alias          VARCHAR(100) PRIMARY KEY,
  canonical_name VARCHAR(100) NOT NULL
);

-- ============================================================
-- 4. 選手
-- ============================================================
CREATE TABLE dt_player_person (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  gender      VARCHAR(10)  NOT NULL CHECK (gender IN ('男子', '女子')),
  team_id     INTEGER      NOT NULL REFERENCES mst_team(id),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, team_id, gender)                             -- マッチングキー: 同一人物の同定                             -- マッチングキー: 同一人物の同定
);

-- ============================================================
-- 4. 記録ボーナスポイント
-- ============================================================
CREATE TABLE mst_record_bonus (
  record_type   VARCHAR(20) PRIMARY KEY,  -- '大会新', '日本新', '世界新'
  bonus_points  NUMERIC(5,1) NOT NULL DEFAULT 10
);

INSERT INTO mst_record_bonus (record_type, bonus_points) VALUES
  ('大会新', 10), ('日本新', 10), ('世界新', 10);

-- ============================================================
-- 5. 競技種目
-- ============================================================
CREATE TABLE mst_category (
  id          INTEGER      PRIMARY KEY,
  pool_type   VARCHAR(10)  NOT NULL CHECK (pool_type IN ('長水路', '短水路', '共通')),
  type        VARCHAR(10)  NOT NULL CHECK (type IN ('個人', 'リレー')),
  stroke      VARCHAR(50),                                   -- 泳法 (自由形/バタフライ/背泳ぎ/平泳ぎ/個人メドレー/フリーリレー/メドレーリレー)
  name        VARCHAR(100) NOT NULL,                         -- 表示名 (例: 50m自由形)
  distance    INTEGER,                                       -- 距離 (m)
  gender      VARCHAR(10)  NOT NULL CHECK (gender IN ('男子', '女子', '混合')),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, pool_type, gender)
);

-- ============================================================
-- 5. 年齢区分
-- ============================================================
CREATE TABLE mst_age (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL,                         -- 例: '18～24歳' / '120～159歳'
  type        VARCHAR(10)  NOT NULL DEFAULT '個人'
                           CHECK (type IN ('個人', 'リレー')),  -- 個人種目 or リレー合計年齢
  min_age     INTEGER      NOT NULL,
  max_age     INTEGER,                                       -- NULL = 上限なし (例: 90歳以上)
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, type)
);

-- ============================================================
-- 6. 個人成績
-- ============================================================
CREATE TABLE dt_result_person (
  id                    SERIAL PRIMARY KEY,
  event_id              INTEGER      NOT NULL REFERENCES mst_event(id),
  player_id             INTEGER      NOT NULL REFERENCES dt_player_person(id),
  category_id           INTEGER      NOT NULL REFERENCES mst_category(id),
  age_id                INTEGER      NOT NULL REFERENCES mst_age(id),
  rank                  INTEGER,
  time_seconds          NUMERIC(8,2),                        -- タイム秒数 (計算・ソート用)
  time_display          VARCHAR(20),                         -- 表示用 '3:53.04'
  dive_time             NUMERIC(5,2),                        -- 飛込タイム(秒)
  lap_times             TEXT,                                -- LAP '52.61,1:50.74,2:51.44'
  points                NUMERIC(5,1),                        -- 個人得点
  team_points           NUMERIC(5,1),                        -- チームへの付与得点 (通常は個人と同じ)
  entry_time_seconds    NUMERIC(8,2),                        -- 申請タイム(秒)
  meet_record_seconds   NUMERIC(8,2),                        -- 大会記録(秒) ※当時の値
  japan_record_seconds  NUMERIC(8,2),                        -- 日本記録(秒) ※当時の値
  world_record_seconds  NUMERIC(8,2),                        -- 世界記録(秒) ※当時の値
  is_meet_record        BOOLEAN      DEFAULT FALSE,          -- 大会新記録 (+bonus pt)
  is_japan_record       BOOLEAN      DEFAULT FALSE,          -- 日本新記録 (+bonus pt)
  is_world_record       BOOLEAN      DEFAULT FALSE,          -- 世界新記録 (+bonus pt)
  is_just_right         BOOLEAN      DEFAULT FALSE,          -- ぴったり賞
  race_number           INTEGER,                             -- レース番号
  lane                  VARCHAR(10),
  created_at            TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 7. リレー結果  ← ポイントはここに持つ
-- ============================================================
CREATE TABLE dt_result_relay (
  id                    SERIAL PRIMARY KEY,
  event_id              INTEGER      NOT NULL REFERENCES mst_event(id),
  team_id               INTEGER      NOT NULL REFERENCES mst_team(id),
  category_id           INTEGER      NOT NULL REFERENCES mst_category(id),
  age_id                INTEGER      REFERENCES mst_age(id),  -- リレー年齢区分 FK (type='リレー')
  age_group_label       VARCHAR(50),                         -- リレー年齢区分ラベル (互換性維持)
  combined_age          INTEGER,                             -- リレー実年齢合計
  rank                  INTEGER,
  time_seconds          NUMERIC(8,2),
  time_display          VARCHAR(20),
  team_points           NUMERIC(5,1),                        -- チーム獲得ポイント
                                                             -- ★ 個人ページにもこの値をそのまま表示
                                                             -- ★ チーム合計はここからSUMする (4倍にしない)
  meet_record_seconds   NUMERIC(8,2),
  japan_record_seconds  NUMERIC(8,2),
  world_record_seconds  NUMERIC(8,2),
  is_meet_record        BOOLEAN      DEFAULT FALSE,
  race_number           INTEGER,
  created_at            TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 8. リレーメンバー
-- ============================================================
CREATE TABLE dt_player_relay (
  id                SERIAL PRIMARY KEY,
  relay_result_id   INTEGER      NOT NULL REFERENCES dt_result_relay(id) ON DELETE CASCADE,
  player_id         INTEGER      NOT NULL REFERENCES dt_player_person(id),
  swim_order        INTEGER      NOT NULL CHECK (swim_order BETWEEN 1 AND 4),  -- 泳順
  split_seconds     NUMERIC(6,2),                            -- 個人ラップタイム(秒)
  dive_time         NUMERIC(5,3),                            -- 飛込タイム: swim_order=1は絶対値、2〜4は反応時間(秒)
  is_meet_record    BOOLEAN      NOT NULL DEFAULT FALSE,     -- 大会新記録
  is_japan_record   BOOLEAN      NOT NULL DEFAULT FALSE,     -- 日本新記録（スプリット単位）
  is_world_record   BOOLEAN      NOT NULL DEFAULT FALSE,     -- 世界新記録（スプリット単位）
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (relay_result_id, swim_order)
);

-- ============================================================
-- 9. チーム総合成績
-- ============================================================
CREATE TABLE dt_ranking_team (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER      NOT NULL REFERENCES mst_event(id),
  team_id       INTEGER      NOT NULL REFERENCES mst_team(id),
  rank          INTEGER,
  total_points  NUMERIC(7,1),
  male_points   NUMERIC(7,1),
  female_points NUMERIC(7,1),
  mixed_points  NUMERIC(7,1),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (event_id, team_id)
);

-- ============================================================
-- インデックス (検索・ソートの高速化)
-- ============================================================
CREATE INDEX idx_dt_result_person_player      ON dt_result_person (player_id);
CREATE INDEX idx_dt_result_person_event       ON dt_result_person (event_id);
CREATE INDEX idx_dt_result_person_category    ON dt_result_person (category_id);
CREATE INDEX idx_dt_result_person_time        ON dt_result_person (time_seconds);
CREATE INDEX idx_dt_result_relay_team         ON dt_result_relay (team_id);
CREATE INDEX idx_dt_result_relay_event        ON dt_result_relay (event_id);
CREATE INDEX idx_dt_player_relay_player       ON dt_player_relay (player_id);
CREATE INDEX idx_dt_player_person_team        ON dt_player_person (team_id);
CREATE INDEX idx_dt_ranking_team_event          ON dt_ranking_team (event_id);
CREATE INDEX idx_dt_ranking_team_rank           ON dt_ranking_team (rank);
