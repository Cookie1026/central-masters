-- Rename the short-course tournament-record master table.
-- Before this migration:
--   mst_record_tournament      = short course
--   mst_record_tournament_long = long course
-- After this migration:
--   mst_record_tournament_short = short course
--   mst_record_tournament_long  = long course

DO $$
BEGIN
  IF to_regclass('public.mst_record_tournament_short') IS NULL
     AND to_regclass('public.mst_record_tournament') IS NOT NULL THEN
    ALTER TABLE public.mst_record_tournament RENAME TO mst_record_tournament_short;
  END IF;
END
$$;

ALTER INDEX IF EXISTS idx_mst_record_tournament_course_event
  RENAME TO idx_mst_record_tournament_short_course_event;
ALTER INDEX IF EXISTS idx_mst_record_tournament_gender
  RENAME TO idx_mst_record_tournament_short_gender;
ALTER INDEX IF EXISTS idx_mst_record_tournament_age
  RENAME TO idx_mst_record_tournament_short_age;

DO $$
DECLARE
  id_sequence regclass;
BEGIN
  SELECT pg_get_serial_sequence('public.mst_record_tournament_short', 'id')::regclass
    INTO id_sequence;

  IF id_sequence IS NOT NULL THEN
    EXECUTE format('ALTER SEQUENCE %s RENAME TO mst_record_tournament_short_id_seq', id_sequence);
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END
$$;

GRANT ALL ON mst_record_tournament_short TO service_role;
GRANT SELECT ON mst_record_tournament_short TO anon, authenticated;

DO $$
DECLARE
  id_sequence regclass;
BEGIN
  SELECT pg_get_serial_sequence('public.mst_record_tournament_short', 'id')::regclass
    INTO id_sequence;

  IF id_sequence IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', id_sequence);
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END
$$;

NOTIFY pgrst, 'reload schema';
