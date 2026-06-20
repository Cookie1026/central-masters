-- ============================================================
-- セントラルマスターズ記録検索サイト スキーマ
-- ============================================================

-- ============================================================
-- 1. 大会
-- ============================================================
CREATE TABLE meets (
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
CREATE TABLE teams (
  id          SERIAL PRIMARY KEY,
  team_code   VARCHAR(20) UNIQUE,                            -- 外部ID (例: 70041)
  prefecture  VARCHAR(20),
  name        VARCHAR(100) NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 選手
-- ============================================================
CREATE TABLE athletes (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  gender      VARCHAR(10)  NOT NULL CHECK (gender IN ('男子', '女子')),
  team_id     INTEGER      NOT NULL REFERENCES teams(id),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, team_id, gender)                             -- マッチングキー: 同一人物の同定
);

-- ============================================================
-- 4. 競技
-- ============================================================
CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,                         -- 表示名 (例: 50m自由形)
  type        VARCHAR(10)  NOT NULL CHECK (type IN ('個人', 'リレー')),
  distance    INTEGER,                                       -- 距離 (m)
  stroke      VARCHAR(50),                                   -- 泳法 (自由形/バタフライ/背泳ぎ/平泳ぎ/個人メドレー/フリーリレー/メドレーリレー)
  gender      VARCHAR(10)  CHECK (gender IN ('男子', '女子', '混合')),
  pool_type   VARCHAR(10)  CHECK (pool_type IN ('長水路', '短水路', '共通')) DEFAULT '共通',
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, pool_type)
);

-- ============================================================
-- 5. 年齢区分
-- ============================================================
CREATE TABLE age_groups (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL UNIQUE,                  -- 例: '18～24歳'
  min_age     INTEGER      NOT NULL,
  max_age     INTEGER,                                       -- NULL = 上限なし (例: 90歳以上)
  created_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 6. 個人成績
-- ============================================================
CREATE TABLE individual_results (
  id                    SERIAL PRIMARY KEY,
  meet_id               INTEGER      NOT NULL REFERENCES meets(id),
  athlete_id            INTEGER      NOT NULL REFERENCES athletes(id),
  event_id              INTEGER      NOT NULL REFERENCES events(id),
  age_group_id          INTEGER      NOT NULL REFERENCES age_groups(id),
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
  is_meet_record        BOOLEAN      DEFAULT FALSE,          -- 大会新記録
  is_just_right         BOOLEAN      DEFAULT FALSE,          -- ぴったり賞
  race_number           INTEGER,                             -- レース番号
  lane                  VARCHAR(10),
  created_at            TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 7. リレー結果  ← ポイントはここに持つ
-- ============================================================
CREATE TABLE relay_results (
  id                    SERIAL PRIMARY KEY,
  meet_id               INTEGER      NOT NULL REFERENCES meets(id),
  team_id               INTEGER      NOT NULL REFERENCES teams(id),
  event_id              INTEGER      NOT NULL REFERENCES events(id),
  age_group_label       VARCHAR(50),                         -- リレー年齢区分 (例: '200以上')
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
CREATE TABLE relay_members (
  id                SERIAL PRIMARY KEY,
  relay_result_id   INTEGER      NOT NULL REFERENCES relay_results(id) ON DELETE CASCADE,
  athlete_id        INTEGER      NOT NULL REFERENCES athletes(id),
  swim_order        INTEGER      NOT NULL CHECK (swim_order BETWEEN 1 AND 4),  -- 泳順
  split_seconds     NUMERIC(6,2),                            -- 個人ラップタイム(秒)
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (relay_result_id, swim_order)
);

-- ============================================================
-- 9. チーム総合成績
-- ============================================================
CREATE TABLE team_standings (
  id            SERIAL PRIMARY KEY,
  meet_id       INTEGER      NOT NULL REFERENCES meets(id),
  team_id       INTEGER      NOT NULL REFERENCES teams(id),
  rank          INTEGER,
  total_points  NUMERIC(7,1),
  male_points   NUMERIC(7,1),
  female_points NUMERIC(7,1),
  mixed_points  NUMERIC(7,1),
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (meet_id, team_id)
);

-- ============================================================
-- インデックス (検索・ソートの高速化)
-- ============================================================
CREATE INDEX idx_individual_results_athlete   ON individual_results (athlete_id);
CREATE INDEX idx_individual_results_meet      ON individual_results (meet_id);
CREATE INDEX idx_individual_results_event     ON individual_results (event_id);
CREATE INDEX idx_individual_results_time      ON individual_results (time_seconds);
CREATE INDEX idx_relay_results_team           ON relay_results (team_id);
CREATE INDEX idx_relay_results_meet           ON relay_results (meet_id);
CREATE INDEX idx_relay_members_athlete        ON relay_members (athlete_id);
CREATE INDEX idx_athletes_team               ON athletes (team_id);
CREATE INDEX idx_team_standings_meet         ON team_standings (meet_id);
CREATE INDEX idx_team_standings_rank         ON team_standings (rank);
