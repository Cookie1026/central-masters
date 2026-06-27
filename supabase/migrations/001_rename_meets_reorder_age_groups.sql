-- ============================================================
-- Migration 001: meets → matches リネーム + age_groups id 振り直し
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

-- ① meets テーブルを matches にリネーム
--    FK参照 (individual_results, relay_results, team_standings) は自動更新される
ALTER TABLE meets RENAME TO matches;

-- ② age_groups id 振り直し (16～30 → 1～15)
--    individual_results のみ age_group_id FK を持つ（relay_results は age_group_label テキスト列）
ALTER TABLE individual_results DROP CONSTRAINT individual_results_age_group_id_fkey;

-- FK参照側を先に更新 (16→1, 17→2, ... 30→15)
UPDATE individual_results SET age_group_id = age_group_id - 15;

-- PKを更新 (既存値16-30を1-15へ。新値は元テーブルに存在しないので衝突なし)
UPDATE age_groups SET id = id - 15;

-- シーケンスを15にセット → 次のINSERTは16から始まる
SELECT setval('age_groups_id_seq', 15);

-- FK制約を再追加
ALTER TABLE individual_results
  ADD CONSTRAINT individual_results_age_group_id_fkey
  FOREIGN KEY (age_group_id) REFERENCES age_groups(id);
