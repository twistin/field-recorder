import { v4 as uuidv4 } from 'uuid';
import type { SessionAudioTake, SessionPoint } from '../types/fieldSessions';

function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getFileStem(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function getTakeIdentity(take: Pick<SessionAudioTake, 'relativePath' | 'fileName' | 'sizeBytes' | 'lastModified'>): string {
  return [take.relativePath || take.fileName, take.sizeBytes, take.lastModified].join('::');
}

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

function matchTakeToPoint(
  take: Pick<SessionAudioTake, 'fileName' | 'inferredRecordedAt' | 'detectedReference'>,
  points: SessionPoint[],
): Pick<SessionAudioTake, 'associatedPointId' | 'matchedBy' | 'confidence' | 'matchedPointDeltaMinutes'> {
  const normalizedDetectedReference = normalizeReference(take.detectedReference);

  if (normalizedDetectedReference) {
    const matchedByReference = points.find((point) => {
      const normalizedPointReference = normalizeReference(point.zoomTakeReference);
      return (
        normalizedPointReference &&
        (normalizedDetectedReference.includes(normalizedPointReference) ||
          normalizedPointReference.includes(normalizedDetectedReference))
      );
    });

    if (matchedByReference) {
      const deltaMinutes = Math.round(
        Math.abs(
          new Date(take.inferredRecordedAt).getTime() - new Date(matchedByReference.createdAt).getTime(),
        ) /
          60_000,
      );

      return {
        associatedPointId: matchedByReference.id,
        matchedBy: 'reference',
        confidence: 'high',
        matchedPointDeltaMinutes: deltaMinutes,
      };
    }
  }

  if (points.length === 0) {
    return {
      associatedPointId: null,
      matchedBy: 'unmatched',
      confidence: 'low',
      matchedPointDeltaMinutes: null,
    };
  }

  const recordedAtMs = new Date(take.inferredRecordedAt).getTime();
  const nearestPoint = points.reduce<{ point: SessionPoint | null; deltaMs: number }>(
    (closest, point) => {
      const deltaMs = Math.abs(recordedAtMs - new Date(point.createdAt).getTime());
      if (!closest.point || deltaMs < closest.deltaMs) {
        return { point, deltaMs };
      }

      return closest;
    },
    { point: null, deltaMs: Number.POSITIVE_INFINITY },
  );

  if (!nearestPoint.point) {
    return {
      associatedPointId: null,
      matchedBy: 'unmatched',
      confidence: 'low',
      matchedPointDeltaMinutes: null,
    };
  }

  const deltaMinutes = Math.round(nearestPoint.deltaMs / 60_000);
  if (deltaMinutes <= 15) {
    return {
      associatedPointId: nearestPoint.point.id,
      matchedBy: 'time',
      confidence: deltaMinutes <= 5 ? 'medium' : 'low',
      matchedPointDeltaMinutes: deltaMinutes,
    };
  }

  return {
    associatedPointId: null,
    matchedBy: 'unmatched',
    confidence: 'low',
    matchedPointDeltaMinutes: deltaMinutes,
  };
}

export async function buildImportedAudioTakes(
  files: File[],
  points: SessionPoint[],
  importedAt = new Date().toISOString(),
): Promise<SessionAudioTake[]> {
  return await Promise.all(
    files
      .filter((file) => file.size > 0)
      .map(async (file) => {
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
          ...match,
        };
      }),
  );
}

export function autoMatchAudioTake(
  take: SessionAudioTake,
  points: SessionPoint[],
): SessionAudioTake {
  return {
    ...take,
    ...matchTakeToPoint(take, points),
  };
}

export function reconcileSessionAudioTakes(
  points: SessionPoint[],
  takes: SessionAudioTake[],
): SessionAudioTake[] {
  return takes.map((take) => {
    if (take.matchedBy === 'manual' && take.associatedPointId) {
      const linkedPoint = points.find((point) => point.id === take.associatedPointId);
      if (linkedPoint) {
        return {
          ...take,
          confidence: 'high',
          matchedPointDeltaMinutes: Math.round(
            Math.abs(new Date(take.inferredRecordedAt).getTime() - new Date(linkedPoint.createdAt).getTime()) /
              60_000,
          ),
        };
      }
    }

    return autoMatchAudioTake(take, points);
  });
}

export function mergeSessionAudioTakes(
  existing: SessionAudioTake[],
  imported: SessionAudioTake[],
): SessionAudioTake[] {
  const merged = new Map<string, SessionAudioTake>();

  for (const take of existing) {
    merged.set(getTakeIdentity(take), take);
  }

  for (const take of imported) {
    merged.set(getTakeIdentity(take), take);
  }

  return [...merged.values()].sort(
    (left, right) =>
      new Date(left.inferredRecordedAt).getTime() - new Date(right.inferredRecordedAt).getTime(),
  );
}
