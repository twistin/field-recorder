CREATE TABLE IF NOT EXISTS catalog_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
  equipment_preset TEXT NOT NULL,
  point_count INTEGER NOT NULL DEFAULT 0,
  photo_count INTEGER NOT NULL DEFAULT 0,
  audio_take_count INTEGER NOT NULL DEFAULT 0,
  cloud_sync_status TEXT,
  cloud_synced_at TIMESTAMPTZ,
  cloud_manifest_path TEXT,
  cloud_manifest_url TEXT,
  snapshot_json JSONB NOT NULL,
  created_in_catalog_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_sessions_started_at
  ON catalog_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS session_points (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES catalog_sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  gps_accuracy_m DOUBLE PRECISION,
  place_name TEXT NOT NULL,
  habitat TEXT NOT NULL DEFAULT '',
  characteristics TEXT NOT NULL DEFAULT '',
  observed_weather TEXT NOT NULL DEFAULT '',
  automatic_weather JSONB,
  detected_place JSONB,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  zoom_take_reference TEXT NOT NULL DEFAULT '',
  microphone_setup TEXT NOT NULL DEFAULT '',
  photo_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_session_points_session_id
  ON session_points (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS point_photos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES catalog_sessions(id) ON DELETE CASCADE,
  point_id TEXT NOT NULL REFERENCES session_points(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  cloud_path TEXT,
  cloud_url TEXT,
  cloud_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_point_photos_session_id
  ON point_photos (session_id, point_id, ordinal);

CREATE TABLE IF NOT EXISTS audio_takes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES catalog_sessions(id) ON DELETE CASCADE,
  associated_point_id TEXT REFERENCES session_points(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  last_modified TIMESTAMPTZ NOT NULL,
  inferred_recorded_at TIMESTAMPTZ NOT NULL,
  matched_by TEXT NOT NULL,
  confidence TEXT NOT NULL,
  matched_point_delta_minutes INTEGER,
  detected_reference TEXT NOT NULL DEFAULT '',
  duration_seconds DOUBLE PRECISION,
  sample_rate_hz INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  input_setup TEXT NOT NULL DEFAULT '',
  low_cut_enabled BOOLEAN,
  limiter_enabled BOOLEAN,
  phantom_power_enabled BOOLEAN,
  take_notes TEXT NOT NULL DEFAULT '',
  cloud_path TEXT,
  cloud_url TEXT,
  cloud_synced_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_audio_takes_session_id
  ON audio_takes (session_id, inferred_recorded_at DESC);

CREATE TABLE IF NOT EXISTS published_selections (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  point_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  audio_take_id TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  project_name TEXT NOT NULL DEFAULT '',
  session_name TEXT NOT NULL,
  point_name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  audio_url TEXT NOT NULL,
  image_file_name TEXT NOT NULL,
  audio_file_name TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_published_selections_session_id
  ON published_selections (session_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_published_selections_point_id
  ON published_selections (point_id, published_at DESC);
