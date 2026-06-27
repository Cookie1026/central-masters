-- mst_team.id を prefecture 昇順（NULL末尾）、同一prefecture内は name 昇順で 1 から振り直す
DO $$
DECLARE
  con RECORD;
BEGIN

  -- STEP 1: 新旧IDマッピングを一時テーブルに作成
  CREATE TEMP TABLE team_id_map AS
  SELECT
    id AS old_id,
    ROW_NUMBER() OVER (ORDER BY prefecture NULLS LAST, name) AS new_id
  FROM mst_team;

  -- STEP 2: mst_team を参照する FK 制約を動的に削除
  FOR con IN
    SELECT tc.constraint_name, tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema   = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema   = rc.constraint_schema
    JOIN information_schema.table_constraints tc2
      ON rc.unique_constraint_name   = tc2.constraint_name
      AND rc.unique_constraint_schema = tc2.table_schema
    WHERE tc2.table_name = 'mst_team'
      AND tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',
      con.table_name, con.constraint_name);
    RAISE NOTICE 'Dropped FK: %.%', con.table_name, con.constraint_name;
  END LOOP;

  -- STEP 3: 子テーブルの team_id を新IDに更新
  -- dt_ranking_team は UNIQUE(event_id, team_id) があるため負値を経由して衝突を回避
  UPDATE dt_player_person p SET team_id =  m.new_id FROM team_id_map m WHERE p.team_id = m.old_id;
  UPDATE dt_result_relay  r SET team_id =  m.new_id FROM team_id_map m WHERE r.team_id = m.old_id;
  UPDATE dt_ranking_team  t SET team_id = -m.new_id FROM team_id_map m WHERE t.team_id = m.old_id;
  UPDATE dt_ranking_team    SET team_id = -team_id  WHERE team_id < 0;
  UPDATE mst_team_alias   a SET team_id =  m.new_id FROM team_id_map m WHERE a.team_id = m.old_id;

  -- STEP 4: mst_team.id 自体を更新（衝突回避のため一旦負値に）
  UPDATE mst_team t SET id = -m.new_id FROM team_id_map m WHERE t.id = m.old_id;
  UPDATE mst_team SET id = -id WHERE id < 0;

  -- STEP 5: シーケンスをリセット
  PERFORM setval('mst_team_id_seq', (SELECT MAX(id) FROM mst_team));

  -- STEP 6: FK 制約を再作成
  ALTER TABLE dt_player_person ADD CONSTRAINT dt_player_person_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES mst_team(id);
  ALTER TABLE dt_result_relay  ADD CONSTRAINT dt_result_relay_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES mst_team(id);
  ALTER TABLE dt_ranking_team  ADD CONSTRAINT dt_ranking_team_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES mst_team(id);
  ALTER TABLE mst_team_alias   ADD CONSTRAINT mst_team_alias_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES mst_team(id);

  DROP TABLE team_id_map;
  RAISE NOTICE 'mst_team IDs renumbered by prefecture';
END $$;
