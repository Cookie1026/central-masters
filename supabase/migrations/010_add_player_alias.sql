-- Migration 010: player canonical master and alias review table
--
-- Keep dt_player_person as meet/import data. mst_player stores a reviewed
-- canonical person, and mst_player_alias stores candidate/confirmed/rejected
-- links from source names to that canonical person.

CREATE TABLE IF NOT EXISTS mst_player (
  id             SERIAL PRIMARY KEY,
  canonical_name VARCHAR(100) NOT NULL,
  gender         VARCHAR(10)  NOT NULL CHECK (gender IN ('男子', '女子')),
  team_id        INTEGER      NOT NULL REFERENCES mst_team(id),
  note           TEXT,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (canonical_name, gender, team_id)
);

CREATE TABLE IF NOT EXISTS mst_player_alias (
  id               SERIAL PRIMARY KEY,
  player_id        INTEGER REFERENCES mst_player(id) ON DELETE SET NULL,
  alias_name       VARCHAR(100) NOT NULL,
  normalized_name  VARCHAR(100),
  gender           VARCHAR(10) CHECK (gender IN ('男子', '女子')),
  team_id          INTEGER REFERENCES mst_team(id),
  source_round     INTEGER,
  confidence       NUMERIC(5,2),
  status           VARCHAR(20) NOT NULL DEFAULT 'candidate'
                   CHECK (status IN ('candidate', 'confirmed', 'rejected')),
  reason           TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mst_player_alias_unique_confirmed
  ON mst_player_alias (alias_name, gender, team_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_mst_player_alias_player
  ON mst_player_alias (player_id);

CREATE INDEX IF NOT EXISTS idx_mst_player_alias_lookup
  ON mst_player_alias (normalized_name, gender, team_id, status);

ALTER TABLE mst_player DISABLE ROW LEVEL SECURITY;
ALTER TABLE mst_player_alias DISABLE ROW LEVEL SECURITY;

GRANT ALL ON mst_player TO service_role;
GRANT ALL ON mst_player_alias TO service_role;
GRANT SELECT ON mst_player TO anon, authenticated;
GRANT SELECT ON mst_player_alias TO anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE mst_player_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE mst_player_alias_id_seq TO service_role;
