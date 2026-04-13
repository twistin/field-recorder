import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

const PHOTO_CONTENT_TYPES = ['image/*'];
const AUDIO_CONTENT_TYPES = ['audio/*'];
const MAX_UPLOAD_SIZE_BYTES = 512 * 1024 * 1024;

interface PhotoUploadPayload {
  sessionId?: string;
  kind?: 'photo' | 'audio';
  pointId?: string;
  photoId?: string;
  audioTakeId?: string;
}

function isPhotoPath(pathname: string): boolean {
  return /^field-sessions\/[^/]+\/points\/[^/]+\/photos\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

function isAudioPath(pathname: string): boolean {
  return /^field-sessions\/[^/]+\/audio\/[^/]+\.[a-z0-9]+$/i.test(pathname);
}

function parseClientPayload(clientPayload: string | null): PhotoUploadPayload {
  if (!clientPayload) {
    throw new Error('Missing upload payload.');
  }

  try {
    return JSON.parse(clientPayload) as PhotoUploadPayload;
  } catch {
    throw new Error('Invalid upload payload.');
  }
}

function matchesPayload(pathname: string, payload: PhotoUploadPayload): boolean {
  if (!payload.sessionId || !payload.kind) {
    return false;
  }

  if (payload.kind === 'photo') {
    if (!payload.pointId || !payload.photoId) {
      return false;
    }

    const expectedPrefix = `field-sessions/${payload.sessionId}/points/${payload.pointId}/photos/${payload.photoId}-`;
    return pathname.startsWith(expectedPrefix);
  }

  if (!payload.audioTakeId) {
    return false;
  }

  const expectedPrefix = `field-sessions/${payload.sessionId}/audio/${payload.audioTakeId}-`;
  return pathname.startsWith(expectedPrefix);
}

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: 'Missing BLOB_READ_WRITE_TOKEN.' }, { status: 500 });
  }

  let body: HandleUploadBody;

  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: 'Invalid upload request body.' }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isPhotoPath(pathname) && !isAudioPath(pathname)) {
          throw new Error('Invalid upload pathname.');
        }

        const payload = parseClientPayload(clientPayload);
        if (!matchesPayload(pathname, payload)) {
          throw new Error('Upload payload does not match pathname.');
        }

        const allowedContentTypes = payload.kind === 'audio' ? AUDIO_CONTENT_TYPES : PHOTO_CONTENT_TYPES;

        return {
          allowedContentTypes,
          maximumSizeInBytes: MAX_UPLOAD_SIZE_BYTES,
          allowOverwrite: true,
          tokenPayload: clientPayload,
        };
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Client upload setup failed.' },
      { status: 400 },
    );
  }
}
