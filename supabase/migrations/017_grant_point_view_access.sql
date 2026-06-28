-- SQL Editor等で作成したビューをAPIから参照できるようにする。
GRANT SELECT ON v_player_point TO anon, authenticated, service_role;
GRANT SELECT ON v_team_point_audit TO anon, authenticated, service_role;
