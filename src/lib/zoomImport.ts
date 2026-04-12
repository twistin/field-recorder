import { v4 as uuidv4 } from 'uuid';
import type { SessionAudioTake, SessionPoint } from '../types/fieldSessions';

const SUPPORTED_AUDIO_EXTENSIONS = ['.wav', '.bwf', '.mp3', '.m4a', '.flac'];

export function isSupportedImportedAudioFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return SUPPORTED_AUDIO_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

function normalizeReference(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getFileStem(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, '');
}

function getTakeIdentity(take: Pick<SessionAudioTake, 'relativePath' | 'fileName' | 'sizeBytes' | 'lastModified'>): string {
  return [take.relativePath || take.fileName, take.sizeBytes, take.lastModified].join('::');
}

function compareIsoDateStrings(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

function compareTakesChronologically(
  left: Pick<SessionAudioTake, 'inferredRecordedAt' | 'fileName'>,
  right: Pick<SessionAudioTake, 'inferredRecordedAt' | 'fileName'>,
): number {
  const timeDelta = compareIsoDateStrings(left.inferredRecordedAt, right.inferredRecordedAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.fileName.localeCompare(right.fileName, undefined, { numeric: true, sensitivity: 'base' });
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

function applySequenceFallback(
  takes: SessionAudioTake[],
  points: SessionPoint[],
): SessionAudioTake[] {
  const unmatchedTakes = [...takes]
    .filter((take) => !take.associatedPointId || take.matchedBy === 'unmatched')
    .sort(compareTakesChronologically);

  if (unmatchedTakes.length === 0) {
    return takes;
  }

  const usedPointIds = new Set(
    takes
      .filter((take) => take.associatedPointId)
      .map((take) => take.associatedPointId)
      .filter((pointId): pointId is string => Boolean(pointId)),
  );
  const availablePoints = [...points]
    .filter((point) => !usedPointIds.has(point.id))
    .sort((left, right) => compareIsoDateStrings(left.createdAt, right.createdAt));

  // Conservative fallback: only pair by order when the remaining sequence is unambiguous.
  if (availablePoints.length === 0 || availablePoints.length !== unmatchedTakes.length) {
    return takes;
  }

  const sequenceMatches = new Map<
    string,
    Pick<SessionAudioTake, 'associatedPointId' | 'matchedBy' | 'confidence' | 'matchedPointDeltaMinutes'>
  >();

  unmatchedTakes.forEach((take, index) => {
    const point = availablePoints[index];
    const deltaMinutes = Math.round(
      Math.abs(new Date(take.inferredRecordedAt).getTime() - new Date(point.createdAt).getTime()) / 60_000,
    );

    sequenceMatches.set(take.id, {
      associatedPointId: point.id,
      matchedBy: 'sequence',
      confidence: deltaMinutes <= 15 ? 'medium' : 'low',
      matchedPointDeltaMinutes: deltaMinutes,
    });
  });

  return takes.map((take) => {
    const sequenceMatch = sequenceMatches.get(take.id);
    return sequenceMatch ? { ...take, ...sequenceMatch } : take;
  });
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

  return applySequenceFallback(importedTakes, points);
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
  const reconciledTakes: SessionAudioTake[] = takes.map((take): SessionAudioTake => {
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

  return applySequenceFallback(reconciledTakes, points);
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
