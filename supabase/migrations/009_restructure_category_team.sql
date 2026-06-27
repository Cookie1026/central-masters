-- Migration 009: mst_category / mst_team 再構築
-- mst_category : カラム順変更 + 個人種目を男女別2行に分割 + ID振り直し
-- mst_team     : カラム順変更 + セ・おおたかをid=1 + ID振り直し

BEGIN;

-- ============================================================
-- PART 1: mst_category
-- 新カラム順: id, pool_type, type, stroke, name, distance, gender
-- ============================================================

-- 1-1. 新テーブル（INTEGER PRIMARY KEY: 後でシーケンスを付ける）
CREATE TABLE mst_category_v2 (
  id          INTEGER      PRIMARY KEY,
  pool_type   VARCHAR(10)  NOT NULL CHECK (pool_type IN ('長水路', '短水路', '共通')),
  type        VARCHAR(10)  NOT NULL CHECK (type IN ('個人', 'リレー')),
  stroke      VARCHAR(50),
  name        VARCHAR(100) NOT NULL,
  distance    INTEGER,
  gender      VARCHAR(10)  NOT NULL CHECK (gender IN ('男子', '女子', '混合')),
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (name, pool_type, gender)
);

-- 1-2. 個人種目を男女別で挿入
--      順: pool_type(長→短) → distance → name → gender(男→女)
INSERT INTO mst_category_v2 (id, pool_type, type, stroke, name, distance, gender, created_at)
SELECT
  ROW_NUMBER() OVER (ORDER BY
    CASE pool_type WHEN '長水路' THEN 1 WHEN '短水路' THEN 2 ELSE 3 END,
    distance, name,
    CASE g WHEN '男子' THEN 1 ELSE 2 END
  )::INTEGER,
  pool_type, type, stroke, name, distance, g, created_at
FROM mst_category
CROSS JOIN (VALUES ('男子'::VARCHAR), ('女子'::VARCHAR)) AS gen(g)
WHERE type = '個人';

-- 1-3. リレー種目を挿入（個人の最大ID+1から連番）
INSERT INTO mst_category_v2 (id, pool_type, type, stroke, name, distance, gender, created_at)
SELECT
  (SELECT MAX(id) FROM mst_category_v2) +
  ROW_NUMBER() OVER (ORDER BY
    CASE pool_type WHEN '長水路' THEN 1 WHEN '短水路' THEN 2 ELSE 3 END,
    name,
    CASE gender WHEN '男子' THEN 1 WHEN '女子' THEN 2 ELSE 3 END
  )::INTEGER,
  pool_type, type, stroke, name, distance, gender, created_at
FROM mst_category
WHERE type = 'リレー';

-- 1-4. FK制約を先に削除（UPDATE前に行わないと新IDがFK違反になる）
ALTER TABLE dt_result_person DROP CONSTRAINT IF EXISTS dt_result_person_event_id_fkey;
ALTER TABLE dt_result_person DROP CONSTRAINT IF EXISTS individual_results_event_id_fkey;
ALTER TABLE dt_result_relay  DROP CONSTRAINT IF EXISTS dt_result_relay_event_id_fkey;
ALTER TABLE dt_result_relay  DROP CONSTRAINT IF EXISTS relay_results_event_id_fkey;

-- 1-5. dt_result_person の event_id を新IDに更新
--      個人種目: 選手(dt_player_person)の性別で正しい行を特定
UPDATE dt_result_person drp
SET event_id = mc_new.id
FROM mst_category mc_old,
     mst_category_v2 mc_new,
     dt_player_person dpp
WHERE drp.event_id    = mc_old.id
  AND drp.athlete_id  = dpp.id
  AND mc_old.type     = '個人'
  AND mc_new.name     = mc_old.name
  AND mc_new.pool_type= mc_old.pool_type
  AND mc_new.gender   = dpp.gender;

-- 1-6. dt_result_relay の event_id を新IDに更新（リレーは元々genderあり）
UPDATE dt_result_relay drr
SET event_id = mc_new.id
FROM mst_category mc_old,
     mst_category_v2 mc_new
WHERE drr.event_id    = mc_old.id
  AND mc_old.type     = 'リレー'
  AND mc_new.name     = mc_old.name
  AND mc_new.pool_type= mc_old.pool_type
  AND mc_new.gender   = mc_old.gender;

-- 1-7. テーブル入れ替え
ALTER TABLE mst_category    RENAME TO mst_category_backup;
ALTER TABLE mst_category_v2 RENAME TO mst_category;

-- 1-8. FK制約を再追加
ALTER TABLE dt_result_person ADD CONSTRAINT dt_result_person_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES mst_category(id);
ALTER TABLE dt_result_relay ADD CONSTRAINT dt_result_relay_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES mst_category(id);

-- 1-9. シーケンス設定（旧シーケンスをリネームして新規作成）
ALTER SEQUENCE IF EXISTS mst_category_id_seq RENAME TO mst_category_backup_id_seq;
CREATE SEQUENCE mst_category_id_seq;
SELECT setval('mst_category_id_seq', (SELECT MAX(id) FROM mst_category));
ALTER TABLE mst_category ALTER COLUMN id SET DEFAULT nextval('mst_category_id_seq');
GRANT USAGE, SELECT ON SEQUENCE mst_category_id_seq TO service_role;

-- 1-10. RLS無効化 + GRANT
ALTER TABLE mst_category DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON mst_category TO service_role;
GRANT SELECT ON mst_category TO anon, authenticated;

-- ============================================================
-- PART 2: mst_team
-- 新カラム順: id, name, display_name, prefecture, team_code
-- + セ・おおたか を id=1
-- ============================================================

-- 2-1. IDマッピング（セ・おおたか=0で先頭、残りは名前順）
CREATE TEMP TABLE team_id_map AS
SELECT
  id AS old_id,
  ROW_NUMBER() OVER (ORDER BY
    CASE WHEN name LIKE '%おおたか%' THEN 0 ELSE 1 END,
    name
  )::INTEGER AS new_id
FROM mst_team;

-- 2-2. 新テーブル
CREATE TABLE mst_team_v2 (
  id           INTEGER      PRIMARY KEY,
  name         VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(100),
  prefecture   VARCHAR(20),
  team_code    VARCHAR(20)  UNIQUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- 2-3. データ挿入（おおたかがid=1になる順序で）
INSERT INTO mst_team_v2 (id, name, display_name, prefecture, team_code, created_at)
SELECT tim.new_id, mt.name, mt.display_name, mt.prefecture, mt.team_code, mt.created_at
FROM mst_team mt
JOIN team_id_map tim ON mt.id = tim.old_id
ORDER BY tim.new_id;

-- 2-4. FK制約を先に削除（UPDATE前に行わないと新IDがFK違反になる）
ALTER TABLE dt_player_person DROP CONSTRAINT IF EXISTS dt_player_person_team_id_fkey;
ALTER TABLE dt_player_person DROP CONSTRAINT IF EXISTS athletes_team_id_fkey;
ALTER TABLE dt_result_relay  DROP CONSTRAINT IF EXISTS dt_result_relay_team_id_fkey;
ALTER TABLE dt_result_relay  DROP CONSTRAINT IF EXISTS relay_results_team_id_fkey;
ALTER TABLE dt_ranking_team  DROP CONSTRAINT IF EXISTS dt_ranking_team_team_id_fkey;
ALTER TABLE dt_ranking_team  DROP CONSTRAINT IF EXISTS team_standings_team_id_fkey;
ALTER TABLE mst_team_alias   DROP CONSTRAINT IF EXISTS mst_team_alias_team_id_fkey;
ALTER TABLE mst_team_alias   DROP CONSTRAINT IF EXISTS team_aliases_team_id_fkey;

-- 2-5. team_id を新IDに一括更新
UPDATE dt_player_person p   SET team_id = m.new_id FROM team_id_map m WHERE p.team_id   = m.old_id;
UPDATE dt_result_relay  r   SET team_id = m.new_id FROM team_id_map m WHERE r.team_id   = m.old_id;
UPDATE dt_ranking_team  t   SET team_id = m.new_id FROM team_id_map m WHERE t.team_id   = m.old_id;
UPDATE mst_team_alias   a   SET team_id = m.new_id FROM team_id_map m WHERE a.team_id   = m.old_id;

-- 2-6. テーブル入れ替え
ALTER TABLE mst_team    RENAME TO mst_team_backup;
ALTER TABLE mst_team_v2 RENAME TO mst_team;

-- 2-7. FK制約を再追加
ALTER TABLE dt_player_person ADD CONSTRAINT dt_player_person_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES mst_team(id);
ALTER TABLE dt_result_relay ADD CONSTRAINT dt_result_relay_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES mst_team(id);
ALTER TABLE dt_ranking_team ADD CONSTRAINT dt_ranking_team_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES mst_team(id);
ALTER TABLE mst_team_alias ADD CONSTRAINT mst_team_alias_team_id_fkey
  FOREIGN KEY (team_id) REFERENCES mst_team(id);

-- 2-8. シーケンス設定
ALTER SEQUENCE IF EXISTS mst_team_id_seq RENAME TO mst_team_backup_id_seq;
CREATE SEQUENCE mst_team_id_seq;
SELECT setval('mst_team_id_seq', (SELECT MAX(id) FROM mst_team));
ALTER TABLE mst_team ALTER COLUMN id SET DEFAULT nextval('mst_team_id_seq');
GRANT USAGE, SELECT ON SEQUENCE mst_team_id_seq TO service_role;

-- 2-9. RLS無効化 + GRANT
ALTER TABLE mst_team DISABLE ROW LEVEL SECURITY;
GRANT ALL    ON mst_team TO service_role;
GRANT SELECT ON mst_team TO anon, authenticated;

-- ============================================================
-- バックアップテーブル（動作確認後に削除してください）
-- DROP TABLE mst_category_backup;
-- DROP TABLE mst_team_backup;
-- DROP SEQUENCE mst_category_backup_id_seq;
-- DROP SEQUENCE mst_team_backup_id_seq;
-- ============================================================

COMMIT;
