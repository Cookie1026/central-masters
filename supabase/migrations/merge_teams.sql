-- チームマスター整理 (merge_teams.py で自動生成)
-- 1. 空name削除 / 2. 重複マージ / 3. 半角ASCII→全角変換

-- STEP 1: 空nameチーム削除（id=84 は別途実行済み）
-- DELETE FROM mst_team WHERE id = 84;

-- STEP 2: 重複チームマージ（プレイヤー重複を先に解消してからチームを統合）
DO $$
DECLARE
  -- (src_team_id, dst_team_id) のペア: src を dst に統合
  pairs INTEGER[] := ARRAY[63,53, 77,56, 79,72, 106,86];
  i          INTEGER;
  src_team   INTEGER;
  dst_team   INTEGER;
  sp         RECORD;
  dst_pid    INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    src_team := pairs[i*2-1];
    dst_team := pairs[i*2];

    -- ── プレイヤーレベルの重複解消 ──────────────────────────────
    FOR sp IN
      SELECT id, name, gender FROM dt_player_person WHERE team_id = src_team
    LOOP
      SELECT id INTO dst_pid
      FROM dt_player_person
      WHERE name = sp.name AND gender = sp.gender AND team_id = dst_team;

      IF dst_pid IS NOT NULL THEN
        -- 同名プレイヤーが宛先チームに存在 → 成績を付け替えて削除
        UPDATE dt_result_person SET player_id = dst_pid WHERE player_id = sp.id;
        -- 同一リレーに両方いる場合はsrc側を先に削除
        DELETE FROM dt_player_relay
        WHERE player_id = sp.id
          AND relay_result_id IN (
            SELECT relay_result_id FROM dt_player_relay WHERE player_id = dst_pid
          );
        UPDATE dt_player_relay SET player_id = dst_pid WHERE player_id = sp.id;
        DELETE FROM dt_player_person WHERE id = sp.id;
      ELSE
        -- 重複なし → team_id を更新
        UPDATE dt_player_person SET team_id = dst_team WHERE id = sp.id;
      END IF;
    END LOOP;

    -- ── チームレベルのマージ ────────────────────────────────────
    UPDATE dt_result_relay SET team_id = dst_team WHERE team_id = src_team;
    UPDATE mst_team_alias  SET team_id = dst_team WHERE team_id = src_team;

    INSERT INTO dt_ranking_team
      (event_id, team_id, rank, total_points, male_points, female_points, mixed_points)
    SELECT event_id, dst_team, rank, total_points, male_points, female_points, mixed_points
    FROM dt_ranking_team WHERE team_id = src_team
    ON CONFLICT (event_id, team_id) DO NOTHING;

    DELETE FROM dt_ranking_team WHERE team_id = src_team;
    DELETE FROM mst_team        WHERE id = src_team;

    RAISE NOTICE 'team % → % merged', src_team, dst_team;
  END LOOP;
END $$;

-- STEP 3: チーム名の半角ASCII→全角変換
UPDATE mst_team SET name = 'ＣＳ南行徳' WHERE id = 2;  -- CS南行徳
UPDATE mst_team SET name = 'セ・Ｆ宇都宮' WHERE id = 50;  -- セ・F宇都宮
UPDATE mst_team SET name = 'セ・湘南ＬＴ' WHERE id = 62;  -- セ・湘南LT
UPDATE mst_team SET name = 'セ・Ｆ東戸塚' WHERE id = 66;  -- セ・F東戸塚
UPDATE mst_team SET name = 'セ・越谷ＬＴ' WHERE id = 68;  -- セ・越谷LT
UPDATE mst_team SET name = 'ザバス鶴見' WHERE id = 72;  -- ザパス鶴見
UPDATE mst_team SET name = 'Ｇ－ＳＰＡ' WHERE id = 86;  -- G-SPA
UPDATE mst_team SET name = 'セ・Ｓ湘南台' WHERE id = 90;  -- セ・S湘南台
UPDATE mst_team SET name = 'ミズノＭＴ' WHERE id = 96;  -- ミズノMT

-- STEP 4: mst_team_alias の alias/team名も全角変換（必要に応じて実行）
