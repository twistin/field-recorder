import { upload } from '@vercel/blob/client';

import type { FieldSession, SessionAudioTake, SessionPhoto } from '../types/fieldSessions';

interface UploadResult {
  pathname: string;
  url: string;
}

interface MediaUploadPayload {
  sessionId: string;
  kind: 'photo' | 'audio';
  pointId?: string;
  photoId?: string;
  audioTakeId?: string;
}

interface CloudPhotoDescriptor {
  id: string;
  fileName: string;
  mimeType: string;
  cloudPath: string | null;
  cloudUrl: string | null;
  cloudSyncedAt: string | null;
}

interface CloudAudioDescriptor extends Omit<SessionAudioTake, 'blob'> {
  cloudPath: string | null;
  cloudUrl: string | null;
  cloudSyncedAt: string | null;
}

interface CloudSessionPointPayload extends Omit<FieldSession['points'][number], 'photos'> {
  id: string;
  createdAt: string;
  gps: FieldSession['points'][number]['gps'];
  placeName: string;
  habitat: string;
  characteristics: string;
  observedWeather: string;
  automaticWeather?: FieldSession['points'][number]['automaticWeather'];
  detectedPlace?: FieldSession['points'][number]['detectedPlace'];
  tags: string[];
  notes: string;
  zoomTakeReference: string;
  microphoneSetup: string;
  photos: CloudPhotoDescriptor[];
}

interface CloudSessionPayload extends Omit<FieldSession, 'points' | 'audioTakes'> {
  schemaVersion: 1;
  points: CloudSessionPointPayload[];
  audioTakes: CloudAudioDescriptor[];
}

interface SyncedMediaSelection {
  session: FieldSession;
  selectedPhoto?: SessionPhoto | null;
  selectedAudioTake?: SessionAudioTake | null;
}

function getBlobProxyUrl(blobRef: string): string {
  const relativeUrl = `/api/storage/blob?blob=${encodeURIComponent(blobRef)}`;
  if (typeof window === 'undefined') {
    return relativeUrl;
  }

  return new URL(relativeUrl, window.location.origin).toString();
}

function getAudioExtension(fileName: string, mimeType: string): string {
  const extensionMatch = fileName.match(/\.([a-z0-9]+)$/i);
  if (extensionMatch?.[1]) {
    return extensionMatch[1].toLowerCase();
  }

  if (mimeType.includes('flac')) {
    return 'flac';
  }

  if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
    return 'm4a';
  }

  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'mp3';
  }

  return 'wav';
}

function shouldUploadAudioTake(take: SessionAudioTake): boolean {
  return take.blob.size > 0 && (!take.cloudPath || !take.cloudUrl);
}

async function prepareAudioForCloudUpload(
  take: SessionAudioTake,
): Promise<{ blob: Blob; mimeType: string }> {
  return {
    blob: take.blob,
    mimeType: take.mimeType || 'audio/wav',
  };
}

async function uploadBlob(
  pathname: string,
  blob: Blob,
  contentType: string,
  payload: MediaUploadPayload,
): Promise<UploadResult> {
  const uploaded = await upload(pathname, blob, {
    access: 'private',
    contentType,
    handleUploadUrl: '/api/storage/client-upload',
    clientPayload: JSON.stringify(payload),
    multipart: blob.size > CLIENT_UPLOAD_MULTIPART_THRESHOLD_BYTES,
  });

  return {
    pathname: uploaded.pathname,
    url: uploaded.url,
  };
}

async function syncSessionMediaToCloud(
  session: FieldSession,
  options?: { photoIds?: string[]; audioTakeIds?: string[] },
): Promise<SyncedMediaSelection> {
  const selectedPhotoIds = options?.photoIds ? new Set(options.photoIds) : null;
  const selectedAudioTakeIds = options?.audioTakeIds ? new Set(options.audioTakeIds) : null;

  const nextPoints = await Promise.all(
    session.points.map(async (point) => {
      const nextPhotos = await Promise.all(
        point.photos.map(async (photo) => {
          const shouldSyncSelectedPhoto = !selectedPhotoIds || selectedPhotoIds.has(photo.id);
          if (!shouldSyncSelectedPhoto || (photo.cloudPath && photo.cloudUrl)) {
            return photo;
          }

          const prepared = await preparePhotoForCloudUpload(photo);
          const path = `field-sessions/${session.id}/points/${point.id}/photos/${photo.id}-${slugifyForPath(
            photo.fileName.replace(/\.[^/.]+$/, ''),
          )}.${extensionFromMimeType(prepared.mimeType)}`;
          const uploaded = await uploadBlob(path, prepared.blob, prepared.mimeType, {
            sessionId: session.id,
            kind: 'photo',
            pointId: point.id,
            photoId: photo.id,
          });
          const syncedAt = new Date().toISOString();

          return {
            ...photo,
            cloudPath: uploaded.pathname,
            cloudUrl: uploaded.url,
            cloudSyncedAt: syncedAt,
          };
        }),
      );

      return {
        ...point,
        photos: nextPhotos,
      };
    }),
  );

  const nextAudioTakes = await Promise.all(
    session.audioTakes.map(async (take) => {
      const shouldSyncSelectedTake = !selectedAudioTakeIds || selectedAudioTakeIds.has(take.id);
      if (!shouldSyncSelectedTake || !shouldUploadAudioTake(take)) {
        return take;
      }

      const prepared = await prepareAudioForCloudUpload(take);
      const path = `field-sessions/${session.id}/audio/${take.id}-${slugifyForPath(
        take.fileName.replace(/\.[^/.]+$/, ''),
      )}.${getAudioExtension(take.fileName, prepared.mimeType)}`;
      const uploaded = await uploadBlob(path, prepared.blob, prepared.mimeType, {
        sessionId: session.id,
        kind: 'audio',
        audioTakeId: take.id,
      });
      const syncedAt = new Date().toISOString();

      return {
        ...take,
        cloudPath: uploaded.pathname,
        cloudUrl: uploaded.url,
        cloudSyncedAt: syncedAt,
      };
    }),
  );

  const nextSession: FieldSession = {
    ...session,
    points: nextPoints,
    audioTakes: nextAudioTakes,
  };

  return {
    session: nextSession,
    selectedPhoto: selectedPhotoIds
      ? nextSession.points.flatMap((point) => point.photos).find((photo) => selectedPhotoIds.has(photo.id)) ?? null
      : null,
    selectedAudioTake: selectedAudioTakeIds
      ? nextSession.audioTakes.find((take) => selectedAudioTakeIds.has(take.id)) ?? null
      : null,
  };
}

const CLIENT_UPLOAD_MULTIPART_THRESHOLD_BYTES = 4_500_000;

async function parseApiError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error || `${fallbackMessage} (HTTP ${response.status})`);
  } catch {
    try {
      const text = await response.text();
      return new Error(text || `${fallbackMessage} (HTTP ${response.status})`);
    } catch {
      return new Error(`${fallbackMessage} (HTTP ${response.status})`);
    }
  }
}

function slugifyForPath(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset'
  );
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('avif')) {
    return 'avif';
  }

  if (mimeType.includes('heic')) {
    return 'heic';
  }

  if (mimeType.includes('heif')) {
    return 'heif';
  }

  if (mimeType.includes('gif')) {
    return 'gif';
  }

  if (mimeType.includes('png')) {
    return 'png';
  }

  if (mimeType.includes('webp')) {
    return 'webp';
  }

  return 'jpg';
}

async function imageBlobToImageElement(blob: Blob): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to load image for cloud sync.'));
    };

    image.src = objectUrl;
  });
}

async function preparePhotoForCloudUpload(photo: SessionPhoto): Promise<{ blob: Blob; mimeType: string }> {
  if (!photo.mimeType.startsWith('image/') || typeof document === 'undefined') {
    return { blob: photo.blob, mimeType: photo.mimeType };
  }

  const shouldCompress = photo.blob.size > 2_400_000;
  if (!shouldCompress) {
    return { blob: photo.blob, mimeType: photo.mimeType };
  }

  try {
    const image = await imageBlobToImageElement(photo.blob);
    const maxDimension = 1920;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return { blob: photo.blob, mimeType: photo.mimeType };
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const compressedBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });

    return compressedBlob
      ? {
          blob: compressedBlob,
          mimeType: 'image/jpeg',
        }
      : { blob: photo.blob, mimeType: photo.mimeType };
  } catch {
    return { blob: photo.blob, mimeType: photo.mimeType };
  }
}

function buildCloudSessionPayload(session: FieldSession): CloudSessionPayload {
  return {
    ...session,
    schemaVersion: 1,
    audioTakes: session.audioTakes.map(({ blob: _blob, ...take }) => ({
      ...take,
      cloudPath: take.cloudPath ?? null,
      cloudUrl: take.cloudUrl ?? null,
      cloudSyncedAt: take.cloudSyncedAt ?? null,
    })),
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

export async function syncSessionToCloud(session: FieldSession): Promise<FieldSession> {
  const { session: nextSession } = await syncSessionMediaToCloud(session);

  const payload = buildCloudSessionPayload(nextSession);
  const manifestPath = `field-sessions/${session.id}/session.json`;
  const manifestResponse = await fetch('/api/storage/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      pathname: manifestPath,
      session: payload,
    }),
  });

  if (!manifestResponse.ok) {
    throw await parseApiError(manifestResponse, 'Session manifest sync failed');
  }

  const manifest = (await manifestResponse.json()) as UploadResult;
  const syncedAt = new Date().toISOString();

  return {
    ...nextSession,
    cloudSyncStatus: 'synced',
    cloudSyncedAt: syncedAt,
    cloudError: null,
    cloudManifestPath: manifest.pathname,
    cloudManifestUrl: manifest.url,
  };
}

export async function syncSelectionToCloud(
  session: FieldSession,
  options: { photoId: string; audioTakeId: string },
): Promise<{
  session: FieldSession;
  imageUrl: string;
  audioUrl: string;
}> {
  const { session: nextSession, selectedPhoto, selectedAudioTake } = await syncSessionMediaToCloud(session, {
    photoIds: [options.photoId],
    audioTakeIds: [options.audioTakeId],
  });

  if (!selectedPhoto?.cloudPath && !selectedPhoto?.cloudUrl) {
    throw new Error('No se pudo subir la imagen seleccionada.');
  }

  if (!selectedAudioTake?.cloudPath && !selectedAudioTake?.cloudUrl) {
    throw new Error('No se pudo subir el audio seleccionado.');
  }

  return {
    session: nextSession,
    imageUrl: getBlobProxyUrl(selectedPhoto.cloudPath ?? selectedPhoto.cloudUrl ?? ''),
    audioUrl: getBlobProxyUrl(selectedAudioTake.cloudPath ?? selectedAudioTake.cloudUrl ?? ''),
  };
}
