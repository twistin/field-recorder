import { v4 as uuidv4 } from 'uuid';
import type { SessionAudioTake, SessionPoint } from '../types/fieldSessions';
import {
  applySequenceFallback,
  getFileStem,
  isSupportedImportedAudioFileName,
  matchTakeToPoint,
} from './zoomImportShared';

async function readAudioFileMetadata(file: File): Promise<{
  durationSeconds: number | null;
  sampleRateHz: number | null;
  bitDepth: number | null;
  channels: number | null;
}> {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.wav') && !lowerName.endsWith('.bwf')) {
    return {
      durationSeconds: null,
      sampleRateHz: null,
      bitDepth: null,
      channels: null,
    };
  }

  const headerBuffer = await file.slice(0, 262_144).arrayBuffer();
  const view = new DataView(headerBuffer);

  if (view.byteLength < 12) {
    return {
      durationSeconds: null,
      sampleRateHz: null,
      bitDepth: null,
      channels: null,
    };
  }

  const chunkId = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const waveId = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11),
  );

  if (chunkId !== 'RIFF' || waveId !== 'WAVE') {
    return {
      durationSeconds: null,
      sampleRateHz: null,
      bitDepth: null,
      channels: null,
    };
  }

  let offset = 12;
  let channels: number | null = null;
  let sampleRateHz: number | null = null;
  let bitDepth: number | null = null;
  let byteRate: number | null = null;
  let dataChunkSize: number | null = null;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;

    if (id === 'fmt ' && dataOffset + 16 <= view.byteLength) {
      channels = view.getUint16(dataOffset + 2, true);
      sampleRateHz = view.getUint32(dataOffset + 4, true);
      byteRate = view.getUint32(dataOffset + 8, true);
      bitDepth = view.getUint16(dataOffset + 14, true);
    } else if (id === 'data') {
      dataChunkSize = size;
      break;
    }

    offset += 8 + size + (size % 2);
  }

  const durationSeconds =
    byteRate && byteRate > 0
      ? Number((((dataChunkSize ?? file.size) as number) / byteRate).toFixed(2))
      : null;

  return {
    durationSeconds,
    sampleRateHz,
    bitDepth,
    channels,
  };
}

export async function buildImportedAudioTakes(
  files: File[],
  points: SessionPoint[],
  importedAt = new Date().toISOString(),
): Promise<SessionAudioTake[]> {
  const importedTakes: SessionAudioTake[] = await Promise.all(
    files
      .filter((file) => file.size > 0 && isSupportedImportedAudioFileName(file.name))
      .map(async (file): Promise<SessionAudioTake> => {
        const technicalMetadata = await readAudioFileMetadata(file);
        const inferredRecordedAt = new Date(file.lastModified || Date.now()).toISOString();
        const detectedReference = getFileStem(file.name);
        const match = matchTakeToPoint(
          {
            fileName: file.name,
            inferredRecordedAt,
            detectedReference,
          },
          points,
        );

        return {
          id: uuidv4(),
          source: 'zoom-h6',
          fileName: file.name,
          relativePath:
            (file as File & { webkitRelativePath?: string }).webkitRelativePath?.trim() || file.name,
          mimeType: file.type || 'audio/wav',
          blob: file,
          sizeBytes: file.size,
          importedAt,
          lastModified: new Date(file.lastModified || Date.now()).toISOString(),
          inferredRecordedAt,
          detectedReference,
          ...technicalMetadata,
          inputSetup: '',
          lowCutEnabled: null,
          limiterEnabled: null,
          phantomPowerEnabled: null,
          takeNotes: '',
          cloudPath: null,
          cloudUrl: null,
          cloudSyncedAt: null,
          ...match,
        };
      }),
  );

  return applySequenceFallback(importedTakes, points);
}

export {
  autoMatchAudioTake,
  isSupportedImportedAudioFileName,
  mergeSessionAudioTakes,
  reconcileSessionAudioTakes,
} from './zoomImportShared';
