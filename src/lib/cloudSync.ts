import { upload } from '@vercel/blob/client';

import type { FieldSession, SessionPhoto } from '../types/fieldSessions';

interface UploadResult {
  pathname: string;
  url: string;
}

interface PhotoUploadPayload {
  sessionId: string;
  pointId: string;
  photoId: string;
}

interface CloudPhotoDescriptor {
  id: string;
  fileName: string;
  mimeType: string;
  cloudPath: string | null;
  cloudUrl: string | null;
  cloudSyncedAt: string | null;
}

interface CloudSessionPointPayload {
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

interface CloudSessionPayload extends Omit<FieldSession, 'points'> {
  schemaVersion: 1;
  points: CloudSessionPointPayload[];
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

async function uploadBlob(
  pathname: string,
  blob: Blob,
  contentType: string,
  payload: PhotoUploadPayload,
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

function buildCloudSessionPayload(session: FieldSession): CloudSessionPayload {
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

export async function syncSessionToCloud(session: FieldSession): Promise<FieldSession> {
  const nextPoints = await Promise.all(
    session.points.map(async (point) => {
      const nextPhotos = await Promise.all(
        point.photos.map(async (photo) => {
          if (photo.cloudPath && photo.cloudUrl) {
            return photo;
          }

          const prepared = await preparePhotoForCloudUpload(photo);
          const path = `field-sessions/${session.id}/points/${point.id}/photos/${photo.id}-${slugifyForPath(
            photo.fileName.replace(/\.[^/.]+$/, ''),
          )}.${extensionFromMimeType(prepared.mimeType)}`;
          const uploaded = await uploadBlob(path, prepared.blob, prepared.mimeType, {
            sessionId: session.id,
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

  const nextSession: FieldSession = {
    ...session,
    points: nextPoints,
  };

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
