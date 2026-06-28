-- 大会・チーム単位の得点を競技結果から自主計算する監査ビュー。
-- 個人・リレーとも順位点は1位=10pt ... 10位=1pt。
-- 記録ボーナスは個人の大会新・日本新・世界新、リレーの大会新を各10pt加算する。
CREATE OR REPLACE VIEW v_team_point_audit
WITH (security_invoker = true)
AS
WITH point_rows AS (
  SELECT
    result.event_id,
    player.team_id,
    (
      CASE
        WHEN result.rank BETWEEN 1 AND 10 THEN 11 - result.rank
        ELSE 0
      END
      + CASE WHEN result.is_meet_record  THEN 10 ELSE 0 END
      + CASE WHEN result.is_japan_record THEN 10 ELSE 0 END
      + CASE WHEN result.is_world_record THEN 10 ELSE 0 END
    )::NUMERIC AS points
  FROM dt_result_person AS result
  INNER JOIN dt_player_person AS player
    ON player.id = result.player_id

  UNION ALL

  SELECT
    result.event_id,
    result.team_id,
    (
      CASE
        WHEN result.rank BETWEEN 1 AND 10 THEN 11 - result.rank
        ELSE 0
      END
      + CASE WHEN result.is_meet_record THEN 10 ELSE 0 END
    )::NUMERIC AS points
  FROM dt_result_relay AS result
)
SELECT
  event_id,
  team_id,
  SUM(points)::NUMERIC(9,2) AS calculated_points
FROM point_rows
GROUP BY event_id, team_id;

GRANT SELECT ON v_team_point_audit TO anon, authenticated, service_role;
