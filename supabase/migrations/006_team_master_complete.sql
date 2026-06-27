-- ============================================================
-- Migration 006: チームマスター完成 + team_aliases
-- ============================================================

-- 1. display_name 列を追加
ALTER TABLE mst_team ADD COLUMN IF NOT EXISTS display_name VARCHAR(100);

-- 2. team_aliases テーブル作成
CREATE TABLE IF NOT EXISTS team_aliases (
  alias   VARCHAR(100) PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES mst_team(id)
);

-- 3. 不足チームを追加
INSERT INTO mst_team (name) VALUES ('CS南行徳') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('G-SPA') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('クリーンスパ') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('ザバス和光') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('ザバス川崎') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('ザバス藤が丘') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('ザバス金沢八景') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・F宇都宮') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・F東戸塚') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・S湘南台') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・亀有') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・前橋') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・千葉みなと') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・大泉学園') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・宇都宮') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・川崎') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・志津') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・新浦安') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・本八幡') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・本郷台') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・東十条') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・湘南LT') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・蒲田') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・蘇我') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・西台') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・西東京') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・越谷LT') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・郡山') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・長沼') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('セ・高崎') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('ミズノMT') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('浦安') ON CONFLICT (name) DO NOTHING;
INSERT INTO mst_team (name) VALUES ('芦屋海浜公園') ON CONFLICT (name) DO NOTHING;

-- 4. display_name 設定
UPDATE mst_team SET display_name = '曽谷' WHERE name = '曽谷・セ';

-- 5. OCRエイリアス登録
INSERT INTO team_aliases (alias, team_id) SELECT 'G−SPA', id FROM mst_team WHERE name = 'G-SPA' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'G－SPA', id FROM mst_team WHERE name = 'G-SPA' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'ザバス金沢ハ', id FROM mst_team WHERE name = 'ザバス金沢八景' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'ザバス金沢八', id FROM mst_team WHERE name = 'ザバス金沢八景' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'セ・八千代代', id FROM mst_team WHERE name = 'セ・八千代台' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'セ・溝ノロ', id FROM mst_team WHERE name = 'セ・溝ノ口' ON CONFLICT (alias) DO NOTHING;
INSERT INTO team_aliases (alias, team_id) SELECT 'セ・袖ケ浦', id FROM mst_team WHERE name = 'セ・袖ヶ浦' ON CONFLICT (alias) DO NOTHING;
