-- チーム名の誤字修正
-- 「颯介セ・慶應日吉」(id=98, OCR誤読) を既存の「セ・慶應日吉」にマージして削除
DO $$
DECLARE
  src_id  INTEGER := 98;  -- 颯介セ・慶應日吉（誤読）
  dst_id  INTEGER;
  sp      RECORD;
  dst_pid INTEGER;
BEGIN
  SELECT id INTO dst_id FROM mst_team WHERE name = 'セ・慶應日吉';
  IF dst_id IS NULL THEN
    RAISE EXCEPTION '宛先チーム「セ・慶應日吉」が見つかりません';
  END IF;
  RAISE NOTICE 'Merging team % → %', src_id, dst_id;

  -- プレイヤーレベルのマージ
  FOR sp IN SELECT id, name, gender FROM dt_player_person WHERE team_id = src_id LOOP
    SELECT id INTO dst_pid FROM dt_player_person
    WHERE name = sp.name AND gender = sp.gender AND team_id = dst_id;

    IF dst_pid IS NOT NULL THEN
      UPDATE dt_result_person SET player_id = dst_pid WHERE player_id = sp.id;
      DELETE FROM dt_player_relay
        WHERE player_id = sp.id
          AND relay_result_id IN (SELECT relay_result_id FROM dt_player_relay WHERE player_id = dst_pid);
      UPDATE dt_player_relay SET player_id = dst_pid WHERE player_id = sp.id;
      DELETE FROM dt_player_person WHERE id = sp.id;
    ELSE
      UPDATE dt_player_person SET team_id = dst_id WHERE id = sp.id;
    END IF;
  END LOOP;

  -- チームレベルのマージ
  UPDATE dt_result_relay SET team_id = dst_id WHERE team_id = src_id;
  UPDATE mst_team_alias  SET team_id = dst_id WHERE team_id = src_id;

  INSERT INTO dt_ranking_team
    (event_id, team_id, rank, total_points, male_points, female_points, mixed_points)
  SELECT event_id, dst_id, rank, total_points, male_points, female_points, mixed_points
  FROM dt_ranking_team WHERE team_id = src_id
  ON CONFLICT (event_id, team_id) DO NOTHING;

  DELETE FROM dt_ranking_team WHERE team_id = src_id;
  DELETE FROM mst_team WHERE id = src_id;

  RAISE NOTICE 'Done: team % deleted, merged into %', src_id, dst_id;
END $$;
