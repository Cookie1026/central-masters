-- 大会・選手単位の獲得ポイントを一元集計する。
-- リレーはチーム得点を4人で均等配分する。
CREATE OR REPLACE VIEW v_player_point
WITH (security_invoker = true)
AS
WITH point_rows AS (
  SELECT
    event_id,
    player_id,
    COALESCE(points, 0)::NUMERIC AS individual_points,
    0::NUMERIC AS relay_points
  FROM dt_result_person

  UNION ALL

  SELECT
    relay.event_id,
    member.player_id,
    0::NUMERIC AS individual_points,
    (COALESCE(relay.team_points, 0) / 4.0)::NUMERIC AS relay_points
  FROM dt_player_relay AS member
  INNER JOIN dt_result_relay AS relay
    ON relay.id = member.relay_result_id
)
SELECT
  event_id,
  player_id,
  SUM(individual_points)::NUMERIC(9,2) AS individual_points,
  SUM(relay_points)::NUMERIC(9,2) AS relay_points,
  SUM(individual_points + relay_points)::NUMERIC(9,2) AS total_points
FROM point_rows
GROUP BY event_id, player_id;

GRANT SELECT ON v_player_point TO anon, authenticated, service_role;
