-- Migration 027: 失格コード・棄権フラグ追加
-- dt_result_person と dt_result_relay に disqualification_code / is_withdrawal を追加

ALTER TABLE dt_result_person
  ADD COLUMN IF NOT EXISTS disqualification_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS is_withdrawal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE dt_result_relay
  ADD COLUMN IF NOT EXISTS disqualification_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS is_withdrawal BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN dt_result_person.disqualification_code IS '失格コード（mst_disqualification.code と対応）。NULL = 棄権または正常終了';
COMMENT ON COLUMN dt_result_person.is_withdrawal         IS '棄権フラグ（TRUE = 棄権/DNS）';
COMMENT ON COLUMN dt_result_relay.disqualification_code  IS '失格コード（mst_disqualification.code と対応）。NULL = 棄権または正常終了';
COMMENT ON COLUMN dt_result_relay.is_withdrawal          IS '棄権フラグ（TRUE = 棄権/DNS）';

-- インデックス（失格一覧の絞り込み用）
CREATE INDEX IF NOT EXISTS idx_dt_result_person_dq
  ON dt_result_person (disqualification_code) WHERE disqualification_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dt_result_person_withdrawal
  ON dt_result_person (is_withdrawal) WHERE is_withdrawal = TRUE;
CREATE INDEX IF NOT EXISTS idx_dt_result_relay_dq
  ON dt_result_relay (disqualification_code) WHERE disqualification_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dt_result_relay_withdrawal
  ON dt_result_relay (is_withdrawal) WHERE is_withdrawal = TRUE;
