-- ============================================================
-- カラムリネーム マイグレーション
-- ルール: mst_xxxxx参照カラム → xxxxx_id
--   meet_id      (→mst_event)    → event_id
--   event_id     (→mst_category) → category_id
--   athlete_id   (→dt_player_person) → player_id
--   age_group_id (→mst_age)      → age_id
-- ============================================================

-- STEP 0: FK制約をすべて削除（動的探索）
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('dt_result_person', 'dt_result_relay', 'dt_ranking_team', 'dt_player_relay')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- STEP 1: dt_result_person
-- meet_id と event_id が共存するので一時名経由でリネーム
ALTER TABLE dt_result_person RENAME COLUMN meet_id TO _new_event_id;
ALTER TABLE dt_result_person RENAME COLUMN event_id TO category_id;
ALTER TABLE dt_result_person RENAME COLUMN _new_event_id TO event_id;
ALTER TABLE dt_result_person RENAME COLUMN athlete_id TO player_id;
ALTER TABLE dt_result_person RENAME COLUMN age_group_id TO age_id;

-- STEP 2: dt_result_relay
ALTER TABLE dt_result_relay RENAME COLUMN meet_id TO _new_event_id;
ALTER TABLE dt_result_relay RENAME COLUMN event_id TO category_id;
ALTER TABLE dt_result_relay RENAME COLUMN _new_event_id TO event_id;

-- STEP 3: dt_ranking_team
ALTER TABLE dt_ranking_team RENAME COLUMN meet_id TO event_id;

-- STEP 4: dt_player_relay
ALTER TABLE dt_player_relay RENAME COLUMN athlete_id TO player_id;

-- STEP 5: FK制約を再作成
ALTER TABLE dt_result_person
  ADD CONSTRAINT dt_result_person_event_id_fkey    FOREIGN KEY (event_id)    REFERENCES mst_event(id),
  ADD CONSTRAINT dt_result_person_player_id_fkey   FOREIGN KEY (player_id)   REFERENCES dt_player_person(id),
  ADD CONSTRAINT dt_result_person_category_id_fkey FOREIGN KEY (category_id) REFERENCES mst_category(id),
  ADD CONSTRAINT dt_result_person_age_id_fkey      FOREIGN KEY (age_id)      REFERENCES mst_age(id);

ALTER TABLE dt_result_relay
  ADD CONSTRAINT dt_result_relay_event_id_fkey    FOREIGN KEY (event_id)    REFERENCES mst_event(id),
  ADD CONSTRAINT dt_result_relay_team_id_fkey      FOREIGN KEY (team_id)     REFERENCES mst_team(id),
  ADD CONSTRAINT dt_result_relay_category_id_fkey FOREIGN KEY (category_id) REFERENCES mst_category(id);

ALTER TABLE dt_ranking_team
  ADD CONSTRAINT dt_ranking_team_event_id_fkey FOREIGN KEY (event_id) REFERENCES mst_event(id),
  ADD CONSTRAINT dt_ranking_team_team_id_fkey  FOREIGN KEY (team_id)  REFERENCES mst_team(id);

ALTER TABLE dt_player_relay
  ADD CONSTRAINT dt_player_relay_relay_result_id_fkey FOREIGN KEY (relay_result_id) REFERENCES dt_result_relay(id) ON DELETE CASCADE,
  ADD CONSTRAINT dt_player_relay_player_id_fkey       FOREIGN KEY (player_id)       REFERENCES dt_player_person(id);

-- STEP 6: インデックス更新
DROP INDEX IF EXISTS idx_dt_result_person_player;
DROP INDEX IF EXISTS idx_dt_result_person_event;
DROP INDEX IF EXISTS idx_dt_result_person_category;
DROP INDEX IF EXISTS idx_dt_result_relay_event;
DROP INDEX IF EXISTS idx_dt_player_relay_player;
DROP INDEX IF EXISTS idx_dt_ranking_team_event;

CREATE INDEX idx_dt_result_person_player   ON dt_result_person (player_id);
CREATE INDEX idx_dt_result_person_event    ON dt_result_person (event_id);
CREATE INDEX idx_dt_result_person_category ON dt_result_person (category_id);
CREATE INDEX idx_dt_result_relay_event     ON dt_result_relay  (event_id);
CREATE INDEX idx_dt_player_relay_player    ON dt_player_relay  (player_id);
CREATE INDEX idx_dt_ranking_team_event     ON dt_ranking_team  (event_id);
