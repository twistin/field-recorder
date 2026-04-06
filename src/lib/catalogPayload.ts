import type { FieldSession, SessionPhoto, SessionPoint } from '../types/fieldSessions';

export interface CatalogPhotoPayload extends Omit<SessionPhoto, 'blob'> {
  cloudPath?: string | null;
  cloudUrl?: string | null;
  cloudSyncedAt?: string | null;
}

export interface CatalogPointPayload extends Omit<SessionPoint, 'photos'> {
  photos: CatalogPhotoPayload[];
}

export interface CatalogSessionPayload extends Omit<FieldSession, 'points'> {
  schemaVersion: 1;
  points: CatalogPointPayload[];
}

export interface CatalogSyncResult {
  sessionId: string;
  syncedAt: string;
  pointCount: number;
  photoCount: number;
  audioTakeCount: number;
}

export interface CatalogSessionSummary {
  id: string;
  name: string;
  projectName: string;
  region: string;
  status: FieldSession['status'];
  startedAt: string;
  endedAt: string | null;
  pointCount: number;
  photoCount: number;
  audioTakeCount: number;
  cloudSyncStatus: FieldSession['cloudSyncStatus'] | null;
  cloudSyncedAt: string | null;
  createdInCatalogAt: string;
  updatedAt: string;
}

export function buildCatalogSessionPayload(session: FieldSession): CatalogSessionPayload {
  return {
    ...session,
    schemaVersion: 1,
    points: session.points.map((point) => ({
      ...point,
      photos: point.photos.map((photo) => ({
        id: photo.id,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        cloudPath: photo.cloudPath ?? null,
        cloudUrl: photo.cloudUrl ?? null,
        cloudSyncedAt: photo.cloudSyncedAt ?? null,
      })),
    })),
  };
}
