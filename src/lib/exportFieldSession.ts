import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { FieldSession, SessionPoint } from '../types/fieldSessions';

export interface FieldSessionExportSummary {
  exportedAudioCount: number;
  missingAudioCount: number;
  missingAudioFiles: string[];
}

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

function audioExtensionFromTake(fileName: string, mimeType: string): string {
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

function buildBlobProxyUrl(blobRef: string): string {
  return `/api/storage/blob?blob=${encodeURIComponent(blobRef)}`;
}

async function resolveStoredBlob(
  asset: Pick<{ blob: Blob; cloudPath?: string | null; cloudUrl?: string | null }, 'blob' | 'cloudPath' | 'cloudUrl'>,
): Promise<Blob | null> {
  if (asset.blob.size > 0) {
    return asset.blob;
  }

  const remoteSource = asset.cloudPath ?? asset.cloudUrl;
  if (!remoteSource) {
    return null;
  }

  const response = await fetch(buildBlobProxyUrl(remoteSource));
  if (!response.ok) {
    throw new Error(`No se pudo descargar un asset remoto para exportar (HTTP ${response.status}).`);
  }

  return await response.blob();
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

function escapeXmlValue(value: string | number | boolean | null | undefined): string {
  const normalized = value == null ? '' : String(value);
  return normalized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
      'soundscape_summary',
      'soundscape_details',
      'soundscape_tags',
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
        point.soundscapeClassification?.summary ?? '',
        point.soundscapeClassification?.details ?? '',
        point.soundscapeClassification?.tags.join('|') ?? '',
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
            soundscapeSummary: point.soundscapeClassification?.summary ?? '',
            soundscapeDetails: point.soundscapeClassification?.details ?? '',
            soundscapeTags: point.soundscapeClassification?.tags ?? [],
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

function buildPointCsv(session: FieldSession, point: SessionPoint): string {
  const linkedTakes = session.audioTakes.filter((take) => take.associatedPointId === point.id);

  return [
    [
      'session_name',
      'session_project',
      'session_region',
      'point_id',
      'created_at',
      'place_name',
      'latitude',
      'longitude',
      'gps_accuracy_m',
      'observed_weather',
      'automatic_weather_summary',
      'automatic_weather_details',
      'ai_soundscape_summary',
      'ai_soundscape_details',
      'ai_soundscape_tags',
      'habitat',
      'characteristics',
      'notes',
      'manual_tags',
      'zoom_take_reference',
      'microphone_setup',
      'linked_take_files',
      'photos_count',
    ]
      .map(escapeCsvValue)
      .join(','),
    [
      session.name,
      session.projectName,
      session.region,
      point.id,
      point.createdAt,
      point.placeName,
      point.gps.lat,
      point.gps.lon,
      point.gps.accuracy,
      point.observedWeather,
      point.automaticWeather?.summary ?? '',
      point.automaticWeather?.details ?? '',
      point.soundscapeClassification?.summary ?? '',
      point.soundscapeClassification?.details ?? '',
      point.soundscapeClassification?.tags.join('|') ?? '',
      point.habitat,
      point.characteristics,
      point.notes,
      point.tags.join('|'),
      point.zoomTakeReference,
      point.microphoneSetup,
      linkedTakes.map((take) => take.fileName).join('|'),
      point.photos.length,
    ]
      .map(escapeCsvValue)
      .join(','),
  ].join('\n');
}

function buildPointKml(session: FieldSession, point: SessionPoint): string {
  const descriptionParts = [
    `<strong>Salida:</strong> ${escapeXmlValue(session.name)}`,
    `<strong>Trabajo:</strong> ${escapeXmlValue(session.projectName || 'Sin trabajo')}`,
    `<strong>Región:</strong> ${escapeXmlValue(session.region || 'Sin región')}`,
    `<strong>Clima:</strong> ${escapeXmlValue(point.observedWeather || 'Sin dato')}`,
    `<strong>IA sonora:</strong> ${escapeXmlValue(point.soundscapeClassification?.summary || 'Sin clasificar')}`,
    `<strong>Tags:</strong> ${escapeXmlValue(point.tags.join(', ') || 'Sin tags')}`,
    `<strong>Zoom H6:</strong> ${escapeXmlValue(point.zoomTakeReference || 'Sin referencia')}`,
    `<strong>Micros:</strong> ${escapeXmlValue(point.microphoneSetup || 'Sin dato')}`,
    `<strong>Notas:</strong> ${escapeXmlValue(point.notes || 'Sin notas')}`,
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXmlValue(point.placeName || session.name)}</name>
    <Placemark>
      <name>${escapeXmlValue(point.placeName || 'Registro de campo')}</name>
      <description><![CDATA[${descriptionParts.join('<br />')}]]></description>
      <Point>
        <coordinates>${point.gps.lon},${point.gps.lat},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
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
    lines.push(`- Soundscape AI: ${point.soundscapeClassification?.summary || 'n/a'}`);
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

export async function exportFieldSessionPackage(session: FieldSession): Promise<FieldSessionExportSummary> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const sessionFolder = `${format(new Date(session.startedAt), 'yyyyMMdd-HHmm', { locale: es })}-${slugifyForFile(session.name)}`;
  const sortedPoints = [...session.points].sort(
    (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const missingAudioFiles: string[] = [];
  let exportedAudioCount = 0;

  zip.file(
    `${sessionFolder}/session.json`,
    JSON.stringify(
      {
        ...session,
        audioTakes: session.audioTakes.map(({ blob: _blob, ...take }) => take),
        points: sortedPoints.map((point) => ({
          ...point,
          photos: point.photos.map(({ blob: _blob, ...photo }) => photo),
        })),
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
          blob: undefined,
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

  for (const [takeIndex, take] of session.audioTakes.entries()) {
    const audioBlob = await resolveStoredBlob(take);
    if (!audioBlob) {
      missingAudioFiles.push(take.fileName);
      continue;
    }

    const extension = audioExtensionFromTake(take.fileName, take.mimeType);
    const safeFileName = slugifyForFile(take.fileName.replace(/\.[^/.]+$/, ''));
    zip.file(
      `${sessionFolder}/takes/files/${String(takeIndex + 1).padStart(3, '0')}-${safeFileName}.${extension}`,
      audioBlob,
    );
    exportedAudioCount += 1;
  }

  if (missingAudioFiles.length > 0) {
    zip.file(
      `${sessionFolder}/takes/missing-audio.txt`,
      [
        'Algunas tomas H6 no pudieron incluirse en este ZIP.',
        '',
        'Esto ocurre cuando la sesión sólo conserva metadatos del audio, pero no el binario local ni una copia en Blob.',
        'Solución: reimporta la carpeta original de la Zoom H6 en esta sesión o sincroniza el audio a la nube y exporta otra vez.',
        '',
        'Tomas ausentes:',
        ...missingAudioFiles.map((fileName) => `- ${fileName}`),
      ].join('\n'),
    );
  }

  for (const [index, point] of sortedPoints.entries()) {
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
            cloudPath: photo.cloudPath ?? null,
            cloudUrl: photo.cloudUrl ?? null,
            cloudSyncedAt: photo.cloudSyncedAt ?? null,
          })),
        },
        null,
        2,
      ),
    );

    for (const [photoIndex, photo] of point.photos.entries()) {
      const photoBlob = await resolveStoredBlob(photo);
      if (!photoBlob) {
        continue;
      }

      const extension = imageExtensionFromMimeType(photo.mimeType);
      const safeFileName = slugifyForFile(photo.fileName.replace(/\.[^/.]+$/, ''));
      zip.file(
        `${pointFolder}/photos/${String(photoIndex + 1).padStart(2, '0')}-${safeFileName}.${extension}`,
        photoBlob,
      );
    }
  }

  const archiveBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(archiveBlob, `${sessionFolder}.zip`);

  return {
    exportedAudioCount,
    missingAudioCount: missingAudioFiles.length,
    missingAudioFiles,
  };
}

export function exportSessionPointCsv(session: FieldSession, point: SessionPoint): void {
  const fileName = `${slugifyForFile(session.name)}-${slugifyForFile(point.placeName || point.id)}.csv`;
  downloadBlob(new Blob([buildPointCsv(session, point)], { type: 'text/csv;charset=utf-8' }), fileName);
}

export function exportSessionPointKml(session: FieldSession, point: SessionPoint): void {
  const fileName = `${slugifyForFile(session.name)}-${slugifyForFile(point.placeName || point.id)}.kml`;
  downloadBlob(
    new Blob([buildPointKml(session, point)], {
      type: 'application/vnd.google-earth.kml+xml;charset=utf-8',
    }),
    fileName,
  );
}
