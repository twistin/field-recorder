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

export async function exportFieldSessionPackage(session: FieldSession): Promise<void> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const sessionFolder = `${format(new Date(session.startedAt), 'yyyyMMdd-HHmm', { locale: es })}-${slugifyForFile(session.name)}`;

  zip.file(
    `${sessionFolder}/session.json`,
    JSON.stringify(
      {
        ...session,
        photosCount: session.points.reduce((count, point) => count + point.photos.length, 0),
        pointsCount: session.points.length,
      },
      null,
      2,
    ),
  );

  session.points.forEach((point, index) => {
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
