-- ============================================================
-- Migration 003: データテーブルリネーム
-- Supabase ダッシュボード > SQL Editor で実行してください
-- ============================================================

ALTER TABLE athletes           RENAME TO dt_player_person;
ALTER TABLE individual_results RENAME TO dt_result_person;
ALTER TABLE relay_members      RENAME TO dt_player_relay;
ALTER TABLE relay_results      RENAME TO dt_result_relay;
