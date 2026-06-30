-- テーブル名変更: mst_meet_records → mst_record_tournament
ALTER TABLE mst_meet_records RENAME TO mst_record_tournament;
ALTER INDEX idx_mst_meet_records_course_event RENAME TO idx_mst_record_tournament_course_event;
ALTER INDEX idx_mst_meet_records_gender       RENAME TO idx_mst_record_tournament_gender;
ALTER INDEX idx_mst_meet_records_age          RENAME TO idx_mst_record_tournament_age;

-- 権限付与
GRANT ALL    ON mst_record_tournament TO service_role;
GRANT SELECT ON mst_record_tournament TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE mst_meet_records_id_seq TO service_role;
