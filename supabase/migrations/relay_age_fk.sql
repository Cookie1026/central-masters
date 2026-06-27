-- ============================================================
-- リレー年齢区分 FK化マイグレーション
-- 全ステップを1つのDO$$ブロックに統合（トランザクション保証）
-- ============================================================
DO $$
DECLARE
  r        RECORD;
BEGIN

  -- STEP 1: type カラム追加
  EXECUTE 'ALTER TABLE mst_age ADD COLUMN IF NOT EXISTS type VARCHAR(10) NOT NULL DEFAULT ''個人'' CHECK (type IN (''個人'', ''リレー''))';

  -- STEP 2: dt_result_relay の age_id 列・FK を先に削除（後続の DELETE で FK 違反を防ぐ）
  EXECUTE 'ALTER TABLE dt_result_relay DROP CONSTRAINT IF EXISTS dt_result_relay_age_id_fkey';
  EXECUTE 'ALTER TABLE dt_result_relay DROP COLUMN IF EXISTS age_id';

  -- STEP 3: 名前を正規化（WAVE DASH → FULLWIDTH TILDE）
  --         正規化後の名前が同じ type で既に存在する場合は WAVE DASH 側を先に削除
  DELETE FROM mst_age a
  WHERE a.name LIKE '%〜%'
    AND EXISTS (
      SELECT 1 FROM mst_age b
      WHERE b.name = REPLACE(a.name, '〜', '～')
        AND b.type = a.type
    );
  UPDATE mst_age SET name = REPLACE(name, '〜', '～') WHERE name LIKE '%〜%';

  -- STEP 4: dt_result_relay.age_group_label と一致する mst_age 行を type='リレー' に更新
  UPDATE mst_age a
  SET type = 'リレー'
  FROM (
    SELECT DISTINCT REPLACE(TRIM(age_group_label), '〜', '～') AS label
    FROM dt_result_relay
    WHERE age_group_label IS NOT NULL AND TRIM(age_group_label) <> ''
  ) sub
  WHERE a.name = sub.label;

  -- STEP 5: 同 (name, type) の重複を除去
  DELETE FROM mst_age a
  USING mst_age b
  WHERE a.id > b.id
    AND a.name = b.name
    AND a.type = b.type;

  -- STEP 6: mst_age の UNIQUE 制約をすべて削除（名前不問）
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'mst_age'
      AND nsp.nspname = 'public'
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE mst_age DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;

  -- STEP 7: (name, type) UNIQUE 制約を追加
  EXECUTE 'ALTER TABLE mst_age ADD CONSTRAINT mst_age_name_type_key UNIQUE (name, type)';

  -- STEP 8: 既存のリレー年齢区分を削除してクリーンにする
  DELETE FROM mst_age WHERE type = 'リレー';

  -- STEP 9: リレー年齢区分を min_age 昇順で挿入
  --         GROUP BY で名前ごとに1行に集約（SELECT DISTINCT は max_age の差異を見落とす場合がある）
  INSERT INTO mst_age (name, min_age, max_age, type)
  SELECT
    name,
    MIN(min_age) AS min_age,
    MIN(max_age) AS max_age,
    'リレー' AS type
  FROM (
    SELECT
      REPLACE(TRIM(age_group_label), '〜', '～') AS name,
      CAST(REGEXP_REPLACE(TRIM(age_group_label), '^(\d+).*', '\1') AS INTEGER) AS min_age,
      CASE
        WHEN age_group_label LIKE '%以上' THEN NULL
        ELSE CAST(REGEXP_REPLACE(TRIM(age_group_label), '.*[～〜](\d+)歳.*', '\1') AS INTEGER)
      END AS max_age
    FROM dt_result_relay
    WHERE age_group_label IS NOT NULL AND TRIM(age_group_label) <> ''
  ) sub
  GROUP BY name
  ORDER BY MIN(min_age);

  -- STEP 10: dt_result_relay に age_id カラムを追加
  EXECUTE 'ALTER TABLE dt_result_relay ADD COLUMN age_id INTEGER';

  -- STEP 11: 既存データの age_id を設定
  UPDATE dt_result_relay AS rr
  SET age_id = a.id
  FROM mst_age a
  WHERE a.name = REPLACE(TRIM(rr.age_group_label), '〜', '～')
    AND a.type = 'リレー'
    AND rr.age_group_label IS NOT NULL;

  -- STEP 12: FK制約を追加
  EXECUTE 'ALTER TABLE dt_result_relay ADD CONSTRAINT dt_result_relay_age_id_fkey FOREIGN KEY (age_id) REFERENCES mst_age(id)';

  -- STEP 13: インデックス
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_dt_result_relay_age ON dt_result_relay (age_id)';

  RAISE NOTICE 'relay_age_fk migration completed successfully';
END $$;
