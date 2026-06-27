-- ============================================================
-- マスターテーブルのIDを1始まり連番に振り直す
-- 実行場所: Supabase SQL Editor
-- ポイント: FK制約名を決め打ちせず動的に検出して削除・再作成する
-- ============================================================

BEGIN;

-- ============================================================
-- PHASE 0: mst_team / mst_event / mst_category / mst_age を
--          参照する全FK制約を動的に削除
-- ============================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT
      tc.table_name   AS child_table,
      tc.constraint_name
    FROM information_schema.table_constraints     tc
    JOIN information_schema.key_column_usage       kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema   = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name IN ('mst_team', 'mst_event', 'mst_category', 'mst_age')
      AND ccu.column_name    = 'id'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
                   r.child_table, r.constraint_name);
    RAISE NOTICE 'Dropped FK: % on %', r.constraint_name, r.child_table;
  END LOOP;
END $$;


-- ============================================================
-- 1. mst_team のID連番化
-- ============================================================
CREATE TEMP TABLE team_id_map AS
SELECT id AS old_id,
       ROW_NUMBER() OVER (ORDER BY id) AS new_id
FROM mst_team;

UPDATE dt_player_person p SET team_id = m.new_id FROM team_id_map m WHERE p.team_id = m.old_id;
UPDATE dt_result_relay  r SET team_id = m.new_id FROM team_id_map m WHERE r.team_id = m.old_id;
UPDATE dt_ranking_team  d SET team_id = m.new_id FROM team_id_map m WHERE d.team_id = m.old_id;
UPDATE mst_team_alias   a SET team_id = m.new_id FROM team_id_map m WHERE a.team_id = m.old_id;
UPDATE mst_team         t SET id      = m.new_id FROM team_id_map m WHERE t.id      = m.old_id;

DO $$
DECLARE seq TEXT := pg_get_serial_sequence('mst_team', 'id');
BEGIN
  IF seq IS NOT NULL THEN
    PERFORM setval(seq, (SELECT MAX(id) FROM mst_team), true);
  END IF;
END $$;

DROP TABLE team_id_map;


-- ============================================================
-- 2. mst_event のID連番化
-- ============================================================
CREATE TEMP TABLE event_id_map AS
SELECT id AS old_id,
       ROW_NUMBER() OVER (ORDER BY id) AS new_id
FROM mst_event;

UPDATE dt_result_person p SET meet_id = m.new_id FROM event_id_map m WHERE p.meet_id = m.old_id;
UPDATE dt_result_relay  r SET meet_id = m.new_id FROM event_id_map m WHERE r.meet_id = m.old_id;
UPDATE dt_ranking_team  d SET meet_id = m.new_id FROM event_id_map m WHERE d.meet_id = m.old_id;
UPDATE mst_event        e SET id      = m.new_id FROM event_id_map m WHERE e.id      = m.old_id;

DO $$
DECLARE seq TEXT := pg_get_serial_sequence('mst_event', 'id');
BEGIN
  IF seq IS NOT NULL THEN
    PERFORM setval(seq, (SELECT MAX(id) FROM mst_event), true);
  END IF;
END $$;

DROP TABLE event_id_map;


-- ============================================================
-- 3. mst_category のID連番化
-- ============================================================
CREATE TEMP TABLE cat_id_map AS
SELECT id AS old_id,
       ROW_NUMBER() OVER (ORDER BY id) AS new_id
FROM mst_category;

UPDATE dt_result_person p SET event_id = m.new_id FROM cat_id_map m WHERE p.event_id = m.old_id;
UPDATE dt_result_relay  r SET event_id = m.new_id FROM cat_id_map m WHERE r.event_id = m.old_id;
UPDATE mst_category     c SET id       = m.new_id FROM cat_id_map m WHERE c.id       = m.old_id;

DO $$
DECLARE seq TEXT := pg_get_serial_sequence('mst_category', 'id');
BEGIN
  IF seq IS NOT NULL THEN
    PERFORM setval(seq, (SELECT MAX(id) FROM mst_category), true);
  END IF;
END $$;

DROP TABLE cat_id_map;


-- ============================================================
-- 4. mst_age id=15（90歳以上）削除 → id=16を15に変更
-- ============================================================

-- id=15 を参照しているレコードを id=16 に付け替えてから削除
UPDATE dt_result_person SET age_group_id = 16 WHERE age_group_id = 15;
DELETE FROM mst_age WHERE id = 15;

-- id=16 → 15
UPDATE dt_result_person SET age_group_id = 15 WHERE age_group_id = 16;
UPDATE mst_age SET id = 15 WHERE id = 16;

DO $$
DECLARE seq TEXT := pg_get_serial_sequence('mst_age', 'id');
BEGIN
  IF seq IS NOT NULL THEN
    PERFORM setval(seq, (SELECT MAX(id) FROM mst_age), true);
  END IF;
END $$;


-- ============================================================
-- PHASE 5: FK制約を再作成（標準命名 {child_table}_{col}_fkey）
-- ============================================================
ALTER TABLE dt_player_person ADD CONSTRAINT dt_player_person_team_id_fkey     FOREIGN KEY (team_id)      REFERENCES mst_team(id);
ALTER TABLE dt_result_relay  ADD CONSTRAINT dt_result_relay_team_id_fkey      FOREIGN KEY (team_id)      REFERENCES mst_team(id);
ALTER TABLE dt_ranking_team  ADD CONSTRAINT dt_ranking_team_team_id_fkey      FOREIGN KEY (team_id)      REFERENCES mst_team(id);
ALTER TABLE mst_team_alias   ADD CONSTRAINT mst_team_alias_team_id_fkey       FOREIGN KEY (team_id)      REFERENCES mst_team(id);

ALTER TABLE dt_result_person ADD CONSTRAINT dt_result_person_meet_id_fkey     FOREIGN KEY (meet_id)      REFERENCES mst_event(id);
ALTER TABLE dt_result_relay  ADD CONSTRAINT dt_result_relay_meet_id_fkey      FOREIGN KEY (meet_id)      REFERENCES mst_event(id);
ALTER TABLE dt_ranking_team  ADD CONSTRAINT dt_ranking_team_meet_id_fkey      FOREIGN KEY (meet_id)      REFERENCES mst_event(id);

ALTER TABLE dt_result_person ADD CONSTRAINT dt_result_person_event_id_fkey    FOREIGN KEY (event_id)     REFERENCES mst_category(id);
ALTER TABLE dt_result_relay  ADD CONSTRAINT dt_result_relay_event_id_fkey     FOREIGN KEY (event_id)     REFERENCES mst_category(id);

ALTER TABLE dt_result_person ADD CONSTRAINT dt_result_person_age_group_id_fkey FOREIGN KEY (age_group_id) REFERENCES mst_age(id);


-- ============================================================
-- 確認（COMMIT前にコメントを外して目視確認推奨）
-- ============================================================
-- SELECT 'mst_team'     AS tbl, MIN(id), MAX(id), COUNT(*) FROM mst_team
-- UNION ALL SELECT 'mst_event',    MIN(id), MAX(id), COUNT(*) FROM mst_event
-- UNION ALL SELECT 'mst_category', MIN(id), MAX(id), COUNT(*) FROM mst_category
-- UNION ALL SELECT 'mst_age',      MIN(id), MAX(id), COUNT(*) FROM mst_age;

COMMIT;
