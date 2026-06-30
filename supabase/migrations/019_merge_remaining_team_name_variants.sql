-- 同一クラブとして取り込まれていた残存表記ゆれを統合する。
--   ザバス金沢八 (73) -> ザバス八景 (70)
--   南行徳       (23) -> ＣＳ南行徳 (3)
DO $$
DECLARE
  pair RECORD;
  source_player RECORD;
  target_player_id INTEGER;
BEGIN
  FOR pair IN
    SELECT *
    FROM (VALUES
      (73, 70),
      (23, 3)
    ) AS pairs(source_team_id, target_team_id)
  LOOP
    -- すでに統合済みなら何もしない。
    IF NOT EXISTS (
      SELECT 1 FROM mst_team WHERE id = pair.source_team_id
    ) THEN
      CONTINUE;
    END IF;

    FOR source_player IN
      SELECT id, name, gender
      FROM dt_player_person
      WHERE team_id = pair.source_team_id
    LOOP
      SELECT id INTO target_player_id
      FROM dt_player_person
      WHERE team_id = pair.target_team_id
        AND name = source_player.name
        AND gender = source_player.gender;

      IF target_player_id IS NULL THEN
        UPDATE dt_player_person
        SET team_id = pair.target_team_id
        WHERE id = source_player.id;
      ELSE
        UPDATE dt_result_person
        SET player_id = target_player_id
        WHERE player_id = source_player.id;

        UPDATE dt_player_relay
        SET player_id = target_player_id
        WHERE player_id = source_player.id;

        DELETE FROM dt_player_person
        WHERE id = source_player.id;
      END IF;
    END LOOP;

    UPDATE dt_result_relay
    SET team_id = pair.target_team_id
    WHERE team_id = pair.source_team_id;

    UPDATE mst_team_alias
    SET team_id = pair.target_team_id
    WHERE team_id = pair.source_team_id;

    INSERT INTO dt_ranking_team
      (event_id, team_id, rank, total_points, male_points, female_points, mixed_points)
    SELECT
      event_id,
      pair.target_team_id,
      rank,
      total_points,
      male_points,
      female_points,
      mixed_points
    FROM dt_ranking_team
    WHERE team_id = pair.source_team_id
    ON CONFLICT (event_id, team_id) DO NOTHING;

    DELETE FROM dt_ranking_team
    WHERE team_id = pair.source_team_id;

    DELETE FROM mst_team
    WHERE id = pair.source_team_id;
  END LOOP;

  INSERT INTO mst_team_alias (alias, team_id)
  VALUES
    ('ザバス金沢八', 70),
    ('ザバス金沢八景', 70),
    ('南行徳', 3),
    ('CS南行徳', 3)
  ON CONFLICT (alias) DO UPDATE
  SET team_id = EXCLUDED.team_id;
END
$$;
