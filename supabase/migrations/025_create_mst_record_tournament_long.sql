-- Long-course tournament records are kept separate from the existing
-- short-course mst_record_tournament data to make source updates safer.
CREATE TABLE IF NOT EXISTS mst_record_tournament_long (
    id               SERIAL PRIMARY KEY,
    course           VARCHAR(6)   NOT NULL DEFAULT '長水路' CHECK (course = '長水路'),
    gender           VARCHAR(4)   NOT NULL CHECK (gender IN ('女', '男', '混合')),
    event            VARCHAR(20)  NOT NULL,
    distance         VARCHAR(10)  NOT NULL,
    age_group        INTEGER      NOT NULL,
    is_relay         BOOLEAN      NOT NULL DEFAULT FALSE,
    name_team_raw    TEXT         NOT NULL,
    record           VARCHAR(20)  NOT NULL,
    established_date DATE,
    athlete_name     TEXT,
    team_name        TEXT,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (course, gender, event, distance, age_group)
);

CREATE INDEX IF NOT EXISTS idx_mst_record_tournament_long_course_event
    ON mst_record_tournament_long (course, event, distance);
CREATE INDEX IF NOT EXISTS idx_mst_record_tournament_long_gender
    ON mst_record_tournament_long (gender);
CREATE INDEX IF NOT EXISTS idx_mst_record_tournament_long_age
    ON mst_record_tournament_long (age_group);

ALTER TABLE mst_record_tournament_long ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mst_record_tournament_long'
      AND policyname = 'public read'
  ) THEN
    CREATE POLICY "public read"
      ON mst_record_tournament_long
      FOR SELECT
      USING (true);
  END IF;
END
$$;

GRANT ALL ON mst_record_tournament_long TO service_role;
GRANT SELECT ON mst_record_tournament_long TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE mst_record_tournament_long_id_seq TO service_role;
