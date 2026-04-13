import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

import type {
  CatalogSessionPayload,
  CatalogSessionSummary,
  CatalogSyncResult,
} from '../../src/lib/catalogPayload';
import type { PublishSelectionPayload, PublishedSelection } from '../../src/types/publishedSelections';

type Sql = NeonQueryFunction<false, false>;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS catalog_sessions (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_sessions_started_at
    ON catalog_sessions (started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS session_points (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_points_session_id
    ON session_points (session_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS point_photos (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES catalog_sessions(id) ON DELETE CASCADE,
    point_id TEXT NOT NULL REFERENCES session_points(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    cloud_path TEXT,
    cloud_url TEXT,
    cloud_synced_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_point_photos_session_id
    ON point_photos (session_id, point_id, ordinal)`,
  `CREATE TABLE IF NOT EXISTS audio_takes (
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
    take_notes TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audio_takes_session_id
    ON audio_takes (session_id, inferred_recorded_at DESC)`,
  `ALTER TABLE audio_takes ADD COLUMN IF NOT EXISTS cloud_path TEXT`,
  `ALTER TABLE audio_takes ADD COLUMN IF NOT EXISTS cloud_url TEXT`,
  `ALTER TABLE audio_takes ADD COLUMN IF NOT EXISTS cloud_synced_at TIMESTAMPTZ`,
  `CREATE TABLE IF NOT EXISTS published_selections (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_published_selections_session_id
    ON published_selections (session_id, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_published_selections_point_id
    ON published_selections (point_id, published_at DESC)`,
];

let schemaReadyPromise: Promise<void> | null = null;

function getDatabaseUrl(): string {
  const databaseUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NO_POOLING;
  if (!databaseUrl) {
    throw new Error('Missing DATABASE_URL or POSTGRES_URL.');
  }

  return databaseUrl;
}

function getSql(): Sql {
  return neon(getDatabaseUrl());
}

function toIsoString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(String(value)).toISOString();
}

function countPhotos(session: CatalogSessionPayload): number {
  return session.points.reduce((count, point) => count + point.photos.length, 0);
}

function normalizePublishedSelection(
  row: Omit<PublishedSelection, 'publishedAt' | 'updatedAt'> & {
    publishedAt: string | Date;
    updatedAt: string | Date;
  },
): PublishedSelection {
  return {
    ...row,
    publishedAt: toIsoString(row.publishedAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

async function ensureCatalogSchema(): Promise<void> {
  if (schemaReadyPromise) {
    return await schemaReadyPromise;
  }

  const sql = getSql();
  schemaReadyPromise = sql
    .transaction((tx) => SCHEMA_STATEMENTS.map((statement) => tx.query(statement)))
    .then(() => undefined)
    .catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });

  return await schemaReadyPromise;
}

export async function upsertCatalogSession(session: CatalogSessionPayload): Promise<CatalogSyncResult> {
  await ensureCatalogSchema();

  const sql = getSql();
  const syncedAt = new Date().toISOString();
  const pointCount = session.points.length;
  const photoCount = countPhotos(session);
  const audioTakeCount = session.audioTakes.length;
  const snapshotJson = JSON.stringify(session);

  const queries = [
    sql.query(
      `INSERT INTO catalog_sessions (
        id,
        name,
        project_name,
        region,
        notes,
        created_at,
        started_at,
        ended_at,
        status,
        equipment_preset,
        point_count,
        photo_count,
        audio_take_count,
        cloud_sync_status,
        cloud_synced_at,
        cloud_manifest_path,
        cloud_manifest_url,
        snapshot_json,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18::jsonb, $19
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        project_name = EXCLUDED.project_name,
        region = EXCLUDED.region,
        notes = EXCLUDED.notes,
        created_at = EXCLUDED.created_at,
        started_at = EXCLUDED.started_at,
        ended_at = EXCLUDED.ended_at,
        status = EXCLUDED.status,
        equipment_preset = EXCLUDED.equipment_preset,
        point_count = EXCLUDED.point_count,
        photo_count = EXCLUDED.photo_count,
        audio_take_count = EXCLUDED.audio_take_count,
        cloud_sync_status = EXCLUDED.cloud_sync_status,
        cloud_synced_at = EXCLUDED.cloud_synced_at,
        cloud_manifest_path = EXCLUDED.cloud_manifest_path,
        cloud_manifest_url = EXCLUDED.cloud_manifest_url,
        snapshot_json = EXCLUDED.snapshot_json,
        updated_at = EXCLUDED.updated_at`,
      [
        session.id,
        session.name,
        session.projectName,
        session.region,
        session.notes,
        session.createdAt,
        session.startedAt,
        session.endedAt ?? null,
        session.status,
        session.equipmentPreset,
        pointCount,
        photoCount,
        audioTakeCount,
        session.cloudSyncStatus ?? null,
        session.cloudSyncedAt ?? null,
        session.cloudManifestPath ?? null,
        session.cloudManifestUrl ?? null,
        snapshotJson,
        syncedAt,
      ],
    ),
    sql.query('DELETE FROM point_photos WHERE session_id = $1', [session.id]),
    sql.query('DELETE FROM audio_takes WHERE session_id = $1', [session.id]),
    sql.query('DELETE FROM session_points WHERE session_id = $1', [session.id]),
  ];

  session.points.forEach((point, pointIndex) => {
    queries.push(
      sql.query(
        `INSERT INTO session_points (
          id,
          session_id,
          ordinal,
          created_at,
          latitude,
          longitude,
          gps_accuracy_m,
          place_name,
          habitat,
          characteristics,
          observed_weather,
          automatic_weather,
          detected_place,
          tags_json,
          notes,
          zoom_take_reference,
          microphone_setup,
          photo_count
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $17, $18
        )`,
        [
          point.id,
          session.id,
          pointIndex,
          point.createdAt,
          point.gps.lat,
          point.gps.lon,
          point.gps.accuracy,
          point.placeName,
          point.habitat,
          point.characteristics,
          point.observedWeather,
          JSON.stringify(point.automaticWeather ?? null),
          JSON.stringify(point.detectedPlace ?? null),
          JSON.stringify(point.tags),
          point.notes,
          point.zoomTakeReference,
          point.microphoneSetup,
          point.photos.length,
        ],
      ),
    );

    point.photos.forEach((photo, photoIndex) => {
      queries.push(
        sql.query(
          `INSERT INTO point_photos (
            id,
            session_id,
            point_id,
            ordinal,
            file_name,
            mime_type,
            cloud_path,
            cloud_url,
            cloud_synced_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9
          )`,
          [
            photo.id,
            session.id,
            point.id,
            photoIndex,
            photo.fileName,
            photo.mimeType,
            photo.cloudPath ?? null,
            photo.cloudUrl ?? null,
            photo.cloudSyncedAt ?? null,
          ],
        ),
      );
    });
  });

  session.audioTakes.forEach((take) => {
    queries.push(
      sql.query(
        `INSERT INTO audio_takes (
          id,
          session_id,
          associated_point_id,
          source,
          file_name,
          relative_path,
          mime_type,
          size_bytes,
          imported_at,
          last_modified,
          inferred_recorded_at,
          matched_by,
          confidence,
          matched_point_delta_minutes,
          detected_reference,
          duration_seconds,
          sample_rate_hz,
          bit_depth,
          channels,
          input_setup,
          low_cut_enabled,
          limiter_enabled,
          phantom_power_enabled,
          take_notes,
          cloud_path,
          cloud_url,
          cloud_synced_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27
        )`,
        [
          take.id,
          session.id,
          take.associatedPointId,
          take.source,
          take.fileName,
          take.relativePath,
          take.mimeType,
          take.sizeBytes,
          take.importedAt,
          take.lastModified,
          take.inferredRecordedAt,
          take.matchedBy,
          take.confidence,
          take.matchedPointDeltaMinutes,
          take.detectedReference,
          take.durationSeconds,
          take.sampleRateHz,
          take.bitDepth,
          take.channels,
          take.inputSetup,
          take.lowCutEnabled,
          take.limiterEnabled,
          take.phantomPowerEnabled,
          take.takeNotes,
          take.cloudPath ?? null,
          take.cloudUrl ?? null,
          take.cloudSyncedAt ?? null,
        ],
      ),
    );
  });

  await sql.transaction(queries);

  return {
    sessionId: session.id,
    syncedAt,
    pointCount,
    photoCount,
    audioTakeCount,
  };
}

export async function listCatalogSessions(): Promise<CatalogSessionSummary[]> {
  await ensureCatalogSchema();

  const sql = getSql();
  const rows = (await sql.query(
    `SELECT
      id,
      name,
      project_name AS "projectName",
      region,
      status,
      started_at AS "startedAt",
      ended_at AS "endedAt",
      point_count AS "pointCount",
      photo_count AS "photoCount",
      audio_take_count AS "audioTakeCount",
      cloud_sync_status AS "cloudSyncStatus",
      cloud_synced_at AS "cloudSyncedAt",
      created_in_catalog_at AS "createdInCatalogAt",
      updated_at AS "updatedAt"
    FROM catalog_sessions
    ORDER BY started_at DESC`,
  )) as Array<{
    id: string;
    name: string;
    projectName: string;
    region: string;
    status: CatalogSessionSummary['status'];
    startedAt: string | Date;
    endedAt: string | Date | null;
    pointCount: number;
    photoCount: number;
    audioTakeCount: number;
    cloudSyncStatus: CatalogSessionSummary['cloudSyncStatus'];
    cloudSyncedAt: string | Date | null;
    createdInCatalogAt: string | Date;
    updatedAt: string | Date;
  }>;

  return rows.map((row) => ({
    ...row,
    startedAt: toIsoString(row.startedAt),
    endedAt: row.endedAt ? toIsoString(row.endedAt) : null,
    cloudSyncedAt: row.cloudSyncedAt ? toIsoString(row.cloudSyncedAt) : null,
    createdInCatalogAt: toIsoString(row.createdInCatalogAt),
    updatedAt: toIsoString(row.updatedAt),
  }));
}

export async function getCatalogSession(sessionId: string): Promise<CatalogSessionPayload | null> {
  await ensureCatalogSchema();

  const sql = getSql();
  const rows = (await sql.query(
    `SELECT snapshot_json AS "snapshotJson"
    FROM catalog_sessions
    WHERE id = $1
    LIMIT 1`,
    [sessionId],
  )) as Array<{ snapshotJson: CatalogSessionPayload }>;

  return rows[0]?.snapshotJson ?? null;
}

export async function upsertPublishedSelection(
  selection: PublishSelectionPayload,
): Promise<PublishedSelection> {
  await ensureCatalogSchema();

  const sql = getSql();
  const now = new Date().toISOString();
  const rows = (await sql.query(
    `INSERT INTO published_selections (
      id,
      session_id,
      point_id,
      photo_id,
      audio_take_id,
      caption,
      project_name,
      session_name,
      point_name,
      image_url,
      audio_url,
      image_file_name,
      audio_file_name,
      published_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15
    )
    ON CONFLICT (id) DO UPDATE SET
      session_id = EXCLUDED.session_id,
      point_id = EXCLUDED.point_id,
      photo_id = EXCLUDED.photo_id,
      audio_take_id = EXCLUDED.audio_take_id,
      caption = EXCLUDED.caption,
      project_name = EXCLUDED.project_name,
      session_name = EXCLUDED.session_name,
      point_name = EXCLUDED.point_name,
      image_url = EXCLUDED.image_url,
      audio_url = EXCLUDED.audio_url,
      image_file_name = EXCLUDED.image_file_name,
      audio_file_name = EXCLUDED.audio_file_name,
      updated_at = EXCLUDED.updated_at
    RETURNING
      id,
      session_id AS "sessionId",
      point_id AS "pointId",
      photo_id AS "photoId",
      audio_take_id AS "audioTakeId",
      caption,
      project_name AS project,
      session_name AS "session",
      point_name AS point,
      image_url AS "imageUrl",
      audio_url AS "audioUrl",
      image_file_name AS "imageFileName",
      audio_file_name AS "audioFileName",
      published_at AS "publishedAt",
      updated_at AS "updatedAt"`,
    [
      selection.id,
      selection.sessionId,
      selection.pointId,
      selection.photoId,
      selection.audioTakeId,
      selection.caption,
      selection.project,
      selection.session,
      selection.point,
      selection.imageUrl,
      selection.audioUrl,
      selection.imageFileName,
      selection.audioFileName,
      now,
      now,
    ],
  )) as Array<
    Omit<PublishedSelection, 'publishedAt' | 'updatedAt'> & {
      publishedAt: string | Date;
      updatedAt: string | Date;
    }
  >;

  if (!rows[0]) {
    throw new Error('Published selection upsert returned no row.');
  }

  return normalizePublishedSelection(rows[0]);
}

export async function listPublishedSelections(filters?: {
  sessionId?: string | null;
  pointId?: string | null;
}): Promise<PublishedSelection[]> {
  await ensureCatalogSchema();

  const sql = getSql();
  const clauses: string[] = [];
  const values: Array<string> = [];

  if (filters?.sessionId) {
    values.push(filters.sessionId);
    clauses.push(`session_id = $${values.length}`);
  }

  if (filters?.pointId) {
    values.push(filters.pointId);
    clauses.push(`point_id = $${values.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = (await sql.query(
    `SELECT
      id,
      session_id AS "sessionId",
      point_id AS "pointId",
      photo_id AS "photoId",
      audio_take_id AS "audioTakeId",
      caption,
      project_name AS project,
      session_name AS "session",
      point_name AS point,
      image_url AS "imageUrl",
      audio_url AS "audioUrl",
      image_file_name AS "imageFileName",
      audio_file_name AS "audioFileName",
      published_at AS "publishedAt",
      updated_at AS "updatedAt"
    FROM published_selections
    ${whereClause}
    ORDER BY published_at DESC`,
    values,
  )) as Array<
    Omit<PublishedSelection, 'publishedAt' | 'updatedAt'> & {
      publishedAt: string | Date;
      updatedAt: string | Date;
    }
  >;

  return rows.map(normalizePublishedSelection);
}
