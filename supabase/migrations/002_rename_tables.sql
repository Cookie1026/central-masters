-- ============================================================
-- Migration 002: テーブルリネーム
-- Supabase ダッシュボード > SQL Editor で実行してください
-- PostgreSQL は ALTER TABLE RENAME で FK 参照を自動更新します
-- ============================================================

ALTER TABLE age_groups     RENAME TO mst_age;
ALTER TABLE events         RENAME TO mst_category;
ALTER TABLE matches        RENAME TO mst_event;
ALTER TABLE team_standings RENAME TO team_ranking;
ALTER TABLE teams          RENAME TO mst_team;
