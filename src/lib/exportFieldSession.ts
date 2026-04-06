import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { FieldSession } from '../types/fieldSessions';

function slugifyForFile(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'field-session';
}

function imageExtensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('jpeg')) {
    return 'jpg';
  }

  if (mimeType.includes('webp')) {
    return 'webp';
  }

  return 'png';
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function escapeCsvValue(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildPointsCsv(session: FieldSession): string {
  const lines = [
    [
      'point_order',
      'point_id',
      'created_at',
      'place_name',
      'latitude',
      'longitude',
      'gps_accuracy_m',
      'habitat',
      'characteristics',
      'observed_weather',
      'automatic_weather_summary',
      'automatic_weather_details',
      'detected_place_name',
      'detected_place_context',
      'tags',
      'notes',
      'zoom_take_reference',
      'microphone_setup',
      'photos_count',
      'linked_takes_count',
      'linked_take_files',
    ]
      .map(escapeCsvValue)
      .join(','),
  ];

  const sortedPoints = [...session.points].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  for (const [index, point] of sortedPoints.entries()) {
    const linkedTakes = session.audioTakes.filter((take) => take.associatedPointId === point.id);
    lines.push(
      [
        index + 1,
        point.id,
        point.createdAt,
        point.placeName,
        point.gps.lat,
        point.gps.lon,
        point.gps.accuracy,
        point.habitat,
        point.characteristics,
        point.observedWeather,
        point.automaticWeather?.summary ?? '',
        point.automaticWeather?.details ?? '',
        point.detectedPlace?.displayName ?? point.detectedPlace?.placeName ?? '',
        point.detectedPlace?.context ?? '',
        point.tags.join('|'),
        point.notes,
        point.zoomTakeReference,
        point.microphoneSetup,
        point.photos.length,
        linkedTakes.length,
        linkedTakes.map((take) => take.fileName).join('|'),
      ]
        .map(escapeCsvValue)
        .join(','),
    );
  }

  return lines.join('\n');
}

function buildPointsGeoJson(session: FieldSession): string {
  const sortedPoints = [...session.points].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: session.name,
      features: sortedPoints.map((point, index) => {
        const linkedTakes = session.audioTakes.filter((take) => take.associatedPointId === point.id);
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [point.gps.lon, point.gps.lat],
          },
          properties: {
            order: index + 1,
            id: point.id,
            createdAt: point.createdAt,
            placeName: point.placeName,
            gpsAccuracy: point.gps.accuracy,
            habitat: point.habitat,
            characteristics: point.characteristics,
            observedWeather: point.observedWeather,
            automaticWeatherSummary: point.automaticWeather?.summary ?? '',
            automaticWeatherDetails: point.automaticWeather?.details ?? '',
            detectedPlaceName: point.detectedPlace?.displayName ?? point.detectedPlace?.placeName ?? '',
            detectedPlaceContext: point.detectedPlace?.context ?? '',
            tags: point.tags,
            notes: point.notes,
            zoomTakeReference: point.zoomTakeReference,
            microphoneSetup: point.microphoneSetup,
            photosCount: point.photos.length,
            linkedTakesCount: linkedTakes.length,
            linkedTakeFiles: linkedTakes.map((take) => take.fileName),
          },
        };
      }),
    },
    null,
    2,
  );
}

function buildSessionReport(session: FieldSession): string {
  const sortedPoints = [...session.points].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const linkedTakesCount = session.audioTakes.filter((take) => take.associatedPointId).length;
  const unmatchedTakesCount = session.audioTakes.length - linkedTakesCount;
  const pendingLocationCount = session.points.filter((point) => !point.detectedPlace).length;
  const pendingWeatherCount = session.points.filter((point) => !point.automaticWeather).length;

  const lines = [
    `# Session Report`,
    '',
    `- Session: ${session.name}`,
    `- Started: ${session.startedAt}`,
    `- Ended: ${session.endedAt ?? 'active'}`,
    `- Project: ${session.projectName || 'n/a'}`,
    `- Region: ${session.region || 'n/a'}`,
    `- Equipment preset: ${session.equipmentPreset || 'n/a'}`,
    `- Points: ${session.points.length}`,
    `- Photos: ${session.points.reduce((count, point) => count + point.photos.length, 0)}`,
    `- Zoom H6 takes indexed: ${session.audioTakes.length}`,
    `- Takes linked to points: ${linkedTakesCount}`,
    `- Takes pending association: ${unmatchedTakesCount}`,
    `- Points pending place enrichment: ${pendingLocationCount}`,
    `- Points pending weather enrichment: ${pendingWeatherCount}`,
    '',
    `## Points`,
    '',
  ];

  for (const [index, point] of sortedPoints.entries()) {
    const linkedTakes = session.audioTakes.filter((take) => take.associatedPointId === point.id);
    lines.push(`### ${index + 1}. ${point.placeName}`);
    lines.push(`- Time: ${point.createdAt}`);
    lines.push(`- Coordinates: ${point.gps.lat}, ${point.gps.lon}`);
    lines.push(`- Weather: ${point.observedWeather || 'n/a'}`);
    lines.push(`- Habitat: ${point.habitat || 'n/a'}`);
    lines.push(`- Zoom reference: ${point.zoomTakeReference || 'n/a'}`);
    lines.push(`- Linked takes: ${linkedTakes.length > 0 ? linkedTakes.map((take) => take.fileName).join(', ') : 'none'}`);
    lines.push('');
  }

  return lines.join('\n');
}

function buildTakesCsv(session: FieldSession): string {
  const lines = [
    [
      'take_id',
      'file_name',
      'relative_path',
      'mime_type',
      'size_bytes',
      'imported_at',
      'last_modified',
      'inferred_recorded_at',
      'detected_reference',
      'matched_by',
      'confidence',
      'matched_point_delta_minutes',
      'associated_point_id',
      'associated_point_name',
      'associated_zoom_reference',
      'duration_seconds',
      'sample_rate_hz',
      'bit_depth',
      'channels',
      'input_setup',
      'low_cut_enabled',
      'limiter_enabled',
      'phantom_power_enabled',
      'take_notes',
    ]
      .map(escapeCsvValue)
      .join(','),
  ];

  for (const take of session.audioTakes) {
    const linkedPoint = session.points.find((point) => point.id === take.associatedPointId) ?? null;
    lines.push(
      [
        take.id,
        take.fileName,
        take.relativePath,
        take.mimeType,
        take.sizeBytes,
        take.importedAt,
        take.lastModified,
        take.inferredRecordedAt,
        take.detectedReference,
        take.matchedBy,
        take.confidence,
        take.matchedPointDeltaMinutes,
        linkedPoint?.id ?? '',
        linkedPoint?.placeName ?? '',
        linkedPoint?.zoomTakeReference ?? '',
        take.durationSeconds,
        take.sampleRateHz,
        take.bitDepth,
        take.channels,
        take.inputSetup,
        take.lowCutEnabled,
        take.limiterEnabled,
        take.phantomPowerEnabled,
        take.takeNotes,
      ]
        .map(escapeCsvValue)
        .join(','),
    );
  }

  return lines.join('\n');
}

export async function exportFieldSessionPackage(session: FieldSession): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const sessionFolder = `${format(new Date(session.startedAt), 'yyyyMMdd-HHmm', { locale: es })}-${slugifyForFile(session.name)}`;
  const sortedPoints = [...session.points].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );

  zip.file(
    `${sessionFolder}/session.json`,
    JSON.stringify(
      {
        ...session,
        points: sortedPoints,
        photosCount: session.points.reduce((count, point) => count + point.photos.length, 0),
        pointsCount: session.points.length,
        audioTakesCount: session.audioTakes.length,
      },
      null,
      2,
    ),
  );

  zip.file(`${sessionFolder}/session-report.md`, buildSessionReport(session));
  zip.file(`${sessionFolder}/indexes/points.csv`, buildPointsCsv(session));
  zip.file(`${sessionFolder}/indexes/points.geojson`, buildPointsGeoJson(session));

  zip.file(
    `${sessionFolder}/takes/takes.json`,
    JSON.stringify(
      session.audioTakes.map((take) => {
        const linkedPoint = session.points.find((point) => point.id === take.associatedPointId) ?? null;
        return {
          ...take,
          associatedPoint: linkedPoint
            ? {
                id: linkedPoint.id,
                placeName: linkedPoint.placeName,
                zoomTakeReference: linkedPoint.zoomTakeReference,
              }
            : null,
        };
      }),
      null,
      2,
    ),
  );

  zip.file(`${sessionFolder}/takes/takes.csv`, buildTakesCsv(session));

  sortedPoints.forEach((point, index) => {
    const pointFolder = `${sessionFolder}/points/${String(index + 1).padStart(3, '0')}-${slugifyForFile(point.placeName)}`;

    zip.file(
      `${pointFolder}/point.json`,
      JSON.stringify(
        {
          ...point,
          photos: point.photos.map((photo) => ({
            id: photo.id,
            fileName: photo.fileName,
            mimeType: photo.mimeType,
          })),
        },
        null,
        2,
      ),
    );

    point.photos.forEach((photo, photoIndex) => {
      const extension = imageExtensionFromMimeType(photo.mimeType);
      const safeFileName = slugifyForFile(photo.fileName.replace(/\.[^/.]+$/, ''));
      zip.file(
        `${pointFolder}/photos/${String(photoIndex + 1).padStart(2, '0')}-${safeFileName}.${extension}`,
        photo.blob,
      );
    });
  });

  const archiveBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(archiveBlob, `${sessionFolder}.zip`);
}
