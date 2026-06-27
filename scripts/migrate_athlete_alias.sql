-- ============================================================
-- mst_player_alias テーブル作成 + 初期エイリアス登録
-- Supabase ダッシュボードの SQL Editor で実行してください
-- ============================================================

-- 1. テーブル作成
CREATE TABLE IF NOT EXISTS mst_player_alias (
  alias          VARCHAR(100) PRIMARY KEY,
  canonical_name VARCHAR(100) NOT NULL
);

-- 2. エイリアス登録
INSERT INTO mst_player_alias (alias, canonical_name)
VALUES ('都築クラウディオ佑司', '都築クラウディオ佑亮')
ON CONFLICT (alias) DO UPDATE SET canonical_name = EXCLUDED.canonical_name;

-- 3. 既存の誤った選手名を修正
-- （都築クラウディオ佑司 が存在し、都築クラウディオ佑亮 が存在しない場合）
UPDATE dt_player_person
SET name = '都築クラウディオ佑亮'
WHERE name = '都築クラウディオ佑司'
  AND NOT EXISTS (
    SELECT 1 FROM dt_player_person p2
    WHERE p2.name = '都築クラウディオ佑亮'
      AND p2.team_id = dt_player_person.team_id
      AND p2.gender = dt_player_person.gender
  );

-- 4. 確認
SELECT * FROM mst_player_alias;
SELECT id, name, gender FROM dt_player_person WHERE name LIKE '都築%';
