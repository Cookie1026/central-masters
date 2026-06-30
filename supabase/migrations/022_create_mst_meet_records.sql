-- mst_record_tournament: セントラルマスターズ最高記録一覧
-- ※ 023 マイグレーションで mst_meet_records → mst_record_tournament に改名済み
-- 短水路（25m）・長水路（50m）両方を管理するため course 列で区別する
-- 初期データ出典: 第79回プログラム p.11-17（短水路、2025年9月末現在）

CREATE TABLE IF NOT EXISTS mst_meet_records (
    id               SERIAL PRIMARY KEY,
    course           VARCHAR(6)   NOT NULL CHECK (course IN ('短水路', '長水路')),
    gender           VARCHAR(4)   NOT NULL CHECK (gender IN ('女', '男', '混合')),
    event            VARCHAR(20)  NOT NULL,
    distance         VARCHAR(10)  NOT NULL,
    age_group        INTEGER      NOT NULL,
    is_relay         BOOLEAN      NOT NULL DEFAULT FALSE,
    name_team_raw    TEXT         NOT NULL,  -- "選手名 チーム" または "選手1・選手2 チーム" (リレー)
    record           VARCHAR(20)  NOT NULL,  -- "SS-ss" or "M-SS-ss" 形式
    established_date DATE,                   -- 記録樹立日 (NULL = 不明)
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (course, gender, event, distance, age_group)  -- 同一カテゴリで1件のみ
);

-- インデックス
CREATE INDEX idx_mst_meet_records_course_event ON mst_meet_records (course, event, distance);
CREATE INDEX idx_mst_meet_records_gender       ON mst_meet_records (gender);
CREATE INDEX idx_mst_meet_records_age          ON mst_meet_records (age_group);

-- RLS
ALTER TABLE mst_meet_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON mst_meet_records FOR SELECT USING (true);

COMMENT ON TABLE mst_meet_records IS
    'セントラルマスターズ最高記録一覧。course 列で短水路/長水路を区別。';
COMMENT ON COLUMN mst_meet_records.course IS
    '短水路 = 25mプール、長水路 = 50mプール';
COMMENT ON COLUMN mst_meet_records.name_team_raw IS
    '選手名とチーム名を空白区切りで格納した生データ。リレーは複数名を含む。';
