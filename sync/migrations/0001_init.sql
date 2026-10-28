-- Esmeworld sync: initial schema (see docs/superpowers/specs/2026-10-28-sync-api.md).

-- One row per synced record. `data` is the row's JSON object stored verbatim
-- (opaque to the server). `seq` is the server sequence number of the last write.
CREATE TABLE rows (
  tbl        TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  device_id  TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  data       TEXT    NOT NULL,
  PRIMARY KEY (tbl, id)
);
CREATE INDEX rows_seq ON rows (seq);

-- Counters. `seq` holds the highest sequence number handed out so far.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('seq', 0);

-- Failed authentication attempts, for rate limiting. Never stores the presented token.
CREATE TABLE auth_failures (
  ip TEXT    NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX auth_failures_ts ON auth_failures (ts);
CREATE INDEX auth_failures_ip_ts ON auth_failures (ip, ts);
