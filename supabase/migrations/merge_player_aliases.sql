-- ============================================================
-- player_alias 統合スクリプト
-- mst_player_alias に登録されたエイリアス名の選手レコードを
-- 正規名の選手に統合し、重複を解消する
-- ============================================================

DO $$
DECLARE
  alias_row      RECORD;
  alias_player   RECORD;
  canonical_id   INTEGER;
  updated_person INTEGER;
  updated_relay  INTEGER;
BEGIN
  FOR alias_row IN SELECT alias, canonical_name FROM mst_player_alias LOOP
    FOR alias_player IN
      SELECT id, name, team_id, gender
      FROM dt_player_person
      WHERE name = alias_row.alias
    LOOP
      -- 同チーム・同性別の正規選手を探す
      SELECT id INTO canonical_id
      FROM dt_player_person
      WHERE name = alias_row.canonical_name
        AND team_id = alias_player.team_id
        AND gender = alias_player.gender
      LIMIT 1;

      IF canonical_id IS NOT NULL AND canonical_id != alias_player.id THEN
        -- dt_result_person の参照を正規IDに更新
        UPDATE dt_result_person SET player_id = canonical_id
        WHERE player_id = alias_player.id;
        GET DIAGNOSTICS updated_person = ROW_COUNT;

        -- dt_player_relay の参照を正規IDに更新
        -- ただし同じ relay_result_id に canonical が既にいる場合は削除
        DELETE FROM dt_player_relay
        WHERE player_id = alias_player.id
          AND relay_result_id IN (
            SELECT relay_result_id FROM dt_player_relay WHERE player_id = canonical_id
          );

        UPDATE dt_player_relay SET player_id = canonical_id
        WHERE player_id = alias_player.id;
        GET DIAGNOSTICS updated_relay = ROW_COUNT;

        -- エイリアス選手を削除
        DELETE FROM dt_player_person WHERE id = alias_player.id;

        RAISE NOTICE '統合: "%" (id=%) → "%" (id=%) チームid=% | 個人=%件 リレー=%件',
          alias_row.alias, alias_player.id,
          alias_row.canonical_name, canonical_id,
          alias_player.team_id,
          updated_person, updated_relay;

      ELSIF canonical_id IS NULL THEN
        -- 正規選手がいない場合は名前だけ変更（同一レコードを再利用）
        UPDATE dt_player_person
        SET name = alias_row.canonical_name
        WHERE id = alias_player.id;

        RAISE NOTICE '改名: "%" (id=%) → "%" チームid=%',
          alias_row.alias, alias_player.id, alias_row.canonical_name, alias_player.team_id;
      END IF;
    END LOOP;
  END LOOP;
END $$;
