-- Restore ranked results that were present in the result PDFs but were
-- misparsed because the rank/name or athlete/team boundary had no whitespace.

DO $$
DECLARE
  event75_id INTEGER;
  event78_id INTEGER;
  matsudo_id INTEGER;
  keio_id INTEGER;
  minamiaoyama_id INTEGER;
  barnes_id INTEGER;
  corrigan_id INTEGER;
  tomoda_female_id INTEGER;
BEGIN
  SELECT id INTO STRICT event75_id FROM mst_event WHERE round = 75;
  SELECT id INTO STRICT event78_id FROM mst_event WHERE round = 78;
  SELECT id INTO STRICT matsudo_id FROM mst_team WHERE name = 'セ・松戸';
  SELECT id INTO STRICT keio_id FROM mst_team WHERE name = 'セ・慶應日吉';
  SELECT id INTO STRICT minamiaoyama_id FROM mst_team WHERE name = 'セ・南青山';

  SELECT id INTO STRICT barnes_id
  FROM dt_player_person
  WHERE name = 'バーンズノーマンウィ'
    AND gender = '男子'
    AND team_id = matsudo_id;

  SELECT id INTO STRICT corrigan_id
  FROM dt_player_person
  WHERE name = 'コリガンシェイ颯介'
    AND gender = '男子'
    AND team_id = keio_id;

  SELECT id INTO STRICT tomoda_female_id
  FROM dt_player_person
  WHERE name = '1友田智哲'
    AND gender = '女子'
    AND team_id = minamiaoyama_id;

  UPDATE dt_player_person
  SET name = '友田智哲'
  WHERE id = tomoda_female_id;

  UPDATE dt_result_person
  SET rank = 1,
      points = 10,
      team_points = 10
  WHERE event_id = event78_id
    AND player_id = tomoda_female_id
    AND race_number = 9
    AND time_display = '1:16.21';

  INSERT INTO dt_result_person (
    event_id, player_id, category_id, age_id, rank,
    time_seconds, time_display, points, team_points,
    meet_record_seconds, japan_record_seconds, world_record_seconds,
    is_meet_record, is_japan_record, is_world_record,
    race_number, lane
  )
  SELECT
    event75_id,
    values_to_insert.player_id,
    category.id,
    age.id,
    values_to_insert.rank,
    values_to_insert.time_seconds,
    values_to_insert.time_display,
    CASE
      WHEN values_to_insert.rank BETWEEN 1 AND 10
        THEN 11 - values_to_insert.rank
      ELSE 0
    END,
    CASE
      WHEN values_to_insert.rank BETWEEN 1 AND 10
        THEN 11 - values_to_insert.rank
      ELSE 0
    END,
    values_to_insert.meet_record_seconds,
    values_to_insert.japan_record_seconds,
    values_to_insert.world_record_seconds,
    FALSE,
    FALSE,
    FALSE,
    values_to_insert.race_number,
    values_to_insert.lane
  FROM (
    VALUES
      (barnes_id, 10, '100m自由形', '50～54歳', 10, 91.17::NUMERIC, '1:31.17', 60.40::NUMERIC, 54.61::NUMERIC, 54.15::NUMERIC, '3/5'),
      (barnes_id, 16, '50m自由形',  '50～54歳', 24, 37.95::NUMERIC, '37.95',   26.99::NUMERIC, 24.08::NUMERIC, 24.08::NUMERIC, '9/1'),
      (corrigan_id, 16, '50m自由形', '18～24歳', 15, 27.38::NUMERIC, '27.38', 22.80::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, '22/10'),
      (corrigan_id, 21, '50m平泳ぎ', '18～24歳', 8,  33.18::NUMERIC, '33.18', 29.28::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, '14/10')
  ) AS values_to_insert (
    player_id, race_number, category_name, age_name, rank,
    time_seconds, time_display, meet_record_seconds,
    japan_record_seconds, world_record_seconds, lane
  )
  INNER JOIN mst_category AS category
    ON category.name = values_to_insert.category_name
   AND category.gender = '男子'
   AND category.pool_type = '長水路'
  INNER JOIN mst_age AS age
    ON age.name = values_to_insert.age_name
   AND age.type = '個人'
  WHERE NOT EXISTS (
    SELECT 1
    FROM dt_result_person AS existing
    WHERE existing.event_id = event75_id
      AND existing.player_id = values_to_insert.player_id
      AND existing.race_number = values_to_insert.race_number
      AND existing.time_display = values_to_insert.time_display
  );
END
$$;
