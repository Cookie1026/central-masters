-- 第80回結果PDFを正として、CSV生成時に成瀬へ誤転記された成城の成績を修正する。
-- 公式得点との差: 成城 -95pt / 成瀬 +95pt
DO $$
DECLARE
  event80_id INTEGER;
  seijo_id INTEGER;
  naruse_id INTEGER;
  fixed_relays INTEGER;
  remaining_wrong_rows INTEGER;
BEGIN
  SELECT id INTO STRICT event80_id
  FROM mst_event
  WHERE round = 80;

  SELECT id INTO STRICT seijo_id
  FROM mst_team
  WHERE name = 'セ・成城';

  SELECT id INTO STRICT naruse_id
  FROM mst_team
  WHERE name = 'セ・成瀬';

  -- PDFでは4件とも所属が「セ・成城」。
  UPDATE dt_result_person AS result
  SET player_id = correct_player.id
  FROM dt_player_person AS wrong_player
  INNER JOIN dt_player_person AS correct_player
    ON correct_player.name = wrong_player.name
   AND correct_player.gender = wrong_player.gender
   AND correct_player.team_id = seijo_id
  WHERE result.event_id = event80_id
    AND result.player_id = wrong_player.id
    AND wrong_player.team_id = naruse_id
    AND wrong_player.name IN ('中田正二', '服部碧', '黒田大介');

  SELECT COUNT(*) INTO remaining_wrong_rows
  FROM dt_result_person AS result
  INNER JOIN dt_player_person AS player
    ON player.id = result.player_id
  WHERE result.event_id = event80_id
    AND player.team_id = naruse_id
    AND player.name IN ('中田正二', '服部碧', '黒田大介');

  IF remaining_wrong_rows <> 0 THEN
    RAISE EXCEPTION
      'Round 80 still has % misassigned individual results',
      remaining_wrong_rows;
  END IF;

  CREATE TEMP TABLE round80_seijo_relays ON COMMIT DROP AS
  SELECT relay.id
  FROM dt_result_relay AS relay
  INNER JOIN mst_category AS category
    ON category.id = relay.category_id
  WHERE relay.event_id = event80_id
    AND relay.team_id IN (seijo_id, naruse_id)
    AND (
      (relay.race_number = 3 AND category.gender = '女子'
        AND category.name = '4×50mフリーリレー'
        AND relay.age_group_label = '200～239歳')
      OR
      (relay.race_number = 4 AND category.gender = '男子'
        AND category.name = '4×50mフリーリレー'
        AND relay.age_group_label IN ('280～319歳', '72～119歳'))
      OR
      (relay.race_number = 5 AND category.gender = '女子'
        AND category.name = '4×100mフリーリレー'
        AND relay.age_group_label = '120～159歳')
      OR
      (relay.race_number = 6 AND category.gender = '男子'
        AND category.name = '4×100mフリーリレー'
        AND relay.age_group_label = '120～159歳')
    );

  SELECT COUNT(*) INTO fixed_relays
  FROM round80_seijo_relays;

  IF fixed_relays <> 5 THEN
    RAISE EXCEPTION
      'Expected to find 5 relay results, but found %',
      fixed_relays;
  END IF;

  UPDATE dt_player_relay AS member
  SET player_id = correct_player.id
  FROM dt_player_person AS wrong_player
  INNER JOIN dt_player_person AS correct_player
    ON correct_player.name = wrong_player.name
   AND correct_player.gender = wrong_player.gender
   AND correct_player.team_id = seijo_id
  WHERE member.relay_result_id IN (SELECT id FROM round80_seijo_relays)
    AND member.player_id = wrong_player.id
    AND wrong_player.team_id = naruse_id;

  SELECT COUNT(*) INTO remaining_wrong_rows
  FROM dt_player_relay AS member
  INNER JOIN dt_player_person AS player
    ON player.id = member.player_id
  WHERE member.relay_result_id IN (SELECT id FROM round80_seijo_relays)
    AND player.team_id = naruse_id;

  IF remaining_wrong_rows <> 0 THEN
    RAISE EXCEPTION
      'Round 80 still has % misassigned relay members',
      remaining_wrong_rows;
  END IF;

  UPDATE dt_result_relay
  SET team_id = seijo_id
  WHERE id IN (SELECT id FROM round80_seijo_relays);

  SELECT COUNT(*) INTO remaining_wrong_rows
  FROM dt_result_relay
  WHERE id IN (SELECT id FROM round80_seijo_relays)
    AND team_id <> seijo_id;

  IF remaining_wrong_rows <> 0 THEN
    RAISE EXCEPTION
      'Round 80 still has % misassigned relay results',
      remaining_wrong_rows;
  END IF;
END
$$;
