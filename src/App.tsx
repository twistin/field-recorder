import React, { useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  Bird,
  Camera,
  CarFront,
  CloudRain,
  Download,
  FileSpreadsheet,
  House,
  History,
  ImagePlus,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Mic,
  MoonStar,
  RefreshCw,
  Search,
  Sparkles,
  SunMedium,
  Trash2,
  Upload,
  Waves,
  WifiOff,
  Wind,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { v4 as uuidv4 } from 'uuid';

import { FieldActivityMap } from './components/FieldActivityMap';
import { SessionMap } from './components/SessionMap';
import { SessionPointCard } from './components/SessionPointCard';
import {
  deleteFieldSession,
  listFieldSessions,
  saveFieldSession,
} from './lib/fieldSessionsDb';
import {
  exportFieldSessionPackage,
  exportSessionPointCsv,
  exportSessionPointKml,
} from './lib/exportFieldSession';
import { reverseGeocodePlace } from './lib/locationLookup';
import { captureSoundscapeClassification } from './lib/soundscapeClassification';
import { fetchAutomaticWeather } from './lib/weather';
import {
  buildImportedAudioTakes,
  isSupportedImportedAudioFileName,
  mergeSessionAudioTakes,
  reconcileSessionAudioTakes,
} from './lib/zoomImport';
import { syncSessionToCloud } from './lib/cloudSync';
import type { CatalogSessionPayload, CatalogSessionSummary } from './lib/catalogPayload';
import {
  CATALOG_API_UNAVAILABLE_MESSAGE,
  fetchCatalogSessionRemote,
  isCatalogApiUnavailableError,
  listCatalogSessionsRemote,
  syncSessionToCatalog,
} from './lib/catalogSync';
import type {
  AutomaticWeatherSummary,
  DetectedPlaceSummary,
  FieldSession,
  GpsCoordinates,
  SessionAudioTake,
  SessionPhoto,
  SessionPoint,
  SoundscapeClassification,
} from './types/fieldSessions';

type View = 'home' | 'session' | 'point' | 'export';
type DisplayMode = 'night' | 'sun';

const DISPLAY_MODE_STORAGE_KEY = 'fieldnotes-display-mode';
const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 45_000;
const REMOTE_CATALOG_REFRESH_MIN_GAP_MS = 12_000;

interface SessionDraft {
  name: string;
  projectName: string;
  region: string;
  notes: string;
  equipmentPreset: string;
}

interface PointDraft {
  placeName: string;
  habitat: string;
  characteristics: string;
  observedWeather: string;
  tagsText: string;
  notes: string;
  zoomTakeReference: string;
  microphoneSetup: string;
  latitude: string;
  longitude: string;
  coordinateSource: 'auto' | 'manual';
}

interface DraftPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  previewUrl: string;
}

interface UiSessionPhoto extends SessionPhoto {
  previewUrl: string | null;
}

interface UiSessionPoint extends Omit<SessionPoint, 'photos'> {
  photos: UiSessionPhoto[];
}

interface UiFieldSession extends Omit<FieldSession, 'points'> {
  points: UiSessionPoint[];
}

interface ProjectArchiveGroup {
  key: string;
  name: string;
  sessions: UiFieldSession[];
  sessionCount: number;
  pointCount: number;
  photoCount: number;
  audioTakeCount: number;
  activeSessionCount: number;
  latestStartedAt: string;
}

interface RecordEntry {
  sessionId: string;
  sessionName: string;
  projectName: string;
  region: string;
  sessionStatus: UiFieldSession['status'];
  point: UiSessionPoint;
}

interface SoundscapeBadge {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

function formatDateTime(value: Date | string, pattern: string) {
  return format(typeof value === 'string' ? new Date(value) : value, pattern, { locale: es });
}

function resolveProjectName(projectName: string): string {
  return projectName.trim() || 'Sin trabajo';
}

function buildProjectKey(projectName: string): string {
  return resolveProjectName(projectName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-trabajo';
}

function normalizeTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTakeDuration(durationSeconds: number | null): string {
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) {
    return 'Duración n/d';
  }

  if (durationSeconds < 60) {
    return `${durationSeconds.toFixed(1)} s`;
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = Math.round(durationSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatTakeTechnicalSummary(take: SessionAudioTake): string {
  const parts = [
    take.channels ? `${take.channels} ch` : null,
    take.sampleRateHz ? `${Math.round(take.sampleRateHz / 1000)} kHz` : null,
    take.bitDepth ? `${take.bitDepth} bit` : null,
    take.durationSeconds != null ? formatTakeDuration(take.durationSeconds) : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' · ') : 'Metadatos técnicos pendientes';
}

function parseOptionalNumber(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalBoolean(value: string): boolean | null {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return null;
}

function shouldOverwritePointPlaceName(placeName: string): boolean {
  const normalized = placeName.trim();
  return !normalized || /^Punto\s\d{2}:\d{2}:\d{2}$/i.test(normalized);
}

function pointNeedsLocationEnrichment(point: Pick<SessionPoint, 'detectedPlace'>): boolean {
  return !point.detectedPlace;
}

function pointNeedsWeatherEnrichment(point: Pick<SessionPoint, 'automaticWeather'>): boolean {
  return !point.automaticWeather;
}

function pointNeedsAutomaticEnrichment(
  point: Pick<SessionPoint, 'automaticWeather' | 'detectedPlace'>,
): boolean {
  return pointNeedsLocationEnrichment(point) || pointNeedsWeatherEnrichment(point);
}

function parseCoordinate(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSessionDraft(): SessionDraft {
  const now = new Date();
  return {
    name: `Salida ${format(now, 'yyyy-MM-dd', { locale: es })}`,
    projectName: '',
    region: '',
    notes: '',
    equipmentPreset: 'Zoom H6 · XY',
  };
}

function buildPointDraft(
  equipmentPreset = 'Zoom H6 · XY',
  currentGps: GpsCoordinates | null = null,
): PointDraft {
  return {
    placeName: '',
    habitat: '',
    characteristics: '',
    observedWeather: '',
    tagsText: '',
    notes: '',
    zoomTakeReference: '',
    microphoneSetup: equipmentPreset,
    latitude: currentGps ? currentGps.lat.toFixed(6) : '',
    longitude: currentGps ? currentGps.lon.toFixed(6) : '',
    coordinateSource: 'auto',
  };
}

function normalizeAudioTake(take: SessionAudioTake): SessionAudioTake {
  return {
    ...take,
    durationSeconds: take.durationSeconds ?? null,
    sampleRateHz: take.sampleRateHz ?? null,
    bitDepth: take.bitDepth ?? null,
    channels: take.channels ?? null,
    inputSetup: take.inputSetup ?? '',
    lowCutEnabled: take.lowCutEnabled ?? null,
    limiterEnabled: take.limiterEnabled ?? null,
    phantomPowerEnabled: take.phantomPowerEnabled ?? null,
    takeNotes: take.takeNotes ?? '',
  };
}

function prepareSessionForLocalMutation(
  session: FieldSession,
  options?: { markCloudPending?: boolean; markCatalogPending?: boolean },
): FieldSession {
  const preserveCloudSyncState = options?.markCloudPending === false;
  const preserveCatalogSyncState = options?.markCatalogPending === false;

  return {
    ...session,
    cloudSyncStatus: preserveCloudSyncState ? session.cloudSyncStatus ?? 'local-only' : 'pending',
    cloudError: preserveCloudSyncState ? session.cloudError ?? null : null,
    catalogSyncStatus: preserveCatalogSyncState ? session.catalogSyncStatus ?? 'local-only' : 'pending',
    catalogError: preserveCatalogSyncState ? session.catalogError ?? null : null,
  };
}

function normalizeFieldSession(session: FieldSession): FieldSession {
  return {
    ...session,
    audioTakes: (session.audioTakes ?? [])
      .filter((take) => isSupportedImportedAudioFileName(take.fileName))
      .map(normalizeAudioTake),
    points: (session.points ?? []).map((point) => ({
      ...point,
      soundscapeClassification: point.soundscapeClassification ?? null,
    })),
    cloudSyncStatus: session.cloudSyncStatus ?? 'local-only',
    cloudSyncedAt: session.cloudSyncedAt ?? null,
    cloudError: session.cloudError ?? null,
    cloudManifestPath: session.cloudManifestPath ?? null,
    cloudManifestUrl: session.cloudManifestUrl ?? null,
    catalogSyncStatus: session.catalogSyncStatus ?? 'local-only',
    catalogSyncedAt: session.catalogSyncedAt ?? null,
    catalogError: session.catalogError ?? null,
  };
}

function buildPhotoPreviewUrl(photo: Pick<SessionPhoto, 'blob' | 'cloudPath' | 'cloudUrl'>): string | null {
  if (photo.blob.size > 0) {
    return URL.createObjectURL(photo.blob);
  }

  const remoteSource = photo.cloudPath ?? photo.cloudUrl;
  return remoteSource ? `/api/storage/photo?blob=${encodeURIComponent(remoteSource)}` : null;
}

function buildPlaceholderPhotoBlob(mimeType: string): Blob {
  return new Blob([], { type: mimeType || 'application/octet-stream' });
}

function shouldReusePhotoPreview(existingPhoto: UiSessionPhoto, nextPhoto: SessionPhoto): boolean {
  if (!existingPhoto.previewUrl) {
    return false;
  }

  if (existingPhoto.blob.size > 0) {
    return true;
  }

  return Boolean(existingPhoto.cloudUrl && existingPhoto.cloudUrl === nextPhoto.cloudUrl);
}

function buildCatalogSessionForUi(
  session: CatalogSessionPayload,
  summary: CatalogSessionSummary,
  existingSession?: UiFieldSession | null,
): UiFieldSession {
  const existingPoints = new Map((existingSession?.points ?? []).map((point) => [point.id, point]));

  const normalizedSession = normalizeFieldSession({
    ...session,
    catalogSyncStatus: 'synced',
    catalogSyncedAt: summary.updatedAt,
    catalogError: null,
    points: session.points.map((point) => {
      const existingPoint = existingPoints.get(point.id);
      const existingPhotos = new Map((existingPoint?.photos ?? []).map((photo) => [photo.id, photo]));

      return {
        ...point,
        photos: point.photos.map((photo) => {
          const existingPhoto = existingPhotos.get(photo.id);

          return {
            ...photo,
            blob:
              existingPhoto?.blob && existingPhoto.blob.size > 0
                ? existingPhoto.blob
                : buildPlaceholderPhotoBlob(photo.mimeType),
          };
        }),
      };
    }),
  });

  return {
    ...normalizedSession,
    points: normalizedSession.points.map((point) => {
      const existingPoint = existingPoints.get(point.id);
      const existingPhotos = new Map((existingPoint?.photos ?? []).map((photo) => [photo.id, photo]));

      return {
        ...point,
        photos: point.photos.map((photo) => {
          const existingPhoto = existingPhotos.get(photo.id);

          return {
            ...photo,
            previewUrl:
              existingPhoto && shouldReusePhotoPreview(existingPhoto, photo)
                ? existingPhoto.previewUrl
                : buildPhotoPreviewUrl(photo),
          };
        }),
      };
    }),
  };
}

function canReplaceSessionFromRemoteCatalog(session: UiFieldSession): boolean {
  if (
    session.catalogSyncStatus === 'pending' ||
    session.catalogSyncStatus === 'syncing' ||
    session.catalogSyncStatus === 'error'
  ) {
    return false;
  }

  if (session.catalogSyncStatus === 'local-only' && !session.catalogSyncedAt) {
    return false;
  }

  return true;
}

function hydrateSession(session: FieldSession): UiFieldSession {
  const normalizedSession = normalizeFieldSession(session);
  const reconciledAudioTakes = reconcileSessionAudioTakes(normalizedSession.points, normalizedSession.audioTakes);
  return {
    ...normalizedSession,
    audioTakes: reconciledAudioTakes,
    points: normalizedSession.points.map((point) => ({
      ...point,
      photos: point.photos.map((photo) => ({
        ...photo,
        previewUrl: buildPhotoPreviewUrl(photo),
      })),
    })),
  };
}

function dehydrateSession(session: UiFieldSession): FieldSession {
  return {
    ...session,
    points: session.points.map((point) => ({
      ...point,
      photos: point.photos.map(({ previewUrl: _previewUrl, ...photo }) => photo),
    })),
  };
}

function mergeCloudSyncedSessionIntoUi(
  cloudSession: FieldSession,
  currentUiSession: UiFieldSession,
): UiFieldSession {
  return {
    ...currentUiSession,
    cloudSyncStatus: cloudSession.cloudSyncStatus ?? currentUiSession.cloudSyncStatus,
    cloudSyncedAt: cloudSession.cloudSyncedAt ?? currentUiSession.cloudSyncedAt,
    cloudError: cloudSession.cloudError ?? null,
    cloudManifestPath: cloudSession.cloudManifestPath ?? currentUiSession.cloudManifestPath ?? null,
    cloudManifestUrl: cloudSession.cloudManifestUrl ?? currentUiSession.cloudManifestUrl ?? null,
    points: currentUiSession.points.map((point) => {
      const syncedPoint = cloudSession.points.find((entry) => entry.id === point.id);
      if (!syncedPoint) {
        return point;
      }

      return {
        ...point,
        photos: point.photos.map((photo) => {
          const syncedPhoto = syncedPoint.photos.find((entry) => entry.id === photo.id);
          if (!syncedPhoto) {
            return photo;
          }

          return {
            ...photo,
            cloudPath: syncedPhoto.cloudPath ?? null,
            cloudUrl: syncedPhoto.cloudUrl ?? null,
            cloudSyncedAt: syncedPhoto.cloudSyncedAt ?? null,
          };
        }),
      };
    }),
  };
}

function revokeSessionUrls(session: UiFieldSession) {
  session.points.forEach((point) => {
    point.photos.forEach((photo) => {
      if (photo.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(photo.previewUrl);
      }
    });
  });
}

function resolvePointCoordinates(
  draft: PointDraft,
  currentGps: GpsCoordinates | null,
): GpsCoordinates | null {
  const latitude = parseCoordinate(draft.latitude);
  const longitude = parseCoordinate(draft.longitude);

  if (latitude !== null && longitude !== null) {
    return {
      lat: latitude,
      lon: longitude,
      accuracy: currentGps?.accuracy ?? null,
    };
  }

  if (draft.latitude.trim() || draft.longitude.trim()) {
    return null;
  }

  return currentGps;
}

function buildSessionMapPoints(points: UiSessionPoint[]) {
  return [...points]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .map((point, index) => ({
      id: point.id,
      placeName: point.placeName,
      lat: point.gps.lat,
      lon: point.gps.lon,
      orderLabel: String(index + 1),
    }));
}

function groupSessionsByProject(sessions: UiFieldSession[]): ProjectArchiveGroup[] {
  const groups = new Map<string, ProjectArchiveGroup>();

  sessions.forEach((session) => {
    const name = resolveProjectName(session.projectName);
    const key = buildProjectKey(session.projectName);
    const photoCount = session.points.reduce((count, point) => count + point.photos.length, 0);
    const existing = groups.get(key);

    if (existing) {
      existing.sessions.push(session);
      existing.sessionCount += 1;
      existing.pointCount += session.points.length;
      existing.photoCount += photoCount;
      existing.audioTakeCount += session.audioTakes.length;
      existing.activeSessionCount += session.status === 'active' ? 1 : 0;
      if (new Date(session.startedAt).getTime() > new Date(existing.latestStartedAt).getTime()) {
        existing.latestStartedAt = session.startedAt;
      }
      return;
    }

    groups.set(key, {
      key,
      name,
      sessions: [session],
      sessionCount: 1,
      pointCount: session.points.length,
      photoCount,
      audioTakeCount: session.audioTakes.length,
      activeSessionCount: session.status === 'active' ? 1 : 0,
      latestStartedAt: session.startedAt,
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort(
        (left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
      ),
    }))
    .sort((left, right) => new Date(right.latestStartedAt).getTime() - new Date(left.latestStartedAt).getTime());
}

function flattenSessionRecords(sessions: UiFieldSession[]): RecordEntry[] {
  return sessions
    .flatMap((session) =>
      session.points.map((point) => ({
        sessionId: session.id,
        sessionName: session.name,
        projectName: resolveProjectName(session.projectName),
        region: session.region,
        sessionStatus: session.status,
        point,
      })),
    )
    .sort((left, right) => new Date(right.point.createdAt).getTime() - new Date(left.point.createdAt).getTime());
}

function buildActivityClusters(records: RecordEntry[]) {
  const clusters = new Map<
    string,
    {
      id: string;
      lat: number;
      lon: number;
      count: number;
      label: string;
      latestAt: string;
    }
  >();

  for (const record of records) {
    const key = `${record.point.gps.lat.toFixed(1)}:${record.point.gps.lon.toFixed(1)}`;
    const existing = clusters.get(key);

    if (existing) {
      existing.count += 1;
      if (new Date(record.point.createdAt).getTime() > new Date(existing.latestAt).getTime()) {
        existing.latestAt = record.point.createdAt;
        existing.label = record.point.placeName || existing.label;
      }
      continue;
    }

    clusters.set(key, {
      id: key,
      lat: record.point.gps.lat,
      lon: record.point.gps.lon,
      count: 1,
      label: record.point.placeName || record.projectName,
      latestAt: record.point.createdAt,
    });
  }

  return Array.from(clusters.values()).sort((left, right) => right.count - left.count);
}

function getGreetingLabel(now: number): string {
  const hours = new Date(now).getHours();
  if (hours < 12) {
    return 'Buenos días';
  }
  if (hours < 20) {
    return 'Buenas tardes';
  }
  return 'Buenas noches';
}

function mergeDraftTagsWithSoundscape(tagsText: string, classification: SoundscapeClassification | null): string[] {
  return Array.from(new Set([...normalizeTags(tagsText), ...(classification?.tags ?? [])]));
}

function resolveSoundscapeBadge(point: UiSessionPoint): SoundscapeBadge {
  const tags = point.soundscapeClassification?.tags ?? point.tags;
  const normalized = tags.map((tag) => tag.toLowerCase());

  if (normalized.some((tag) => tag.includes('pájar') || tag.includes('pajar') || tag.includes('aves') || tag.includes('bird'))) {
    return { label: 'Pájaros', icon: Bird };
  }
  if (normalized.some((tag) => tag.includes('persona') || tag.includes('voz') || tag.includes('hablando'))) {
    return { label: 'Voces', icon: Mic };
  }
  if (normalized.some((tag) => tag.includes('música') || tag.includes('musica'))) {
    return { label: 'Música', icon: AudioWaveform };
  }
  if (normalized.some((tag) => tag.includes('paso') || tag.includes('pisada'))) {
    return { label: 'Pasos', icon: AudioWaveform };
  }
  if (normalized.some((tag) => tag.includes('lluvia'))) {
    return { label: 'Lluvia', icon: CloudRain };
  }
  if (normalized.some((tag) => tag.includes('río') || tag.includes('rio') || tag.includes('arroyo') || tag.includes('mar') || tag.includes('oleaje') || tag.includes('agua'))) {
    return { label: 'Agua', icon: Waves };
  }
  if (normalized.some((tag) => tag.includes('tráfico') || tag.includes('trafico'))) {
    return { label: 'Tráfico', icon: CarFront };
  }
  if (normalized.some((tag) => tag.includes('viento'))) {
    return { label: 'Viento', icon: Wind };
  }

  return { label: 'IA sonora', icon: AudioWaveform };
}

function formatGpsReadyMessage(location: GpsCoordinates): string {
  return location.accuracy
    ? `GPS estable dentro de ${Math.round(location.accuracy)} m.`
    : 'GPS activo.';
}

function describeGeolocationError(error: GeolocationPositionError, hasPreviousFix: boolean): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Permiso de ubicación bloqueado. Actívalo en el navegador o en el sistema.';
    case error.POSITION_UNAVAILABLE:
      return hasPreviousFix
        ? 'Conservo la última posición válida. El dispositivo no entrega una nueva fijación ahora.'
        : 'El dispositivo no está entregando una posición. Revisa GPS, cobertura o modo avión.';
    case error.TIMEOUT:
      return hasPreviousFix
        ? 'Conservo la última posición válida. La nueva fijación está tardando demasiado.'
        : 'La fijación GPS está tardando demasiado. Reintenta al aire libre.';
    default:
      return 'No se pudo obtener la posición actual.';
  }
}

function ViewButton({
  active,
  label,
  description,
  icon: Icon,
  onClick,
  compact = false,
}: {
  active: boolean;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`dock-button ${active ? 'is-active' : ''} ${compact ? 'is-compact' : ''}`}
    >
      <span className="dock-button__icon">
        <Icon className="h-4 w-4" />
      </span>
      <span className="dock-button__text">
        <span className="dock-button__label">{label}</span>
        {!compact ? <span className="dock-button__description">{description}</span> : null}
      </span>
    </button>
  );
}

function WorkflowCard({
  eyebrow,
  title,
  description,
  status,
  cta,
  icon: Icon,
  featured = false,
  onClick,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  featured?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.995 }}
      onClick={onClick}
      className={`workflow-card ${featured ? 'is-featured' : ''}`}
    >
      <span className="workflow-card__icon">
        <Icon className="h-5 w-5" />
      </span>
      <span className="workflow-card__body">
        <span className="eyebrow">{eyebrow}</span>
        <span className="display-heading workflow-card__title">{title}</span>
        <span className="module-copy text-sm">{description}</span>
      </span>
      <span className="workflow-card__footer">
        <strong>{status}</strong>
        <span className="workflow-card__cta">{cta}</span>
      </span>
    </motion.button>
  );
}

function HomeHeroVisual() {
  return (
    <div className="home-topbar__visual" aria-hidden="true">
      <div className="hero-emblem">
        <div className="hero-emblem__halo hero-emblem__halo--outer" />
        <div className="hero-emblem__halo hero-emblem__halo--inner" />
        <div className="hero-emblem__core">
          <div className="hero-emblem__glyph">
            <MapPinned className="h-8 w-8" />
          </div>
          <div className="hero-emblem__pulse">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>

      <div className="hero-schematic">
        <div className="hero-schematic__card hero-schematic__card--primary">
          <p className="eyebrow">Field Mark</p>
          <p className="display-heading hero-schematic__title">Contexto + posición + escucha</p>
          <div className="hero-schematic__icons">
            <span><LocateFixed className="h-4 w-4" /> GPS</span>
            <span><AudioWaveform className="h-4 w-4" /> Audio</span>
            <span><Sparkles className="h-4 w-4" /> IA</span>
          </div>
        </div>

        <div className="hero-schematic__card hero-schematic__card--micro">
          <span className="hero-schematic__mini-label">Rastro</span>
          <div className="hero-schematic__wave">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(buildSessionDraft());
  const [pointDraft, setPointDraft] = useState<PointDraft>(buildPointDraft());
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([]);
  const [dashboardQuery, setDashboardQuery] = useState('');
  const [sessions, setSessions] = useState<UiFieldSession[]>([]);
  const [selectedArchiveProjectKey, setSelectedArchiveProjectKey] = useState<'all' | string>('all');
  const [projectDraftName, setProjectDraftName] = useState('');
  const [captureWorkspace, setCaptureWorkspace] = useState<'map' | 'points'>('map');
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => {
    if (typeof window === 'undefined') {
      return 'night';
    }

    try {
      const storedValue = window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
      return storedValue === 'sun' || storedValue === 'night' ? storedValue : 'night';
    } catch {
      return 'night';
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [recordSessionId, setRecordSessionId] = useState<string | null>(null);
  const [recordPointId, setRecordPointId] = useState<string | null>(null);
  const [currentGps, setCurrentGps] = useState<GpsCoordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  const [gpsMessage, setGpsMessage] = useState('Buscando señal GPS...');
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [locationMessage, setLocationMessage] = useState('Esperando coordenadas para detectar el lugar.');
  const [detectedPlace, setDetectedPlace] = useState<DetectedPlaceSummary | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [weatherMessage, setWeatherMessage] = useState('Esperando coordenadas para consultar el clima.');
  const [weatherSnapshot, setWeatherSnapshot] = useState<AutomaticWeatherSummary | null>(null);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [now, setNow] = useState(() => Date.now());
  const [storageMode, setStorageMode] = useState<'loading' | 'ready' | 'memory-only'>('loading');
  const [statusNote, setStatusNote] = useState('Inicia una salida y ve registrando puntos con GPS, clima, notas y fotos.');
  const [appError, setAppError] = useState<string | null>(null);
  const [isExportingSessionId, setIsExportingSessionId] = useState<string | null>(null);
  const [isQuickCapturing, setIsQuickCapturing] = useState(false);
  const [draftSoundscapeClassification, setDraftSoundscapeClassification] = useState<SoundscapeClassification | null>(null);
  const [soundscapeStatus, setSoundscapeStatus] = useState<'idle' | 'listening' | 'ready' | 'error'>('idle');
  const [soundscapeMessage, setSoundscapeMessage] = useState(
    'Escucha local de 15 segundos para detectar aves, voces, música, pasos o agua. No se guarda el audio.',
  );
  const [isImportingSessionId, setIsImportingSessionId] = useState<string | null>(null);
  const [isSyncingPendingMetadata, setIsSyncingPendingMetadata] = useState(false);
  const [isSyncingCloudSessionId, setIsSyncingCloudSessionId] = useState<string | null>(null);
  const [isSyncingCatalogSessionId, setIsSyncingCatalogSessionId] = useState<string | null>(null);
  const [isUpdatingProjectKey, setIsUpdatingProjectKey] = useState<string | null>(null);
  const [catalogApiStatus, setCatalogApiStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [zoomImportTargetSessionId, setZoomImportTargetSessionId] = useState<string | null>(null);

  const currentGpsRef = useRef<GpsCoordinates | null>(null);
  const sessionsRef = useRef<UiFieldSession[]>([]);
  const draftPhotosRef = useRef<DraftPhoto[]>([]);
  const zoomImportInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingPendingMetadataRef = useRef(false);
  const isSyncingCloudSessionIdRef = useRef<string | null>(null);
  const isSyncingCatalogSessionIdRef = useRef<string | null>(null);
  const isRefreshingRemoteCatalogRef = useRef(false);
  const locationAbortRef = useRef<AbortController | null>(null);
  const lastRemoteCatalogRefreshAtRef = useRef(0);
  const lastLocationKeyRef = useRef<string | null>(null);
  const lastAutomaticPlaceValueRef = useRef<string>('');
  const weatherAbortRef = useRef<AbortController | null>(null);
  const lastWeatherKeyRef = useRef<string | null>(null);
  const lastAutomaticWeatherValueRef = useRef<string>('');

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const sortedActiveSessionPoints = activeSession
    ? [...activeSession.points].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
    : [];
  const selectedPoint =
    activeSession?.points.find((point) => point.id === selectedPointId) ?? sortedActiveSessionPoints[0] ?? null;
  const activeSessionMapPoints = activeSession ? buildSessionMapPoints(activeSession.points) : [];
  const archiveProjectGroups = groupSessionsByProject(sessions);
  const allRecords = flattenSessionRecords(sessions);
  const dashboardSearch = dashboardQuery.trim().toLowerCase();
  const filteredRecentRecords = dashboardSearch
    ? allRecords.filter((record) =>
        [
          record.point.placeName,
          record.projectName,
          record.region,
          record.point.zoomTakeReference,
          record.point.soundscapeClassification?.summary ?? '',
          record.point.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(dashboardSearch),
      )
    : allRecords;
  const recentRecords = filteredRecentRecords.slice(0, 6);
  const activityClusters = buildActivityClusters(allRecords);
  const fallbackRecord = allRecords[0] ?? null;
  const recordSession =
    sessions.find((session) => session.id === recordSessionId) ??
    (fallbackRecord ? sessions.find((session) => session.id === fallbackRecord.sessionId) ?? null : null);
  const recordPoint =
    recordSession?.points.find((point) => point.id === recordPointId) ??
    (fallbackRecord && recordSession?.id === fallbackRecord.sessionId ? fallbackRecord.point : recordSession?.points[0] ?? null);
  const draftPointCoordinates = resolvePointCoordinates(pointDraft, currentGps);
  const draftPointLabel = pointDraft.placeName.trim() || detectedPlace?.placeName || 'Punto preparado';
  const knownProjectNames = Array.from(
    new Set(
      sessions
        .map((session) => session.projectName.trim())
        .filter(Boolean),
    ),
  ).sort((left: string, right: string) => left.localeCompare(right, 'es'));
  const visibleArchiveProjectGroups =
    selectedArchiveProjectKey === 'all'
      ? archiveProjectGroups
      : archiveProjectGroups.filter((group) => group.key === selectedArchiveProjectKey);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    draftPhotosRef.current = draftPhotos;
  }, [draftPhotos]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.displayMode = displayMode;
      document.body.dataset.displayMode = displayMode;
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
      } catch {
        // Ignore storage failures and keep the current in-memory preference.
      }
    }
  }, [displayMode]);

  useEffect(() => {
    if (selectedArchiveProjectKey === 'all') {
      return;
    }

    if (!archiveProjectGroups.some((group) => group.key === selectedArchiveProjectKey)) {
      setSelectedArchiveProjectKey('all');
    }
  }, [archiveProjectGroups, selectedArchiveProjectKey]);

  useEffect(() => {
    if (allRecords.length === 0) {
      setRecordSessionId(null);
      setRecordPointId(null);
      return;
    }

    const hasSession = recordSessionId && sessions.some((session) => session.id === recordSessionId);
    const sessionForFocus = hasSession
      ? sessions.find((session) => session.id === recordSessionId) ?? null
      : null;
    const hasPoint = sessionForFocus && recordPointId
      ? sessionForFocus.points.some((point) => point.id === recordPointId)
      : false;

    if (hasSession && hasPoint) {
      return;
    }

    setRecordSessionId(allRecords[0].sessionId);
    setRecordPointId(allRecords[0].point.id);
  }, [allRecords, recordPointId, recordSessionId, sessions]);

  useEffect(() => {
    if (!zoomImportInputRef.current) {
      return;
    }

    zoomImportInputRef.current.setAttribute('webkitdirectory', '');
    zoomImportInputRef.current.setAttribute('directory', '');
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatusNote('Conexión recuperada. Reintentando sincronizar lugar y clima pendientes.');
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatusNote('Modo offline activo. Los puntos se guardarán y se enriquecerán al volver la conexión.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSessions() {
      try {
        const stored = await listFieldSessions();
        const hydrated = stored.map(hydrateSession);

        if (!active) {
          hydrated.forEach(revokeSessionUrls);
          return;
        }

        setSessions((previous) => {
          previous.forEach(revokeSessionUrls);
          return hydrated;
        });

        const activeStoredSession = hydrated.find((session) => session.status === 'active');
        setActiveSessionId(activeStoredSession?.id ?? null);
        setStorageMode('ready');
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Loading sessions failed:', error);
        setStorageMode('memory-only');
        setStatusNote('No se pudo abrir el archivo local. La salida actual quedará sólo en memoria.');
      }
    }

    loadSessions();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let permissionStatus: PermissionStatus | null = null;

    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsMessage('Este navegador no expone geolocalización.');
      return undefined;
    }

    if (!window.isSecureContext) {
      setGpsStatus('error');
      setGpsMessage('La ubicación web requiere abrir la app en HTTPS o en localhost.');
      return undefined;
    }

    const syncPermissionState = (state: PermissionState) => {
      if (!active) {
        return;
      }

      if (state === 'denied') {
        setGpsStatus('error');
        setGpsMessage('Permiso de ubicación bloqueado. Actívalo en el navegador o en el sistema.');
        return;
      }

      if (state === 'prompt' && !currentGpsRef.current) {
        setGpsStatus('pending');
        setGpsMessage('Pulsa "Activar GPS" para conceder permiso y obtener la posición.');
      }
    };

    if (navigator.permissions?.query) {
      void navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (!active) {
            return;
          }

          permissionStatus = status;
          syncPermissionState(status.state);
          status.onchange = () => syncPermissionState(status.state);
        })
        .catch(() => {
          // Some browsers do not support the permissions API cleanly.
        });
    }

    void requestCurrentLocation({ silent: true });

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!active) {
          return;
        }

        const nextLocation = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        };

        commitGpsLocation(nextLocation);
      },
      (error) => {
        if (!active) {
          return;
        }

        if (currentGpsRef.current && error.code !== error.PERMISSION_DENIED) {
          setGpsStatus('ready');
          setGpsMessage(describeGeolocationError(error, true));
          return;
        }

        setGpsStatus('error');
        setGpsMessage(describeGeolocationError(error, false));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 20_000,
      },
    );

    return () => {
      active = false;
      if (permissionStatus) {
        permissionStatus.onchange = null;
      }
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  useEffect(() => {
    setSelectedPointId((current) => {
      if (!activeSession) {
        return null;
      }

      if (current && activeSession.points.some((point) => point.id === current)) {
        return current;
      }

      return activeSession.points[0]?.id ?? null;
    });
  }, [activeSession]);

  useEffect(() => {
    if (!currentGps) {
      return;
    }

    setPointDraft((previous) => {
      if (previous.coordinateSource !== 'auto') {
        return previous;
      }

      const latitude = currentGps.lat.toFixed(6);
      const longitude = currentGps.lon.toFixed(6);

      if (previous.latitude === latitude && previous.longitude === longitude) {
        return previous;
      }

      return {
        ...previous,
        latitude,
        longitude,
      };
    });
  }, [currentGps]);

  useEffect(() => {
    const coordinates = resolvePointCoordinates(pointDraft, currentGps);
    if (!coordinates) {
      locationAbortRef.current?.abort();
      setLocationStatus('idle');
      setLocationMessage('Esperando coordenadas válidas para detectar el lugar.');
      setDetectedPlace(null);
      lastLocationKeyRef.current = null;
      return;
    }

    if (!isOnline) {
      locationAbortRef.current?.abort();
      setLocationStatus('idle');
      setLocationMessage('Sin conexión. El lugar se resolverá cuando vuelva la red.');
      setDetectedPlace(null);
      lastLocationKeyRef.current = null;
      return;
    }

    const timerId = window.setTimeout(() => {
      void refreshDetectedPlaceForCoordinates(coordinates);
    }, 700);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isOnline, pointDraft.coordinateSource, pointDraft.latitude, pointDraft.longitude, currentGps?.lat, currentGps?.lon]);

  useEffect(() => {
    const coordinates = resolvePointCoordinates(pointDraft, currentGps);
    if (!coordinates) {
      weatherAbortRef.current?.abort();
      setWeatherStatus('idle');
      setWeatherMessage('Esperando coordenadas válidas para consultar el clima.');
      setWeatherSnapshot(null);
      lastWeatherKeyRef.current = null;
      return;
    }

    if (!isOnline) {
      weatherAbortRef.current?.abort();
      setWeatherStatus('idle');
      setWeatherMessage('Sin conexión. El clima se consultará cuando vuelva la red.');
      setWeatherSnapshot(null);
      lastWeatherKeyRef.current = null;
      return;
    }

    const timerId = window.setTimeout(() => {
      void refreshWeatherForCoordinates(coordinates);
    }, 550);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isOnline, pointDraft.coordinateSource, pointDraft.latitude, pointDraft.longitude, currentGps?.lat, currentGps?.lon]);

  useEffect(() => {
    return () => {
      sessionsRef.current.forEach(revokeSessionUrls);
      draftPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      locationAbortRef.current?.abort();
      weatherAbortRef.current?.abort();
    };
  }, []);

  function replaceSessionInState(nextSession: UiFieldSession) {
    setSessions((current) => {
      const existingIndex = current.findIndex((session) => session.id === nextSession.id);
      if (existingIndex === -1) {
        return [nextSession, ...current];
      }

      const next = [...current];
      next[existingIndex] = nextSession;
      return next;
    });
  }

  function commitGpsLocation(nextLocation: GpsCoordinates) {
    currentGpsRef.current = nextLocation;
    setCurrentGps(nextLocation);
    setGpsStatus('ready');
    setGpsMessage(formatGpsReadyMessage(nextLocation));
  }

  async function requestCurrentLocation(options?: { silent?: boolean }): Promise<GpsCoordinates | null> {
    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsMessage('Este navegador no expone geolocalización.');
      return null;
    }

    if (!window.isSecureContext) {
      setGpsStatus('error');
      setGpsMessage('La ubicación web requiere abrir la app en HTTPS o en localhost.');
      return null;
    }

    if (!options?.silent) {
      setGpsStatus('pending');
      setGpsMessage('Solicitando una fijación GPS...');
    }

    return await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const nextLocation = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
          };

          commitGpsLocation(nextLocation);
          resolve(nextLocation);
        },
        (error) => {
          const hasPreviousFix = Boolean(currentGpsRef.current);
          if (hasPreviousFix && error.code !== error.PERMISSION_DENIED) {
            setGpsStatus('ready');
            setGpsMessage(describeGeolocationError(error, true));
            resolve(currentGpsRef.current);
            return;
          }

          setGpsStatus('error');
          setGpsMessage(describeGeolocationError(error, hasPreviousFix));
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5_000,
          timeout: 15_000,
        },
      );
    });
  }

  async function activateGpsAndApplyToDraft() {
    setAppError(null);

    const nextLocation = currentGpsRef.current ?? (await requestCurrentLocation());
    if (!nextLocation) {
      setAppError('No pude obtener una posición GPS en este momento.');
      return;
    }

    setPointDraft((previous) => ({
      ...previous,
      latitude: nextLocation.lat.toFixed(6),
      longitude: nextLocation.lon.toFixed(6),
      coordinateSource: 'auto',
    }));
  }

  async function persistSession(
    nextSession: UiFieldSession,
    options?: { markCloudPending?: boolean; markCatalogPending?: boolean },
  ) {
    const preparedSession = options?.markCloudPending === false
      && options?.markCatalogPending === false
      ? nextSession
      : (prepareSessionForLocalMutation(nextSession, options) as UiFieldSession);

    replaceSessionInState(preparedSession);

    if (storageMode === 'memory-only') {
      return;
    }

    try {
      await saveFieldSession(dehydrateSession(preparedSession));
      setStorageMode('ready');
    } catch (error) {
      console.error('Saving session failed:', error);
      setStorageMode('memory-only');
      setStatusNote('Falló la escritura local. La salida seguirá en memoria hasta recargar.');
    }
  }

  async function refreshDetectedPlaceForCoordinates(
    coordinates: GpsCoordinates,
    options?: { force?: boolean },
  ): Promise<DetectedPlaceSummary | null> {
    if (!isOnline) {
      setLocationStatus('idle');
      setLocationMessage('Sin conexión. El lugar se resolverá cuando vuelva la red.');
      return null;
    }

    const requestKey = `${coordinates.lat.toFixed(4)},${coordinates.lon.toFixed(4)}`;
    if (!options?.force && requestKey === lastLocationKeyRef.current) {
      return detectedPlace;
    }

    locationAbortRef.current?.abort();
    const controller = new AbortController();
    locationAbortRef.current = controller;
    setLocationStatus('loading');
    setLocationMessage('Consultando nombre del lugar...');

    try {
      const place = await reverseGeocodePlace(coordinates.lat, coordinates.lon, controller.signal);
      lastLocationKeyRef.current = requestKey;
      setDetectedPlace(place);
      setLocationStatus('ready');
      setLocationMessage(place.context || place.displayName || 'Lugar resuelto por coordenadas.');

      setPointDraft((previous) => {
        const nextPlaceName = place.placeName.trim();
        const currentPlaceName = previous.placeName.trim();
        const canOverwrite =
          !currentPlaceName || currentPlaceName === lastAutomaticPlaceValueRef.current;

        if (!nextPlaceName || !canOverwrite) {
          return previous;
        }

        return {
          ...previous,
          placeName: nextPlaceName,
        };
      });

      if (place.placeName.trim()) {
        lastAutomaticPlaceValueRef.current = place.placeName.trim();
      }
      return place;
    } catch (error) {
      if (controller.signal.aborted) {
        return null;
      }

      console.error('Reverse geocoding failed:', error);
      setLocationStatus('error');
      setLocationMessage('No se pudo resolver el lugar a partir de las coordenadas. Revisa la conexión y vuelve a intentarlo.');
      setDetectedPlace(null);
      return null;
    }
  }

  function refreshDetectedPlace() {
    const coordinates = resolvePointCoordinates(pointDraft, currentGpsRef.current);
    if (!coordinates) {
      setAppError('Necesito coordenadas válidas para detectar el lugar.');
      return;
    }

    setAppError(null);
    void refreshDetectedPlaceForCoordinates(coordinates, { force: true });
  }

  function applyDetectedPlaceToDraft() {
    if (!detectedPlace?.placeName.trim()) {
      return;
    }

    const nextPlaceName = detectedPlace.placeName.trim();
    lastAutomaticPlaceValueRef.current = nextPlaceName;
    setPointDraft((previous) => ({
      ...previous,
      placeName: nextPlaceName,
    }));
  }

  async function refreshWeatherForCoordinates(
    coordinates: GpsCoordinates,
    options?: { force?: boolean },
  ): Promise<AutomaticWeatherSummary | null> {
    if (!isOnline) {
      setWeatherStatus('idle');
      setWeatherMessage('Sin conexión. El clima se consultará cuando vuelva la red.');
      return null;
    }

    const requestKey = `${coordinates.lat.toFixed(4)},${coordinates.lon.toFixed(4)}`;
    if (!options?.force && requestKey === lastWeatherKeyRef.current) {
      return weatherSnapshot;
    }

    weatherAbortRef.current?.abort();
    const controller = new AbortController();
    weatherAbortRef.current = controller;
    setWeatherStatus('loading');
    setWeatherMessage('Consultando clima automático...');

    try {
      const snapshot = await fetchAutomaticWeather(coordinates.lat, coordinates.lon, controller.signal);
      lastWeatherKeyRef.current = requestKey;
      setWeatherSnapshot(snapshot);
      setWeatherStatus('ready');
      setWeatherMessage(snapshot.details || 'Clima automático sincronizado.');

      setPointDraft((previous) => {
        const canOverwrite =
          !previous.observedWeather.trim() ||
          previous.observedWeather.trim() === lastAutomaticWeatherValueRef.current;

        if (!canOverwrite) {
          return previous;
        }

        return {
          ...previous,
          observedWeather: snapshot.summary,
        };
      });

      lastAutomaticWeatherValueRef.current = snapshot.summary;
      return snapshot;
    } catch (error) {
      if (controller.signal.aborted) {
        return null;
      }

      console.error('Automatic weather refresh failed:', error);
      setWeatherStatus('error');
      setWeatherMessage('No se pudo consultar el clima automático. Revisa la conexión y vuelve a intentarlo.');
      setWeatherSnapshot(null);
      return null;
    }
  }

  function refreshAutomaticWeather() {
    const coordinates = resolvePointCoordinates(pointDraft, currentGpsRef.current);
    if (!coordinates) {
      setAppError('Necesito coordenadas válidas para consultar el clima automático.');
      return;
    }

    setAppError(null);
    void refreshWeatherForCoordinates(coordinates, { force: true });
  }

  function applyAutomaticWeatherToDraft() {
    if (!weatherSnapshot) {
      return;
    }

    lastAutomaticWeatherValueRef.current = weatherSnapshot.summary;
    setPointDraft((previous) => ({
      ...previous,
      observedWeather: weatherSnapshot.summary,
    }));
  }

  async function listenAndClassifySoundscape() {
    setAppError(null);
    setSoundscapeStatus('listening');
    setSoundscapeMessage('Escuchando 15 segundos para detectar elementos del ambiente. No se guardará el audio.');

    try {
      const classification = await captureSoundscapeClassification({ durationMs: 15_000 });
      setDraftSoundscapeClassification(classification);
      setSoundscapeStatus('ready');
      setSoundscapeMessage(classification.details);
      setStatusNote(`Detección acústica lista: ${classification.summary}.`);
    } catch (error) {
      console.error('Soundscape classification failed:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'No se pudo escuchar el entorno para clasificar el paisaje sonoro.';
      setSoundscapeStatus('error');
      setSoundscapeMessage(errorMessage);
      setAppError(errorMessage);
    }
  }

  function buildPointFromDraft(
    createdAt: string,
    coordinates: GpsCoordinates,
    options?: {
      automaticWeather?: AutomaticWeatherSummary | null;
      detectedPlace?: DetectedPlaceSummary | null;
      photos?: UiSessionPhoto[];
      soundscapeClassification?: SoundscapeClassification | null;
    },
  ): UiSessionPoint {
    return {
      id: uuidv4(),
      createdAt,
      gps: coordinates,
      placeName:
        pointDraft.placeName.trim() ||
        options?.detectedPlace?.placeName.trim() ||
        `Punto ${formatDateTime(createdAt, 'HH:mm:ss')}`,
      habitat: pointDraft.habitat.trim(),
      characteristics: pointDraft.characteristics.trim(),
      observedWeather: pointDraft.observedWeather.trim() || options?.automaticWeather?.summary || '',
      automaticWeather: options?.automaticWeather ?? null,
      detectedPlace: options?.detectedPlace ?? null,
      soundscapeClassification: options?.soundscapeClassification ?? null,
      tags: mergeDraftTagsWithSoundscape(pointDraft.tagsText, options?.soundscapeClassification ?? null),
      notes: pointDraft.notes.trim(),
      zoomTakeReference: pointDraft.zoomTakeReference.trim(),
      microphoneSetup: pointDraft.microphoneSetup.trim() || activeSession?.equipmentPreset || 'Zoom H6 · XY',
      photos: options?.photos ?? [],
    };
  }

  function handleDraftPhotosInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []) as File[];
    if (files.length === 0) {
      return;
    }

    const nextPhotos = files.map((file) => ({
      id: uuidv4(),
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      blob: file,
      previewUrl: URL.createObjectURL(file),
    }));

    setDraftPhotos((current) => [...current, ...nextPhotos]);
    event.target.value = '';
  }

  function removeDraftPhoto(photoId: string) {
    setDraftPhotos((current) => {
      const photo = current.find((entry) => entry.id === photoId);
      if (photo) {
        URL.revokeObjectURL(photo.previewUrl);
      }
      return current.filter((entry) => entry.id !== photoId);
    });
  }

  function resetPointDraft(nextEquipmentPreset?: string) {
    setPointDraft(buildPointDraft(nextEquipmentPreset ?? activeSession?.equipmentPreset ?? 'Zoom H6 · XY', currentGpsRef.current));
    setDraftPhotos((current) => {
      current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      return [];
    });
    setDraftSoundscapeClassification(null);
    setSoundscapeStatus('idle');
    setSoundscapeMessage('Escucha local de 15 segundos para detectar aves, voces, música, pasos o agua. No se guarda el audio.');
    locationAbortRef.current?.abort();
    setDetectedPlace(null);
    setLocationStatus('idle');
    setLocationMessage('Esperando coordenadas para detectar el lugar.');
    lastLocationKeyRef.current = null;
    lastAutomaticPlaceValueRef.current = '';
    setWeatherSnapshot(null);
    setWeatherStatus('idle');
    setWeatherMessage('Esperando coordenadas para consultar el clima.');
    lastWeatherKeyRef.current = null;
    lastAutomaticWeatherValueRef.current = '';
  }

  function createSession() {
    const createdAt = new Date().toISOString();
    const nextSession: UiFieldSession = {
      id: uuidv4(),
      name: sessionDraft.name.trim() || `Salida ${formatDateTime(createdAt, 'yyyy-MM-dd')}`,
      projectName: sessionDraft.projectName.trim(),
      region: sessionDraft.region.trim(),
      notes: sessionDraft.notes.trim(),
      createdAt,
      startedAt: createdAt,
      status: 'active',
      equipmentPreset: sessionDraft.equipmentPreset.trim() || 'Zoom H6 · XY',
      points: [],
      audioTakes: [],
    };

    setActiveSessionId(nextSession.id);
    setSelectedPointId(null);
    void persistSession(nextSession);
    setPointDraft(buildPointDraft(nextSession.equipmentPreset, currentGpsRef.current));
    setSessionDraft(buildSessionDraft());
    setStatusNote('Salida iniciada. Empieza a registrar puntos de escucha.');
    setView('point');
  }

  function updateActiveSessionField<K extends keyof UiFieldSession>(field: K, value: UiFieldSession[K]) {
    if (!activeSession) {
      return;
    }

    const nextSession = {
      ...activeSession,
      [field]: value,
    };

    void persistSession(nextSession);
  }

  async function closeActiveSession() {
    if (!activeSession) {
      return;
    }

    const nextSession: UiFieldSession = {
      ...activeSession,
      status: 'closed',
      endedAt: new Date().toISOString(),
    };

    await persistSession(nextSession);
    setActiveSessionId(null);
    resetPointDraft(nextSession.equipmentPreset);
    setStatusNote(`Salida "${nextSession.name}" cerrada y lista para exportación.`);
    setView('export');
  }

  async function addPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una salida activa antes de registrar puntos.');
      return;
    }

    let coordinates = resolvePointCoordinates(pointDraft, currentGpsRef.current);
    if (!coordinates && pointDraft.coordinateSource === 'auto') {
      coordinates = await requestCurrentLocation();
    }

    if (!coordinates) {
      setAppError('Necesito coordenadas válidas para guardar el punto.');
      return;
    }

    const createdAt = new Date().toISOString();
    const sessionPhotos: UiSessionPhoto[] = draftPhotos.map((photo) => ({
      id: photo.id,
      fileName: photo.fileName,
      mimeType: photo.mimeType,
      blob: photo.blob,
      previewUrl: URL.createObjectURL(photo.blob),
    }));

    const point = buildPointFromDraft(createdAt, coordinates, {
      automaticWeather: weatherSnapshot,
      detectedPlace,
      photos: sessionPhotos,
      soundscapeClassification: draftSoundscapeClassification,
    });
    const nextPoints = [point, ...activeSession.points];

    const nextSession: UiFieldSession = {
      ...activeSession,
      points: nextPoints,
      audioTakes: reconcileSessionAudioTakes(nextPoints, activeSession.audioTakes),
    };

    await persistSession(nextSession);
    setSelectedPointId(point.id);
    setRecordSessionId(activeSession.id);
    setRecordPointId(point.id);
    setAppError(null);
    setStatusNote(`Punto "${point.placeName}" guardado dentro de la salida.`);
    resetPointDraft(activeSession.equipmentPreset);
  }

  async function addQuickPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una salida activa antes de registrar un punto rápido.');
      return;
    }

    let coordinates = currentGpsRef.current ?? resolvePointCoordinates(pointDraft, currentGpsRef.current);
    if (!coordinates) {
      coordinates = await requestCurrentLocation();
    }

    if (!coordinates) {
      setAppError('Necesito GPS activo o coordenadas válidas para crear el punto automático.');
      return;
    }

    setIsQuickCapturing(true);
    setAppError(null);

    try {
      const [nextDetectedPlace, nextWeatherSnapshot] = await Promise.all([
        refreshDetectedPlaceForCoordinates(coordinates, { force: true }),
        refreshWeatherForCoordinates(coordinates, { force: true }),
      ]);

      const createdAt = new Date().toISOString();
      const sessionPhotos: UiSessionPhoto[] = draftPhotos.map((photo) => ({
        id: photo.id,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        blob: photo.blob,
        previewUrl: URL.createObjectURL(photo.blob),
      }));

      const point = buildPointFromDraft(createdAt, coordinates, {
        automaticWeather: nextWeatherSnapshot ?? weatherSnapshot,
        detectedPlace: nextDetectedPlace ?? detectedPlace,
        photos: sessionPhotos,
        soundscapeClassification: draftSoundscapeClassification,
      });
      const nextPoints = [point, ...activeSession.points];

      const nextSession: UiFieldSession = {
        ...activeSession,
        points: nextPoints,
        audioTakes: reconcileSessionAudioTakes(nextPoints, activeSession.audioTakes),
      };

      await persistSession(nextSession);
      setSelectedPointId(point.id);
      setRecordSessionId(activeSession.id);
      setRecordPointId(point.id);
      setStatusNote(`Punto rápido "${point.placeName}" creado con GPS, fecha, hora y clima.`);
      resetPointDraft(activeSession.equipmentPreset);
    } finally {
      setIsQuickCapturing(false);
    }
  }

  async function removePointFromActiveSession(pointId: string) {
    if (!activeSession) {
      return;
    }

    const pointToDelete = activeSession.points.find((point) => point.id === pointId);
    if (!pointToDelete) {
      return;
    }

    pointToDelete.photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));

    const nextSession: UiFieldSession = {
      ...activeSession,
      points: activeSession.points.filter((point) => point.id !== pointId),
      audioTakes: reconcileSessionAudioTakes(
        activeSession.points.filter((point) => point.id !== pointId),
        activeSession.audioTakes,
      ),
    };

    await persistSession(nextSession);
    setSelectedPointId(nextSession.points[0]?.id ?? null);
    if (recordPointId === pointId && recordSessionId === activeSession.id) {
      setRecordPointId(nextSession.points[0]?.id ?? null);
      if (nextSession.points.length === 0) {
        setRecordSessionId(null);
      }
    }
    setStatusNote('Punto eliminado de la salida activa.');
  }

  async function removeSession(sessionId: string) {
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    revokeSessionUrls(session);
    setSessions((current) => current.filter((entry) => entry.id !== sessionId));

    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setSelectedPointId(null);
    }

    if (recordSessionId === sessionId) {
      setRecordSessionId(null);
      setRecordPointId(null);
    }

    if (storageMode === 'ready') {
      try {
        await deleteFieldSession(sessionId);
      } catch (error) {
        console.error('Deleting session failed:', error);
      setAppError('La salida desapareció de la vista, pero no se pudo borrar del archivo.');
      }
    }
  }

  async function applyProjectNameToSessions(projectKey: string, nextProjectName: string, statusMessage: string) {
    const projectSessions = sessionsRef.current.filter((session) => buildProjectKey(session.projectName) === projectKey);
    if (projectSessions.length === 0) {
      return;
    }

    setIsUpdatingProjectKey(projectKey);
    setAppError(null);

    try {
      for (const session of projectSessions) {
        await persistSession({
          ...session,
          projectName: nextProjectName,
        });
      }

      setSelectedArchiveProjectKey(nextProjectName.trim() ? buildProjectKey(nextProjectName) : 'all');
      setStatusNote(statusMessage);
    } catch (error) {
      console.error('Updating project failed:', error);
      setAppError('No se pudo actualizar el trabajo en todas sus salidas.');
    } finally {
      setIsUpdatingProjectKey(null);
    }
  }

  async function renameProject(projectKey: string) {
    const nextProjectName = projectDraftName.trim();
    if (!nextProjectName) {
      setAppError('El trabajo necesita un nombre. Si quieres quitarlo, usa "Quitar trabajo".');
      return;
    }

    if (buildProjectKey(nextProjectName) === projectKey) {
      setStatusNote('El trabajo ya tiene ese nombre.');
      return;
    }

    await applyProjectNameToSessions(projectKey, nextProjectName, `Trabajo renombrado a "${nextProjectName}".`);
  }

  async function clearProject(projectKey: string) {
    await applyProjectNameToSessions(
      projectKey,
      '',
      'Trabajo eliminado como agrupación. Las salidas siguen existiendo en "Sin trabajo".',
    );
  }

  async function exportSession(session: UiFieldSession) {
    setIsExportingSessionId(session.id);
    setAppError(null);

    try {
      await exportFieldSessionPackage(dehydrateSession(session));
      setStatusNote(`Salida "${session.name}" exportada.`);
    } catch (error) {
      console.error('Export session failed:', error);
      setAppError('No se pudo exportar la salida.');
    } finally {
      setIsExportingSessionId(null);
    }
  }

  async function syncSessionToCloudBackup(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    if (!isOnline) {
      setAppError('Necesitas conexión para respaldar la salida en Vercel Blob.');
      return;
    }

    if (isSyncingCloudSessionIdRef.current) {
      return;
    }

    isSyncingCloudSessionIdRef.current = sessionId;
    setIsSyncingCloudSessionId(sessionId);
    setAppError(null);

    const syncingSession: UiFieldSession = {
      ...session,
      cloudSyncStatus: 'syncing',
      cloudError: null,
    };

    replaceSessionInState(syncingSession);

    try {
      const cloudSession = await syncSessionToCloud(dehydrateSession(syncingSession));
      const nextUiSession = mergeCloudSyncedSessionIntoUi(cloudSession, syncingSession);
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      setStatusNote(`Salida "${nextUiSession.name}" respaldada en la nube.`);
    } catch (error) {
      console.error('Cloud backup failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo respaldar en la nube.';
      const nextUiSession: UiFieldSession = {
        ...session,
        cloudSyncStatus: 'error',
        cloudError: errorMessage,
      };
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      setAppError(errorMessage);
    } finally {
      isSyncingCloudSessionIdRef.current = null;
      setIsSyncingCloudSessionId(null);
    }
  }

  async function syncSessionToCatalogStore(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    if (isCatalogApiUnavailable) {
      setAppError(CATALOG_API_UNAVAILABLE_MESSAGE);
      return;
    }

    if (!isOnline) {
      setAppError('Necesitas conexión para sincronizar la salida con el catálogo remoto.');
      return;
    }

    if (isSyncingCatalogSessionIdRef.current || isSyncingCloudSessionIdRef.current) {
      return;
    }

    isSyncingCatalogSessionIdRef.current = sessionId;
    setIsSyncingCatalogSessionId(sessionId);
    setAppError(null);

    const syncingSession: UiFieldSession = {
      ...session,
      catalogSyncStatus: 'syncing',
      catalogError: null,
    };

    replaceSessionInState(syncingSession);

    try {
      const catalogResult = await syncSessionToCatalog(dehydrateSession(syncingSession));
      setCatalogApiStatus('available');
      const nextUiSession: UiFieldSession = {
        ...syncingSession,
        catalogSyncStatus: 'synced',
        catalogSyncedAt: catalogResult.syncedAt,
        catalogError: null,
      };
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      setStatusNote(`Salida "${nextUiSession.name}" sincronizada con el catálogo remoto.`);
    } catch (error) {
      console.error('Catalog sync failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo sincronizar el catálogo remoto.';
      if (isCatalogApiUnavailableError(error)) {
        setCatalogApiStatus('unavailable');
        setStatusNote('Catálogo remoto desactivado en este entorno. La salida sigue disponible en local y en exportación.');
      }
      const nextUiSession: UiFieldSession = {
        ...session,
        catalogSyncStatus: 'error',
        catalogError: errorMessage,
      };
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      setAppError(errorMessage);
    } finally {
      isSyncingCatalogSessionIdRef.current = null;
      setIsSyncingCatalogSessionId(null);
    }
  }

  async function syncPendingCloudSessions() {
    if (!isOnline || isSyncingCloudSessionIdRef.current) {
      return;
    }

    const pendingSessions = sessionsRef.current.filter((session) =>
      session.cloudSyncStatus === 'pending' ||
      session.cloudSyncStatus === 'local-only' ||
      session.cloudSyncStatus === 'error',
    );

    if (pendingSessions.length === 0) {
      setStatusNote('No hay salidas pendientes de respaldo.');
      return;
    }

    for (const session of pendingSessions) {
      await syncSessionToCloudBackup(session.id);
    }
  }

  async function syncPendingCatalogSessions() {
    if (!isOnline || isSyncingCatalogSessionIdRef.current || isSyncingCloudSessionIdRef.current) {
      return;
    }

    const pendingSessions = sessionsRef.current.filter((session) =>
      session.catalogSyncStatus === 'pending' ||
      session.catalogSyncStatus === 'local-only' ||
      session.catalogSyncStatus === 'error',
    );

    if (pendingSessions.length === 0) {
      setStatusNote('No hay salidas pendientes de catálogo remoto.');
      return;
    }

    for (const session of pendingSessions) {
      await syncSessionToCatalogStore(session.id);
    }
  }

  async function refreshSessionsFromRemoteCatalog(options?: { force?: boolean }) {
    if (!isOnline || storageMode !== 'ready' || catalogApiStatus === 'unavailable') {
      return;
    }

    const nowMs = Date.now();
    if (!options?.force && nowMs - lastRemoteCatalogRefreshAtRef.current < REMOTE_CATALOG_REFRESH_MIN_GAP_MS) {
      return;
    }

    if (isRefreshingRemoteCatalogRef.current) {
      return;
    }

    isRefreshingRemoteCatalogRef.current = true;
    lastRemoteCatalogRefreshAtRef.current = nowMs;

    try {
      const summaries = await listCatalogSessionsRemote();
      setCatalogApiStatus('available');

      const summariesToImport = summaries.filter((summary) => {
        const localSession = sessionsRef.current.find((entry) => entry.id === summary.id);
        if (!localSession) {
          return true;
        }

        if (!canReplaceSessionFromRemoteCatalog(localSession)) {
          return false;
        }

        const localCatalogUpdatedAt = localSession.catalogSyncedAt
          ? new Date(localSession.catalogSyncedAt).getTime()
          : 0;
        const remoteCatalogUpdatedAt = new Date(summary.updatedAt).getTime();

        return remoteCatalogUpdatedAt > localCatalogUpdatedAt;
      });

      if (summariesToImport.length === 0) {
        return;
      }

      const importedNames: string[] = [];

      for (const summary of summariesToImport) {
        const currentSession = sessionsRef.current.find((entry) => entry.id === summary.id) ?? null;
        if (currentSession && !canReplaceSessionFromRemoteCatalog(currentSession)) {
          continue;
        }

        const remoteSession = await fetchCatalogSessionRemote(summary.id);
        const nextSession = buildCatalogSessionForUi(remoteSession, summary, currentSession);
        await persistSession(nextSession, { markCloudPending: false, markCatalogPending: false });
        importedNames.push(nextSession.name);

        if (!sessionsRef.current.some((entry) => entry.status === 'active') && nextSession.status === 'active') {
          setActiveSessionId(nextSession.id);
        }
      }

      if (importedNames.length === 1) {
        setStatusNote(`Salida "${importedNames[0]}" actualizada desde el catálogo remoto.`);
      } else if (importedNames.length > 1) {
        setStatusNote(`${importedNames.length} salidas actualizadas desde el catálogo remoto.`);
      }
    } catch (error) {
      console.error('Remote catalog refresh failed:', error);

      if (isCatalogApiUnavailableError(error)) {
        setCatalogApiStatus('unavailable');
        return;
      }
    } finally {
      isRefreshingRemoteCatalogRef.current = false;
    }
  }

  async function enrichPointForArchive(point: UiSessionPoint): Promise<{ point: UiSessionPoint; changed: boolean }> {
    let changed = false;
    let nextPoint = point;

    if (pointNeedsLocationEnrichment(nextPoint)) {
      try {
        const detectedPlaceSummary = await reverseGeocodePlace(nextPoint.gps.lat, nextPoint.gps.lon);
        nextPoint = {
          ...nextPoint,
          detectedPlace: detectedPlaceSummary,
          placeName: shouldOverwritePointPlaceName(nextPoint.placeName)
            ? detectedPlaceSummary.placeName || nextPoint.placeName
            : nextPoint.placeName,
        };
        changed = true;
      } catch (error) {
        console.error('Pending location enrichment failed:', error);
      }
    }

    if (pointNeedsWeatherEnrichment(nextPoint)) {
      try {
        const automaticWeatherSummary = await fetchAutomaticWeather(nextPoint.gps.lat, nextPoint.gps.lon);
        nextPoint = {
          ...nextPoint,
          automaticWeather: automaticWeatherSummary,
          observedWeather: nextPoint.observedWeather.trim() || automaticWeatherSummary.summary,
        };
        changed = true;
      } catch (error) {
        console.error('Pending weather enrichment failed:', error);
      }
    }

    return { point: nextPoint, changed };
  }

  async function syncPendingMetadataQueue(options?: { force?: boolean }) {
    if (!isOnline || isSyncingPendingMetadataRef.current) {
      return;
    }

    const sessionsWithPending = sessionsRef.current.filter((session) =>
      session.points.some((point) => pointNeedsAutomaticEnrichment(point)),
    );

    if (sessionsWithPending.length === 0) {
      if (options?.force) {
        setStatusNote('No hay metadatos pendientes por sincronizar.');
      }
      return;
    }

    isSyncingPendingMetadataRef.current = true;
    setIsSyncingPendingMetadata(true);

    let updatedSessions = 0;
    let updatedPoints = 0;

    try {
      for (const sessionSnapshot of sessionsWithPending) {
        const liveSession = sessionsRef.current.find((entry) => entry.id === sessionSnapshot.id);
        if (!liveSession) {
          continue;
        }

        let sessionChanged = false;
        const nextPoints: UiSessionPoint[] = [];

        for (const point of liveSession.points) {
          if (!pointNeedsAutomaticEnrichment(point)) {
            nextPoints.push(point);
            continue;
          }

          const enrichedPoint = await enrichPointForArchive(point);
          nextPoints.push(enrichedPoint.point);

          if (enrichedPoint.changed) {
            sessionChanged = true;
            updatedPoints += 1;
          }
        }

        if (!sessionChanged) {
          continue;
        }

        updatedSessions += 1;
        await persistSession({
          ...liveSession,
          points: nextPoints,
        });
      }

      if (updatedPoints > 0) {
        setStatusNote(
          `Sincronizados ${updatedPoints} puntos pendientes en ${updatedSessions} salida${updatedSessions === 1 ? '' : 's'}.`,
        );
      } else if (options?.force) {
        setStatusNote('No pude enriquecer los puntos pendientes en este momento.');
      }
    } finally {
      isSyncingPendingMetadataRef.current = false;
      setIsSyncingPendingMetadata(false);
    }
  }

  async function updateSessionAudioTake(
    sessionId: string,
    takeId: string,
    updater: (take: SessionAudioTake, session: UiFieldSession) => SessionAudioTake,
  ) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    const nextSession: UiFieldSession = {
      ...session,
      audioTakes: session.audioTakes.map((take) => (take.id === takeId ? updater(take, session) : take)),
    };

    await persistSession(nextSession);
  }

  async function assignAudioTakeToPoint(
    sessionId: string,
    takeId: string,
    nextPointId: string | null,
  ) {
    await updateSessionAudioTake(sessionId, takeId, (take, session) => {
      if (!nextPointId) {
        return {
          ...take,
          associatedPointId: null,
          matchedBy: 'unmatched',
          confidence: 'low',
          matchedPointDeltaMinutes: null,
        };
      }

      const linkedPoint = session.points.find((point) => point.id === nextPointId) ?? null;
      const deltaMinutes = linkedPoint
        ? Math.round(
            Math.abs(new Date(take.inferredRecordedAt).getTime() - new Date(linkedPoint.createdAt).getTime()) /
              60_000,
          )
        : null;

      return {
        ...take,
        associatedPointId: nextPointId,
        matchedBy: 'manual',
        confidence: 'high',
        matchedPointDeltaMinutes: deltaMinutes,
      };
    });
  }

  async function autoAssignAudioTake(sessionId: string, takeId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    const nextAudioTakes = reconcileSessionAudioTakes(
      session.points,
      session.audioTakes.map((take) =>
        take.id === takeId
          ? {
              ...take,
              matchedBy: 'unmatched',
              associatedPointId: null,
              confidence: 'low',
              matchedPointDeltaMinutes: null,
            }
          : take,
      ),
    );

    await persistSession({
      ...session,
      audioTakes: nextAudioTakes,
    });
  }

  function openZoomImportPicker(sessionId: string) {
    setZoomImportTargetSessionId(sessionId);
    zoomImportInputRef.current?.click();
  }

  async function handleZoomImportInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []) as File[];
    const audioCandidateCount = files.filter((file) => isSupportedImportedAudioFileName(file.name)).length;
    const sessionId = zoomImportTargetSessionId;
    event.target.value = '';

    if (!sessionId || files.length === 0) {
      setZoomImportTargetSessionId(null);
      return;
    }

    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      setZoomImportTargetSessionId(null);
      setAppError('No encontré la salida destino para importar las tomas.');
      return;
    }

    setIsImportingSessionId(sessionId);
    setAppError(null);

    try {
      if (audioCandidateCount === 0) {
        setAppError('No encontré archivos de audio compatibles en esa carpeta de Zoom H6.');
        return;
      }

      const importedTakes = await buildImportedAudioTakes(files, session.points);
      const nextAudioTakes = reconcileSessionAudioTakes(
        session.points,
        mergeSessionAudioTakes(session.audioTakes, importedTakes),
      );
      const nextSession: UiFieldSession = {
        ...session,
        audioTakes: nextAudioTakes,
      };

      await persistSession(nextSession);

      const linkedCount = importedTakes.filter((take) => take.associatedPointId).length;
      const unmatchedCount = importedTakes.length - linkedCount;
      const ignoredCount = files.length - audioCandidateCount;
      setStatusNote(
        `Importadas ${importedTakes.length} tomas de Zoom H6. ${linkedCount} asociadas, ${unmatchedCount} pendientes.${ignoredCount > 0 ? ` ${ignoredCount} archivos auxiliares ignorados.` : ''}`,
      );
      setView('export');
    } catch (error) {
      console.error('Zoom H6 import failed:', error);
      setAppError('No se pudieron importar las tomas de la Zoom H6.');
    } finally {
      setIsImportingSessionId(null);
      setZoomImportTargetSessionId(null);
    }
  }

  function openRecordView(sessionId: string, pointId: string) {
    setRecordSessionId(sessionId);
    setRecordPointId(pointId);

    if (activeSessionId === sessionId) {
      setSelectedPointId(pointId);
    }

    setView('export');
  }

  function focusArchiveSession(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    const latestPoint = [...session.points].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    )[0];

    setSelectedArchiveProjectKey(buildProjectKey(session.projectName));
    setRecordSessionId(session.id);
    setRecordPointId(latestPoint?.id ?? null);

    if (session.status === 'active') {
      setActiveSessionId(session.id);
      setSelectedPointId(latestPoint?.id ?? null);
    }

    setView('export');
  }

  function focusArchiveProject(projectKey: string) {
    if (projectKey === 'all') {
      setSelectedArchiveProjectKey('all');
      setView('export');
      return;
    }

    const group = archiveProjectGroups.find((entry) => entry.key === projectKey);
    const latestSession = group?.sessions[0];
    if (!latestSession) {
      return;
    }

    setSelectedArchiveProjectKey(projectKey);
    focusArchiveSession(latestSession.id);
  }

  function openSessionWorkspace(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    if (session.status === 'active') {
      setActiveSessionId(session.id);
      setSelectedPointId(session.points[0]?.id ?? null);
      setView('session');
      return;
    }

    focusArchiveSession(session.id);
  }

  function openSessionArchiveFromHome(sessionId: string) {
    focusArchiveSession(sessionId);
  }

  function openProjectArchiveFromHome(projectKey: string) {
    focusArchiveProject(projectKey);
  }

  const captureDateLabel = formatDateTime(new Date(now), "d 'de' MMMM, yyyy");
  const captureTimeLabel = formatDateTime(new Date(now), 'HH:mm:ss');
  const gpsLabel = currentGps
    ? `${currentGps.lat.toFixed(5)}, ${currentGps.lon.toFixed(5)}`
    : 'Sin señal activa';
  const gpsAccuracyLabel = currentGps?.accuracy ? `${Math.round(currentGps.accuracy)} m` : 'Sin precisión';
  const gpsStatusLabel =
    gpsStatus === 'ready' ? 'GPS listo' : gpsStatus === 'pending' ? 'Buscando señal' : 'GPS no disponible';
  const locationStatusLabel =
    locationStatus === 'ready'
      ? 'Lugar detectado'
      : locationStatus === 'loading'
        ? 'Detectando lugar'
        : locationStatus === 'error'
          ? 'Sin lugar detectado'
          : 'Lugar pendiente';
  const weatherStatusLabel =
    weatherStatus === 'ready'
      ? 'Clima sincronizado'
      : weatherStatus === 'loading'
        ? 'Consultando clima'
        : weatherStatus === 'error'
          ? 'Sin datos de clima'
          : 'Clima pendiente';
  const fileStatusLabel =
    storageMode === 'ready' ? 'WRITE_READY' : storageMode === 'loading' ? 'LOADING...' : 'MEMORY_ONLY';
  const gpsTelemetryValue = currentGps ? gpsLabel : 'SEARCHING...';
  const pointBufferLabel = String(activeSession?.points.length ?? 0).padStart(3, '0');
  const pendingEnrichmentCount = sessions.reduce(
    (count, session) => count + session.points.filter((point) => pointNeedsAutomaticEnrichment(point)).length,
    0,
  );
  const pendingCloudSessionCount = sessions.filter(
    (session) =>
      session.cloudSyncStatus === 'pending' ||
      session.cloudSyncStatus === 'local-only' ||
      session.cloudSyncStatus === 'error',
  ).length;
  const autoSyncCloudSessionCount = sessions.filter(
    (session) => session.cloudSyncStatus === 'pending' || session.cloudSyncStatus === 'local-only',
  ).length;
  const syncedCloudSessionCount = sessions.filter((session) => session.cloudSyncStatus === 'synced').length;
  const projectCount = archiveProjectGroups.length;
  const pendingCatalogSessionCount = sessions.filter(
    (session) =>
      session.catalogSyncStatus === 'pending' ||
      session.catalogSyncStatus === 'local-only' ||
      session.catalogSyncStatus === 'error',
  ).length;
  const autoSyncCatalogSessionCount = sessions.filter(
    (session) => session.catalogSyncStatus === 'pending' || session.catalogSyncStatus === 'local-only',
  ).length;
  const syncedCatalogSessionCount = sessions.filter((session) => session.catalogSyncStatus === 'synced').length;
  const totalOperationalPendingCount =
    pendingEnrichmentCount + pendingCloudSessionCount + pendingCatalogSessionCount;
  const activeSessionMeta = activeSession
    ? `${activeSession.projectName || 'sin trabajo'} · ${activeSession.region || 'sin zona'}`
    : 'Crea una salida para empezar a registrar puntos.';
  const syncPendingCount = pendingCloudSessionCount + pendingCatalogSessionCount;
  const syncPendingParts = [
    pendingCloudSessionCount > 0 ? `${pendingCloudSessionCount} sin subir` : null,
    pendingCatalogSessionCount > 0 ? `${pendingCatalogSessionCount} sin catálogo` : null,
  ].filter((part): part is string => Boolean(part));
  const syncPendingSummary =
    syncPendingParts.length > 0 ? syncPendingParts.join(' · ') : 'Todas las salidas están respaldadas y visibles.';
  const metadataReviewSummary =
    pendingEnrichmentCount > 0
      ? pendingEnrichmentCount === 1
        ? '1 registro todavía sin clima o lugar.'
        : `${pendingEnrichmentCount} registros todavía sin clima o lugar.`
      : 'Lugar y clima al día en todos los registros.';
  const operationalPendingParts = [
    pendingEnrichmentCount > 0 ? `${pendingEnrichmentCount} registros por completar` : null,
    pendingCloudSessionCount > 0 ? `${pendingCloudSessionCount} salidas sin subir` : null,
    pendingCatalogSessionCount > 0 ? `${pendingCatalogSessionCount} sin catálogo` : null,
  ].filter((part): part is string => Boolean(part));
  const operationalPendingSummary =
    operationalPendingParts.length > 0
      ? operationalPendingParts.join(' · ')
      : 'Sin tareas pendientes en metadatos, nube o catálogo.';
  const activeSessionProjectName = activeSession ? resolveProjectName(activeSession.projectName) : 'Sin trabajo';
  const totalPhotoCount = sessions.reduce(
    (count, session) => count + session.points.reduce((sessionCount, point) => sessionCount + point.photos.length, 0),
    0,
  );
  const totalAudioTakeCount = sessions.reduce((count, session) => count + session.audioTakes.length, 0);
  const unassignedAudioTakeCount = sessions.reduce(
    (count, session) => count + session.audioTakes.filter((take) => !take.associatedPointId).length,
    0,
  );
  const activeSessionPhotoCount = activeSession
    ? activeSession.points.reduce((count, point) => count + point.photos.length, 0)
    : 0;
  const recentProjectGroups = archiveProjectGroups.slice(0, 4);
  const recentSessions = sessions.slice(0, 5);
  const recentPhotoLibrary = allRecords
    .flatMap((record) =>
      record.point.photos
        .filter((photo) => photo.previewUrl)
        .map((photo) => ({
          id: photo.id,
          previewUrl: photo.previewUrl as string,
          sessionId: record.sessionId,
          pointId: record.point.id,
          pointName: record.point.placeName,
          sessionName: record.sessionName,
          createdAt: record.point.createdAt,
        })),
    )
    .slice(0, 6);
  const recentAudioLibrary = sessions
    .flatMap((session) =>
      session.audioTakes.map((take) => ({
        id: take.id,
        sessionId: session.id,
        associatedPointId: take.associatedPointId,
        fileName: take.fileName,
        inferredRecordedAt: take.inferredRecordedAt,
        pointName: session.points.find((point) => point.id === take.associatedPointId)?.placeName ?? null,
        projectName: resolveProjectName(session.projectName),
      })),
    )
    .sort((left, right) => new Date(right.inferredRecordedAt).getTime() - new Date(left.inferredRecordedAt).getTime())
    .slice(0, 5);
  const visibleArchiveSessions = visibleArchiveProjectGroups
    .flatMap((group) => group.sessions)
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
  const currentArchiveProject =
    selectedArchiveProjectKey === 'all'
      ? null
      : archiveProjectGroups.find((group) => group.key === selectedArchiveProjectKey) ?? null;
  const canManageSelectedProject = Boolean(currentArchiveProject) && currentArchiveProject.key !== 'sin-trabajo';

  useEffect(() => {
    setProjectDraftName(currentArchiveProject?.name ?? '');
  }, [currentArchiveProject?.key, currentArchiveProject?.name]);

  const recordSessionPoints = recordSession
    ? [...recordSession.points].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    : [];
  const recordSessionPhotoLibrary = recordSessionPoints.flatMap((point) =>
    point.photos
      .filter((photo) => photo.previewUrl)
      .map((photo) => ({
        id: photo.id,
        previewUrl: photo.previewUrl as string,
        pointId: point.id,
        pointName: point.placeName,
        fileName: photo.fileName,
        createdAt: point.createdAt,
      })),
  );
  const recordSessionAudioLibrary = recordSession
    ? [...recordSession.audioTakes].sort(
        (left, right) => new Date(right.inferredRecordedAt).getTime() - new Date(left.inferredRecordedAt).getTime(),
      )
    : [];
  const latestActivePoints = sortedActiveSessionPoints.slice(0, 4);
  const livePlaceLabel = detectedPlace?.placeName || 'Lugar pendiente';
  const liveClimateLabel = weatherSnapshot?.summary || 'Clima pendiente';
  const greetingLabel = getGreetingLabel(now);
  const homeLauncherTitle = activeSession ? 'Seguir salida' : 'Preparar salida';
  const homeLauncherCopy = activeSession
    ? `${activeSession.name} sigue abierta. Usa estas acciones como punto de entrada y consulta el estado real en la tarjeta “Salida actual”.`
    : 'Empieza creando o abriendo una salida. Captura y archivo se activan desde este mismo punto de entrada.';
  const homeGpsValue = currentGps ? gpsAccuracyLabel : 'Sin señal';
  const homeGpsCopy = currentGps ? `${gpsLabel} · ${gpsStatusLabel}` : 'Activa el GPS para situar la salida.';
  const homePlaceValue = detectedPlace ? 'Listo' : currentGps ? 'Buscando' : 'Pendiente';
  const homePlaceCopy = detectedPlace?.placeName || 'El lugar aparecerá cuando haya fijación GPS y red.';
  const homeSyncValue = syncPendingCount === 0 ? 'Al día' : String(syncPendingCount);
  const homeReviewValue = pendingEnrichmentCount === 0 ? 'Listo' : String(pendingEnrichmentCount);
  const storageSummary =
    storageMode === 'ready'
      ? 'Archivo local disponible'
      : storageMode === 'loading'
        ? 'Preparando almacenamiento'
        : 'Sólo memoria';
  const isSunMode = displayMode === 'sun';
  const currentViewLabel =
    view === 'home' ? 'Resumen' : view === 'session' ? 'Salidas' : view === 'point' ? 'Captura' : 'Archivo';
  const currentViewTitle =
    view === 'home'
      ? 'Resumen operativo del trabajo de campo'
      : view === 'session'
        ? 'Trabajos, salidas y actividad de campo'
        : view === 'point'
          ? activeSession
            ? 'Nuevo registro con GPS, fotos, clima e IA'
            : 'Prepara una salida antes de registrar'
          : 'Archivo visible de fotos, audio y exportación';
  const currentViewDescription =
    view === 'home'
      ? 'Desde aquí ves el estado de la salida, los trabajos existentes y la biblioteca reciente sin navegar a ciegas.'
      : view === 'session'
        ? 'La preparación y la búsqueda viven juntas: crear una salida, abrir trabajos existentes, localizar salidas y revisar el mapa.'
        : view === 'point'
          ? 'La captura queda aislada para trabajar rápido en el terreno: ubicación, escucha, fotos y notas en una sola pantalla.'
          : 'El archivo deja visibles salidas, registros, fotos y tomas H6 para revisar y exportar sin esconder acciones.';
  const captureEntryLabel = activeSession ? 'Ir a captura' : 'Preparar salida';
  const latestRecordLabel = recordPoint ? recordPoint.placeName : 'Sin ficha final todavía';
  const latestRecordSummary = recordPoint
    ? `${formatDateTime(recordPoint.createdAt, "d MMM yyyy · HH:mm")} · ${resolveProjectName(recordSession?.projectName ?? '')}`
    : 'El archivo final aparecerá en cuanto guardes el primer punto.';
  const navigationItems: Array<{
    view: View;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
  }> = [
    {
      view: 'home',
      label: 'Resumen',
      description: 'Estado, trabajos y media',
      icon: House,
      onClick: () => setView('home'),
    },
    {
      view: 'session',
      label: 'Salidas',
      description: 'Crear, abrir y localizar',
      icon: MapPinned,
      onClick: () => setView('session'),
    },
    {
      view: 'point',
      label: 'Captura',
      description: activeSession ? 'Nuevo registro en la salida activa' : 'Necesita una salida activa',
      icon: Mic,
      onClick: () => setView(activeSession ? 'point' : 'session'),
    },
    {
      view: 'export',
      label: 'Archivo',
      description: 'Fotos, tomas y exportación',
      icon: History,
      onClick: () => setView('export'),
    },
  ];
  const homeWorkflowCards = [
    {
      eyebrow: 'Panel',
      title: 'Trabajos y salidas',
      description: 'Abre lo que ya existe o prepara una salida nueva sin perder la jerarquía.',
      status: activeSession ? `${activeSession.points.length} registros en ${activeSession.name}` : `${projectCount} trabajos visibles`,
      cta: activeSession ? 'Abrir salidas' : 'Crear salida',
      icon: MapPinned,
      featured: !activeSession,
      onClick: () => setView('session'),
    },
    {
      eyebrow: 'Captura',
      title: 'Nuevo registro',
      description: 'GPS, clima, fotos, notas e IA en el flujo de captura.',
      status: activeSession ? `${gpsStatusLabel} · ${activeSession.name}` : 'Necesita una salida activa',
      cta: captureEntryLabel,
      icon: Mic,
      featured: Boolean(activeSession),
      onClick: () => setView(activeSession ? 'point' : 'session'),
    },
    {
      eyebrow: 'Registro',
      title: 'Archivo visible',
      description: 'Registros, galería, tomas H6 y exportación en la misma vista.',
      status: recordSession ? `${recordSession.name} · ${recordSession.audioTakes.length} tomas H6` : `${totalPhotoCount} fotos · ${totalAudioTakeCount} tomas`,
      cta: recordPoint ? 'Abrir archivo' : 'Ver archivo',
      icon: History,
      featured: view === 'export',
      onClick: () => setView('export'),
    },
  ];
  const isCatalogApiUnavailable = catalogApiStatus === 'unavailable';
  const showSidebar = true;
  const showMobileDock = true;
  const shouldShowOperationalBanner = view !== 'home';
  const shouldShowStatusStack =
    shouldShowOperationalBanner ||
    !isOnline ||
    isCatalogApiUnavailable ||
    storageMode === 'memory-only' ||
    Boolean(appError);
  const currentLocationLabel = currentGps ? 'Ubicación actual' : 'Sin ubicación activa';
  const captureReadinessItems = [
    {
      label: 'Lugar',
      value: pointDraft.placeName.trim() || detectedPlace?.placeName || 'Pendiente',
      ready: Boolean(pointDraft.placeName.trim() || detectedPlace?.placeName),
    },
    {
      label: 'Notas',
      value: pointDraft.notes.trim() ? 'Anotadas' : 'Vacías',
      ready: Boolean(pointDraft.notes.trim()),
    },
    {
      label: 'Fotos',
      value: draftPhotos.length > 0 ? `${draftPhotos.length} adjuntas` : 'Sin fotos',
      ready: draftPhotos.length > 0,
    },
    {
      label: 'IA',
      value: draftSoundscapeClassification?.summary || 'Sin escucha',
      ready: Boolean(draftSoundscapeClassification),
    },
  ];
  const captureReadinessLabel = `${captureReadinessItems.filter((item) => item.ready).length}/${captureReadinessItems.length} capas listas`;
  const canRefreshDetectedPlace = isOnline && Boolean(draftPointCoordinates);
  const canRefreshWeather = isOnline && Boolean(draftPointCoordinates);
  const recordBadge = recordPoint ? resolveSoundscapeBadge(recordPoint) : null;

  useEffect(() => {
    if (!isOnline || storageMode !== 'ready') {
      return;
    }

    if (pendingEnrichmentCount === 0) {
      return;
    }

    void syncPendingMetadataQueue();
  }, [isOnline, pendingEnrichmentCount, storageMode]);

  useEffect(() => {
    if (!isOnline || storageMode !== 'ready' || autoSyncCloudSessionCount === 0) {
      return;
    }

    if (isSyncingCloudSessionIdRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void syncPendingCloudSessions();
    }, 1800);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [autoSyncCloudSessionCount, isOnline, storageMode]);

  useEffect(() => {
    if (!isOnline || storageMode !== 'ready' || autoSyncCatalogSessionCount === 0 || isCatalogApiUnavailable) {
      return;
    }

    if (isSyncingCatalogSessionIdRef.current || isSyncingCloudSessionIdRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void syncPendingCatalogSessions();
    }, 3200);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [autoSyncCatalogSessionCount, isCatalogApiUnavailable, isOnline, storageMode, syncedCloudSessionCount]);

  useEffect(() => {
    if (!isOnline || storageMode !== 'ready' || catalogApiStatus === 'unavailable') {
      return;
    }

    void refreshSessionsFromRemoteCatalog({ force: catalogApiStatus === 'unknown' });
  }, [catalogApiStatus, isOnline, storageMode]);

  useEffect(() => {
    if (!isOnline || storageMode !== 'ready' || catalogApiStatus === 'unavailable') {
      return;
    }

    const handleWindowFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }

      void refreshSessionsFromRemoteCatalog();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void refreshSessionsFromRemoteCatalog();
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void refreshSessionsFromRemoteCatalog();
    }, REMOTE_CATALOG_REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [catalogApiStatus, isOnline, storageMode]);

  function renderArchiveSessionCard(session: UiFieldSession) {
    return (
      <div key={session.id} className="panel archive-session-card flex flex-col gap-5 p-6">
        <div className="archive-session-card__header flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`telemetry-chip ${
                  session.status === 'active'
                    ? 'border-[color:var(--line-strong)] text-[color:var(--ink)]'
                    : 'border-[color:var(--signal-strong)] text-[color:var(--signal-strong)]'
                }`}
              >
                {session.status === 'active' ? 'Activa' : 'Cerrada'}
              </span>
              <span className="telemetry-chip">
                {session.cloudSyncStatus === 'synced'
                  ? 'Nube OK'
                  : session.cloudSyncStatus === 'syncing'
                    ? 'Subiendo'
                    : session.cloudSyncStatus === 'error'
                      ? 'Error nube'
                      : session.cloudSyncStatus === 'pending'
                        ? 'Pendiente nube'
                        : 'Solo local'}
              </span>
              <span className="telemetry-chip">
                {session.catalogSyncStatus === 'synced'
                  ? 'Catálogo OK'
                  : session.catalogSyncStatus === 'syncing'
                    ? 'Catalogando'
                    : session.catalogSyncStatus === 'error'
                      ? 'Error catálogo'
                      : session.catalogSyncStatus === 'pending'
                        ? 'Pendiente catálogo'
                        : 'Sin catálogo'}
              </span>
            </div>
            <p className="display-heading text-3xl text-[color:var(--ink)]">{session.name}</p>
            <p className="text-sm text-[color:var(--muted)]">
              {formatDateTime(session.startedAt, "d MMM yyyy · HH:mm")} · {resolveProjectName(session.projectName)} ·{' '}
              {session.region || 'sin zona'}
            </p>
            <p className="text-sm text-[color:var(--muted)]">
              {session.cloudSyncedAt
                ? `Último respaldo: ${formatDateTime(session.cloudSyncedAt, "d MMM yyyy · HH:mm")}`
                : 'Sin respaldo en nube todavía'}
            </p>
            {session.cloudError ? (
              <p className="text-sm text-[color:var(--signal-strong)]">
                Error nube: {session.cloudError}
              </p>
            ) : null}
            <p className="text-sm text-[color:var(--muted)]">
              {session.catalogSyncedAt
                ? `Último catálogo: ${formatDateTime(session.catalogSyncedAt, "d MMM yyyy · HH:mm")}`
                : 'Sin catálogo remoto todavía'}
            </p>
            {session.catalogError ? (
              <p className="text-sm text-[color:var(--signal-strong)]">
                Error catálogo: {session.catalogError}
              </p>
            ) : null}
          </div>

          <div className="archive-session-card__actions flex items-center gap-2">
            <button
              onClick={() => void syncSessionToCloudBackup(session.id)}
              disabled={!isOnline || isSyncingCloudSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isSyncingCloudSessionId === session.id ? 'Respaldando' : 'Respaldar nube'}
            </button>
            <button
              onClick={() => void syncSessionToCatalogStore(session.id)}
              disabled={!isOnline || isCatalogApiUnavailable || isSyncingCatalogSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isCatalogApiUnavailable
                ? 'Catálogo no disponible'
                : isSyncingCatalogSessionId === session.id
                  ? 'Catalogando'
                  : 'Sincronizar catálogo'}
            </button>
            <button
              onClick={() => openZoomImportPicker(session.id)}
              disabled={isImportingSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isImportingSessionId === session.id ? 'Importando Zoom H6' : 'Importar Zoom H6'}
            </button>
            <button
              onClick={() => void exportSession(session)}
              disabled={isExportingSessionId === session.id}
              className="ui-button ui-button-primary disabled:cursor-wait disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {isExportingSessionId === session.id ? 'Exportando' : 'Exportar salida'}
            </button>
            <button
              onClick={() => void removeSession(session.id)}
              className="icon-button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="archive-session-card__metrics grid gap-4 md:grid-cols-5">
          <div className="soft-card">
            <p className="eyebrow text-[color:var(--muted)]">Puntos</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]">{session.points.length}</p>
          </div>
          <div className="soft-card">
            <p className="eyebrow text-[color:var(--muted)]">Fotos</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]">
              {session.points.reduce((count, point) => count + point.photos.length, 0)}
            </p>
          </div>
          <div className="soft-card">
            <p className="eyebrow text-[color:var(--muted)]">Tomas H6</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]">{session.audioTakes.length}</p>
          </div>
          <div className="soft-card">
            <p className="eyebrow text-[color:var(--muted)]">Asociadas</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]">
              {session.audioTakes.filter((take) => take.associatedPointId).length}
            </p>
          </div>
          <div className="soft-card">
            <p className="eyebrow text-[color:var(--muted)]">Equipo</p>
            <p className="mt-2 text-sm text-[color:var(--ink)]">{session.equipmentPreset}</p>
          </div>
        </div>

        {session.audioTakes.length > 0 ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow text-[color:var(--signal-strong)]">Índice de tomas Zoom H6</p>
              <p className="text-sm text-[color:var(--muted)]">
                {session.audioTakes.filter((take) => take.associatedPointId).length} asociadas ·{' '}
                {session.audioTakes.filter((take) => !take.associatedPointId).length} sin asociar
              </p>
            </div>

            <div className="grid gap-3">
              {session.audioTakes.map((take) => {
                const linkedPoint = session.points.find((point) => point.id === take.associatedPointId) ?? null;
                const matchLabel =
                  take.matchedBy === 'reference'
                    ? 'Referencia'
                    : take.matchedBy === 'time'
                      ? 'Hora'
                      : take.matchedBy === 'sequence'
                        ? 'Orden'
                      : take.matchedBy === 'manual'
                        ? 'Manual'
                        : 'Sin asociar';

                return (
                  <details key={take.id} className="soft-card">
                    <summary className="manual-details__summary">
                      <div className="space-y-2">
                        <p className="text-sm text-[color:var(--ink)]">{take.fileName}</p>
                        <p className="text-sm text-[color:var(--muted)]">
                          {formatDateTime(take.inferredRecordedAt, "d MMM yyyy · HH:mm:ss")} · {formatFileSize(take.sizeBytes)}
                        </p>
                        <p className="text-sm text-[color:var(--muted)]">{formatTakeTechnicalSummary(take)}</p>
                        <p className="text-sm text-[color:var(--ink)]">
                          {linkedPoint
                            ? `${linkedPoint.placeName} · ${
                                take.matchedBy === 'reference'
                                  ? 'asociada por referencia'
                                  : take.matchedBy === 'sequence'
                                    ? 'asociada por orden de captura'
                                  : take.matchedBy === 'manual'
                                    ? 'asignación manual'
                                    : `a ${take.matchedPointDeltaMinutes ?? '?'} min del punto`
                              }`
                            : 'No se pudo asociar automáticamente'}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <span className="telemetry-chip">{matchLabel}</span>
                        <span className="manual-details__hint">Editar</span>
                      </div>
                    </summary>

                    <div className="manual-details__body mt-5 grid gap-4">
                      <div className="grid gap-4 md:grid-cols-[1fr,auto]">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Punto asociado</span>
                          <select
                            value={take.associatedPointId ?? ''}
                            onChange={(event) =>
                              void assignAudioTakeToPoint(session.id, take.id, event.target.value || null)
                            }
                            className="field-input"
                          >
                            <option value="">Sin asignar</option>
                            {session.points.map((point) => (
                              <option key={point.id} value={point.id}>
                                {point.placeName} · {formatDateTime(point.createdAt, 'HH:mm:ss')}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="flex items-end">
                          <button
                            onClick={() => void autoAssignAudioTake(session.id, take.id)}
                            className="ui-button ui-button-secondary"
                          >
                            Autoasignar
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Referencia detectada</span>
                          <input
                            defaultValue={take.detectedReference}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                detectedReference: event.target.value.trim(),
                              }))
                            }
                            className="field-input"
                            placeholder="ZOOM0001"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Setup de entrada</span>
                          <input
                            defaultValue={take.inputSetup}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                inputSetup: event.target.value.trim(),
                              }))
                            }
                            className="field-input"
                            placeholder="XY / MS / cápsulas externas"
                          />
                        </label>
                      </div>

                      <div className="grid gap-4 md:grid-cols-4">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Duración (s)</span>
                          <input
                            defaultValue={take.durationSeconds ?? ''}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                durationSeconds: parseOptionalNumber(event.target.value),
                              }))
                            }
                            className="field-input telemetry-text"
                            placeholder="123.4"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Sample rate</span>
                          <input
                            defaultValue={take.sampleRateHz ?? ''}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                sampleRateHz: parseOptionalNumber(event.target.value),
                              }))
                            }
                            className="field-input telemetry-text"
                            placeholder="48000"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Bit depth</span>
                          <input
                            defaultValue={take.bitDepth ?? ''}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                bitDepth: parseOptionalNumber(event.target.value),
                              }))
                            }
                            className="field-input telemetry-text"
                            placeholder="24"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Canales</span>
                          <input
                            defaultValue={take.channels ?? ''}
                            onBlur={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                channels: parseOptionalNumber(event.target.value),
                              }))
                            }
                            className="field-input telemetry-text"
                            placeholder="2"
                          />
                        </label>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Low cut</span>
                          <select
                            value={take.lowCutEnabled == null ? 'unknown' : String(take.lowCutEnabled)}
                            onChange={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                lowCutEnabled: parseOptionalBoolean(event.target.value),
                              }))
                            }
                            className="field-input"
                          >
                            <option value="unknown">Sin dato</option>
                            <option value="true">Activado</option>
                            <option value="false">Desactivado</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Limiter</span>
                          <select
                            value={take.limiterEnabled == null ? 'unknown' : String(take.limiterEnabled)}
                            onChange={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                limiterEnabled: parseOptionalBoolean(event.target.value),
                              }))
                            }
                            className="field-input"
                          >
                            <option value="unknown">Sin dato</option>
                            <option value="true">Activado</option>
                            <option value="false">Desactivado</option>
                          </select>
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Phantom</span>
                          <select
                            value={take.phantomPowerEnabled == null ? 'unknown' : String(take.phantomPowerEnabled)}
                            onChange={(event) =>
                              void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                                ...currentTake,
                                phantomPowerEnabled: parseOptionalBoolean(event.target.value),
                              }))
                            }
                            className="field-input"
                          >
                            <option value="unknown">Sin dato</option>
                            <option value="true">Activado</option>
                            <option value="false">Desactivado</option>
                          </select>
                        </label>
                      </div>

                      <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                        <span>Notas de toma</span>
                        <textarea
                          defaultValue={take.takeNotes}
                          onBlur={(event) =>
                            void updateSessionAudioTake(session.id, take.id, (currentTake) => ({
                              ...currentTake,
                              takeNotes: event.target.value.trim(),
                            }))
                          }
                          rows={3}
                          className="field-input min-h-24"
                          placeholder="Ruido, clipping, variaciones de setup, incidencias..."
                        />
                      </label>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="field-shell fieldnotes-shell">
      <input
        ref={zoomImportInputRef}
        type="file"
        accept=".wav,.WAV,.mp3,.MP3,audio/*"
        multiple
        className="hidden"
        onChange={handleZoomImportInput}
      />
      <datalist id="project-name-options">
        {knownProjectNames.map((projectName) => (
          <option key={projectName} value={projectName} />
        ))}
      </datalist>

      <div className="fieldnotes-app">
        {showSidebar ? (
          <aside className="fieldnotes-sidebar">
            <div className="panel sidebar-nav-panel">
              <p className="eyebrow">FieldNotes AI</p>
              <nav className="sidebar-nav">
                {navigationItems.map((item) => (
                  <React.Fragment key={item.view}>
                    <ViewButton
                      active={view === item.view}
                      label={item.label}
                      description={item.description}
                      icon={item.icon}
                      onClick={item.onClick}
                    />
                  </React.Fragment>
                ))}
              </nav>
            </div>

            {view !== 'home' ? (
              <div className="panel sidebar-session-card sidebar-session-card--compact">
                <p className="eyebrow">Salida actual</p>
                <p className="sidebar-session-card__title">
                  {activeSession ? activeSession.name : 'No hay salida activa'}
                </p>
                {activeSession ? (
                  <div className="session-meta-list session-meta-list--compact">
                    <div className="session-meta-row">
                      <span className="session-meta-label">Trabajo</span>
                      <span>{activeSessionProjectName}</span>
                    </div>
                    <div className="session-meta-row">
                      <span className="session-meta-label">Zona</span>
                      <span>{activeSession.region || 'sin definir'}</span>
                    </div>
                  </div>
                ) : (
                  <p className="module-copy text-sm">
                    Crea una salida para poder lanzar nuevos registros desde el terreno.
                  </p>
                )}
                <div className="sidebar-session-card__stats">
                  <span className="telemetry-chip">
                    {activeSession ? `${activeSession.points.length} registros` : '0 registros'}
                  </span>
                  <span className={`telemetry-chip ${isOnline ? '' : 'telemetry-chip--offline'}`}>
                    {isOnline ? 'En línea' : 'Offline'}
                  </span>
                </div>
                {activeSession ? (
                  <div className="action-row action-row--compact action-row--support">
                    <button type="button" onClick={() => setView('export')} className="ui-button ui-button-secondary">
                      <History className="h-4 w-4" />
                      Abrir archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => openZoomImportPicker(activeSession.id)}
                      className="ui-button ui-button-secondary"
                    >
                      <AudioWaveform className="h-4 w-4" />
                      Importar H6
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </aside>
        ) : null}

        <main className="fieldnotes-main">
          {view === 'home' ? (
            <motion.section
              key="home-topbar"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel home-topbar panel-tone panel-tone--sky"
            >
              <div className="home-topbar__brand">
                <p className="eyebrow">Entrada principal</p>
                <p className="display-heading home-topbar__title">{homeLauncherTitle}</p>
                <p className="module-copy text-sm md:text-base">
                  {homeLauncherCopy}
                </p>
                <div className="action-row home-topbar__actions">
                  <button type="button" onClick={() => setView('session')} className="ui-button ui-button-secondary">
                    <MapPinned className="h-4 w-4" />
                    Abrir salidas
                  </button>
                  <button
                    type="button"
                    onClick={() => setView(activeSession ? 'point' : 'session')}
                    className="ui-button ui-button-primary"
                  >
                    <Mic className="h-4 w-4" />
                    {activeSession ? 'Nuevo registro' : 'Preparar salida'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      recordPoint && recordSession ? openRecordView(recordSession.id, recordPoint.id) : setView('export')
                    }
                    className="ui-button ui-button-secondary"
                  >
                    <History className="h-4 w-4" />
                    Abrir archivo
                  </button>
                </div>
              </div>
              <div className="home-summary-grid">
                <div className="soft-card">
                  <p className="eyebrow">GPS</p>
                  <p className="summary-value">{homeGpsValue}</p>
                  <p className="module-copy text-sm">{homeGpsCopy}</p>
                </div>
                <div className="soft-card">
                  <p className="eyebrow">Lugar</p>
                  <p className="summary-value">{homePlaceValue}</p>
                  <p className="module-copy text-sm">{homePlaceCopy}</p>
                </div>
                <div className="soft-card">
                  <p className="eyebrow">Sincronización</p>
                  <p className="summary-value">{homeSyncValue}</p>
                  <p className="module-copy text-sm">{syncPendingSummary}</p>
                </div>
                <div className="soft-card">
                  <p className="eyebrow">Revisión</p>
                  <p className="summary-value">{homeReviewValue}</p>
                  <p className="module-copy text-sm">{metadataReviewSummary}</p>
                </div>
              </div>
              <div className="home-topbar__controls">
                <div className="status-inline-group">
                  <span className={`telemetry-chip ${isOnline ? '' : 'telemetry-chip--offline'}`}>
                    {isOnline ? 'En línea' : 'Offline'}
                  </span>
                  <span className="telemetry-chip telemetry-chip--muted">{storageSummary}</span>
                  <span className="telemetry-chip telemetry-chip--muted">
                    {activeSession ? `${activeSession.points.length} registros activos` : 'Sin salida activa'}
                  </span>
                </div>
                <div className="utility-inline-group">
                  {activeSession ? (
                    <button
                      type="button"
                      onClick={() => openZoomImportPicker(activeSession.id)}
                      className="ui-button ui-button-ghost"
                    >
                      <AudioWaveform className="h-4 w-4" />
                      Importar H6
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDisplayMode(isSunMode ? 'night' : 'sun')}
                    className={`mode-toggle ${isSunMode ? 'is-sun' : ''}`}
                  >
                    <span className="mode-toggle__icon">
                      {isSunMode ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
                    </span>
                    {isSunMode ? 'Modo noche' : 'Modo sol'}
                  </button>
                </div>
              </div>
            </motion.section>
          ) : (
            <motion.header
              key={`section-${view}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel section-header"
            >
              <div className="section-header__copy">
                <p className="eyebrow">{currentViewLabel}</p>
                <h2 className="display-heading text-3xl md:text-5xl">{currentViewTitle}</h2>
                <p className="module-copy text-sm md:text-base">{currentViewDescription}</p>
              </div>

              <div className="section-header__rail">
                <div className="section-header__meta">
                  <span className={`telemetry-chip ${isOnline ? '' : 'telemetry-chip--offline'}`}>
                    {isOnline ? 'En línea' : 'Offline'}
                  </span>
                  <span className="telemetry-chip telemetry-chip--muted">{storageSummary}</span>
                </div>
                <div className="section-header__utility">
                  <button type="button" onClick={() => setView('home')} className="ui-button ui-button-ghost">
                    <House className="h-4 w-4" />
                    Inicio
                  </button>
                  <button
                    type="button"
                    onClick={() => setDisplayMode(isSunMode ? 'night' : 'sun')}
                    className={`mode-toggle ${isSunMode ? 'is-sun' : ''}`}
                  >
                    <span className="mode-toggle__icon">
                      {isSunMode ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
                    </span>
                    {isSunMode ? 'Modo noche' : 'Modo sol'}
                  </button>
                </div>
              </div>
            </motion.header>
          )}

          {shouldShowStatusStack ? (
            <div className="status-stack">
              {shouldShowOperationalBanner ? (
                <div className="panel status-banner">
                  <p className="eyebrow">Estado operativo</p>
                  <p className="module-copy text-sm">{statusNote}</p>
                </div>
              ) : null}
              {!isOnline ? (
                <div className="panel status-banner status-banner--warning">
                  <p className="eyebrow">Conectividad</p>
                  <p className="module-copy text-sm">
                    Estás sin red. GPS, notas, fotos y guardado siguen activos; clima y lugar se completarán cuando vuelva la conexión.
                  </p>
                </div>
              ) : null}
              {isCatalogApiUnavailable ? (
                <div className="panel status-banner status-banner--warning">
                  <p className="eyebrow">Catálogo remoto</p>
                  <p className="module-copy text-sm">
                    Las rutas `/api/catalog` no están disponibles aquí. El guardado local y las exportaciones siguen funcionando, pero la sincronización remota queda desactivada.
                  </p>
                </div>
              ) : null}
              {storageMode === 'memory-only' ? (
                <div className="panel status-banner status-banner--warning">
                  <p className="eyebrow">Almacenamiento</p>
                  <p className="module-copy text-sm">
                    No hay acceso al archivo local. La salida funciona, pero conviene exportar o reiniciar el almacenamiento antes de cerrar la app.
                  </p>
                </div>
              ) : null}
              {appError ? (
                <div className="panel status-banner status-banner--error">
                  <p className="eyebrow">Aviso</p>
                  <p className="module-copy text-sm">{appError}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {showMobileDock ? (
            <nav className="menu-shell mobile-dock">
              {navigationItems.map((item) => (
                <React.Fragment key={item.view}>
                  <ViewButton
                    active={view === item.view}
                    label={item.label}
                    description={item.description}
                    icon={item.icon}
                    compact
                    onClick={item.onClick}
                  />
                </React.Fragment>
              ))}
            </nav>
          ) : null}

          <AnimatePresence mode="wait">
            {view === 'home' ? (
              <motion.section
                key="home"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                className="layout-home"
              >
                <div className="home-primary-grid">
              <div className="panel home-session-overview panel-tone panel-tone--sky">
                    <div className="panel-heading">
                      <p className="eyebrow">Salida actual</p>
                      <h3 className="display-heading text-3xl">
                        {activeSession ? activeSession.name : 'Prepara la próxima salida'}
                      </h3>
                      <p className="module-copy text-sm">
                        {activeSession
                          ? `${activeSessionProjectName} · ${activeSession.region || 'sin zona'} · ${captureDateLabel}`
                          : 'Empieza por crear o abrir una salida. Después la captura y el archivo quedan conectados.'}
                      </p>
                    </div>

                    <div className="stats-grid">
                      <div className="soft-card">
                        <p className="eyebrow">Hora</p>
                        <p className="summary-value">{captureTimeLabel}</p>
                        <p className="module-copy text-sm">{captureDateLabel}</p>
                      </div>
                      <div className="soft-card">
                        <p className="eyebrow">Registros</p>
                        <p className="summary-value">{activeSession ? activeSession.points.length : 0}</p>
                        <p className="module-copy text-sm">Puntos guardados en la salida activa.</p>
                      </div>
                      <div className="soft-card">
                        <p className="eyebrow">Fotos</p>
                        <p className="summary-value">{activeSessionPhotoCount}</p>
                        <p className="module-copy text-sm">Fotos asociadas a la salida actual.</p>
                      </div>
                      <div className="soft-card">
                        <p className="eyebrow">Tomas H6</p>
                        <p className="summary-value">{activeSession ? activeSession.audioTakes.length : 0}</p>
                        <p className="module-copy text-sm">Tomas importadas en esta salida.</p>
                      </div>
                    </div>

                    {latestActivePoints.length > 0 ? (
                      <div className="home-browser-list">
                        {latestActivePoints.map((point) => (
                          <button
                            key={point.id}
                            type="button"
                            onClick={() => openRecordView(activeSession!.id, point.id)}
                            className="library-entry-card"
                          >
                            <span className="library-entry-card__copy">
                              <span className="library-entry-card__eyebrow">Registro reciente</span>
                              <strong className="library-entry-card__title">{point.placeName}</strong>
                              <span className="library-entry-card__meta">
                                {formatDateTime(point.createdAt, "d MMM yyyy · HH:mm")} · {point.soundscapeClassification?.summary || point.observedWeather || 'Sin resumen'}
                              </span>
                            </span>
                            <span className="library-entry-card__cta">Abrir</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="home-library-stack">
                    <div className="panel home-library-card panel-tone panel-tone--mint">
                      <div className="panel-heading">
                        <p className="eyebrow">Trabajo existente</p>
                        <h3 className="display-heading text-3xl">Trabajos y salidas</h3>
                        <p className="module-copy text-sm">
                          Los trabajos recientes quedan siempre a la vista con acceso directo a su archivo.
                        </p>
                      </div>

                      <div className="dashboard-browser-grid">
                        <div className="dashboard-subsection">
                          <p className="eyebrow">Trabajos</p>
                          {recentProjectGroups.length > 0 ? (
                            <div className="home-browser-list">
                              {recentProjectGroups.map((group) => (
                                <button
                                  key={group.key}
                                  type="button"
                                  onClick={() => openProjectArchiveFromHome(group.key)}
                                  className="library-entry-card"
                                >
                                  <span className="library-entry-card__copy">
                                    <span className="library-entry-card__eyebrow">Trabajo</span>
                                    <strong className="library-entry-card__title">{group.name}</strong>
                                    <span className="library-entry-card__meta">
                                      {group.sessionCount} salidas · {group.pointCount} registros · {group.audioTakeCount} tomas H6
                                    </span>
                                  </span>
                                  <span className="library-entry-card__cta">Abrir</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="module-copy text-sm">Todavía no hay trabajos archivados.</p>
                          )}
                        </div>

                        <div className="dashboard-subsection">
                          <p className="eyebrow">Salidas</p>
                          {recentSessions.length > 0 ? (
                            <div className="home-browser-list">
                              {recentSessions.map((session) => (
                                <button
                                  key={session.id}
                                  type="button"
                                  onClick={() => openSessionArchiveFromHome(session.id)}
                                  className="library-entry-card"
                                >
                                  <span className="library-entry-card__copy">
                                    <span className="library-entry-card__eyebrow">
                                      {session.status === 'active' ? 'Salida activa' : 'Salida cerrada'}
                                    </span>
                                    <strong className="library-entry-card__title">{session.name}</strong>
                                    <span className="library-entry-card__meta">
                                      {resolveProjectName(session.projectName)} · {session.points.length} registros · {session.audioTakes.length} tomas H6
                                    </span>
                                  </span>
                                  <span className="library-entry-card__cta">Abrir archivo</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <p className="module-copy text-sm">No hay salidas guardadas todavía.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="panel home-library-card home-library-card--media panel-tone panel-tone--amber">
                      <div className="panel-heading">
                        <p className="eyebrow">Archivos</p>
                        <h3 className="display-heading text-3xl">Fotos y audio visibles</h3>
                        <p className="module-copy text-sm">
                          La media reciente deja de estar escondida: abre cada foto o toma desde aquí.
                        </p>
                      </div>

                      <div className="home-media-section">
                        <div className="home-media-section__header">
                          <span className="telemetry-chip">
                            <Camera className="h-3.5 w-3.5" />
                            {recentPhotoLibrary.length} fotos visibles
                          </span>
                        </div>
                        {recentPhotoLibrary.length > 0 ? (
                          <div className="home-media-grid">
                            {recentPhotoLibrary.map((photo) => (
                              <button
                                key={photo.id}
                                type="button"
                                onClick={() => openRecordView(photo.sessionId, photo.pointId)}
                                className="media-thumb-card"
                              >
                                <img src={photo.previewUrl} alt={photo.pointName} className="media-thumb-card__image" />
                                <span className="media-thumb-card__caption">
                                  <strong>{photo.pointName}</strong>
                                  <small>{formatDateTime(photo.createdAt, "d MMM · HH:mm")}</small>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">No hay fotos recientes disponibles en esta vista.</p>
                        )}
                      </div>

                      <div className="home-media-section">
                        <div className="home-media-section__header">
                          <span className="telemetry-chip">
                            <AudioWaveform className="h-3.5 w-3.5" />
                            {recentAudioLibrary.length} tomas H6 visibles
                          </span>
                        </div>
                        {recentAudioLibrary.length > 0 ? (
                          <div className="home-audio-list">
                            {recentAudioLibrary.map((take) => (
                              <button
                                key={take.id}
                                type="button"
                                onClick={() => openSessionArchiveFromHome(take.sessionId)}
                                className="library-entry-card"
                              >
                                <span className="library-entry-card__copy">
                                  <span className="library-entry-card__eyebrow">Toma H6</span>
                                  <strong className="library-entry-card__title">{take.fileName}</strong>
                                  <span className="library-entry-card__meta">
                                    {take.pointName || 'Sin punto asociado'} · {take.projectName} · {formatDateTime(take.inferredRecordedAt, "d MMM · HH:mm")}
                                  </span>
                                </span>
                                <span className="library-entry-card__cta">Abrir salida</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">Todavía no hay tomas H6 visibles en la biblioteca.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.section>
            ) : null}

            {view === 'session' ? (
              <motion.section
                key="panel"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                className="layout-dashboard"
              >
                <div className="panel panel-primary dashboard-session-panel panel-tone panel-tone--sky">
                  <div className="panel-heading panel-heading--inverse">
                    <p className="eyebrow eyebrow-inverse">{activeSession ? 'Salida activa' : 'Preparar salida'}</p>
                    <h3 className="display-heading text-3xl panel-primary-title">
                      {activeSession ? activeSession.name : 'Prepara la próxima salida'}
                    </h3>
                    {activeSession ? (
                      <div className="session-meta-list">
                        <div className="session-meta-row">
                          <span className="session-meta-label">Trabajo</span>
                          <span>{activeSessionProjectName}</span>
                        </div>
                        <div className="session-meta-row">
                          <span className="session-meta-label">Zona</span>
                          <span>{activeSession.region || 'sin definir'}</span>
                        </div>
                        <div className="session-meta-row">
                          <span className="session-meta-label">Registros</span>
                          <span>{activeSession.points.length}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="module-copy text-sm">
                        Define una salida, activa el GPS y deja listo el contexto antes de salir al terreno.
                      </p>
                    )}
                  </div>

                  {activeSession ? (
                    <>
                      <div className="stats-grid">
                        <div className="soft-card">
                          <p className="eyebrow">Registros</p>
                          <p className="summary-value">{activeSession.points.length}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Fotos</p>
                          <p className="summary-value">{activeSessionPhotoCount}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Tomas H6</p>
                          <p className="summary-value">{activeSession.audioTakes.length}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Revisión</p>
                          <p className="summary-value">{totalOperationalPendingCount}</p>
                          <p className="module-copy text-sm">{operationalPendingSummary}</p>
                        </div>
                      </div>

                      <div className="action-row">
                        <button type="button" onClick={() => setView('point')} className="ui-button ui-button-primary">
                          <Mic className="h-4 w-4" />
                          Ir a nuevo registro
                        </button>
                        <button
                          type="button"
                          onClick={() => openZoomImportPicker(activeSession.id)}
                          className="ui-button ui-button-secondary"
                        >
                          <AudioWaveform className="h-4 w-4" />
                          Importar carpeta Zoom H6
                        </button>
                        {recordPoint && recordSession ? (
                          <button
                            type="button"
                            onClick={() => openRecordView(recordSession.id, recordPoint.id)}
                            className="ui-button ui-button-secondary"
                          >
                            <History className="h-4 w-4" />
                            Abrir último registro
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void closeActiveSession()} className="ui-button ui-button-danger">
                          Cerrar salida
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="grid gap-4">
                      <label className="grid gap-2 text-sm panel-primary-label">
                        <span>Nombre de la salida</span>
                        <input
                          value={sessionDraft.name}
                          onChange={(event) => setSessionDraft((previous) => ({ ...previous, name: event.target.value }))}
                          className="field-input"
                        />
                      </label>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm panel-primary-label">
                          <span>Trabajo</span>
                          <input
                            value={sessionDraft.projectName}
                            onChange={(event) =>
                              setSessionDraft((previous) => ({ ...previous, projectName: event.target.value }))
                            }
                            className="field-input"
                            placeholder="Paisajes sonoros costa atlántica"
                            list="project-name-options"
                          />
                        </label>
                        <label className="grid gap-2 text-sm panel-primary-label">
                          <span>Zona / región</span>
                          <input
                            value={sessionDraft.region}
                            onChange={(event) => setSessionDraft((previous) => ({ ...previous, region: event.target.value }))}
                            className="field-input"
                            placeholder="Vigo, Galicia"
                          />
                        </label>
                      </div>
                      <label className="grid gap-2 text-sm panel-primary-label">
                        <span>Preset de equipo</span>
                        <input
                          value={sessionDraft.equipmentPreset}
                          onChange={(event) =>
                            setSessionDraft((previous) => ({ ...previous, equipmentPreset: event.target.value }))
                          }
                          className="field-input"
                          placeholder="Zoom H6 · XY"
                        />
                      </label>
                      <label className="grid gap-2 text-sm panel-primary-label">
                        <span>Notas</span>
                        <textarea
                          value={sessionDraft.notes}
                          onChange={(event) => setSessionDraft((previous) => ({ ...previous, notes: event.target.value }))}
                          rows={4}
                          className="field-input min-h-28"
                          placeholder="Objetivo de la salida, ruta o condiciones esperadas..."
                        />
                      </label>
                      <div className="action-row">
                        <button type="button" onClick={createSession} className="ui-button ui-button-primary">
                          Iniciar salida
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="panel dashboard-browser-panel panel-tone panel-tone--mint">
                  <div className="panel-heading">
                    <p className="eyebrow">Archivo de trabajo</p>
                    <h3 className="display-heading text-3xl">Trabajos y salidas visibles</h3>
                    <p className="module-copy text-sm">
                      Todo lo que ya existe queda aquí con acceso directo. No hace falta recordar nombres ni volver atrás.
                    </p>
                  </div>

                  <div className="dashboard-browser-grid">
                    <div className="dashboard-browser-column">
                      <div className="dashboard-subsection">
                        <p className="eyebrow">Trabajos</p>
                        {recentProjectGroups.length > 0 ? (
                          <div className="home-browser-list">
                            {recentProjectGroups.map((group) => (
                              <button
                                key={group.key}
                                type="button"
                                onClick={() => focusArchiveProject(group.key)}
                                className="library-entry-card"
                              >
                                <span className="library-entry-card__copy">
                                  <span className="library-entry-card__eyebrow">
                                    {group.activeSessionCount > 0 ? 'Con salida activa' : 'Archivo'}
                                  </span>
                                  <strong className="library-entry-card__title">{group.name}</strong>
                                  <span className="library-entry-card__meta">
                                    {group.sessionCount} salidas · {group.pointCount} registros · {group.audioTakeCount} tomas H6
                                  </span>
                                </span>
                                <span className="library-entry-card__cta">Abrir archivo</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">Todavía no hay trabajos archivados.</p>
                        )}
                      </div>
                    </div>

                    <div className="dashboard-browser-column">
                      <div className="dashboard-subsection">
                        <p className="eyebrow">Salidas</p>
                        {sessions.length > 0 ? (
                          <div className="home-browser-list">
                            {sessions.slice(0, 6).map((session) => (
                              <button
                                key={session.id}
                                type="button"
                                onClick={() => openSessionWorkspace(session.id)}
                                className="library-entry-card"
                              >
                                <span className="library-entry-card__copy">
                                  <span className="library-entry-card__eyebrow">
                                    {session.status === 'active' ? 'Activa ahora' : 'Salida cerrada'}
                                  </span>
                                  <strong className="library-entry-card__title">{session.name}</strong>
                                  <span className="library-entry-card__meta">
                                    {resolveProjectName(session.projectName)} · {session.points.length} registros · {session.audioTakes.length} tomas H6
                                  </span>
                                </span>
                                <span className="library-entry-card__cta">
                                  {session.status === 'active' ? 'Abrir panel' : 'Abrir archivo'}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">No hay salidas creadas todavía.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel dashboard-search-panel panel-tone panel-tone--clay">
                  <div className="panel-heading">
                    <p className="eyebrow">Buscar registros</p>
                    <h3 className="display-heading text-3xl">Lugar, trabajo o referencia H6</h3>
                    <p className="module-copy text-sm">
                      El buscador sirve para saltar directamente al registro correcto cuando ya sabes qué quieres abrir.
                    </p>
                  </div>

                  <label className="search-shell">
                    <Search className="h-4 w-4" />
                    <input
                      value={dashboardQuery}
                      onChange={(event) => setDashboardQuery(event.target.value)}
                      placeholder="Ej. Vigo, lluvia ligera, H6-032..."
                      className="search-shell__input"
                    />
                  </label>

                  <div className="recent-entry-list">
                    {recentRecords.length > 0 ? (
                      recentRecords.map((record) => {
                        const badge = resolveSoundscapeBadge(record.point);
                        const BadgeIcon = badge.icon;

                        return (
                          <button
                            key={`${record.sessionId}:${record.point.id}`}
                            type="button"
                            onClick={() => openRecordView(record.sessionId, record.point.id)}
                            className="recent-entry-card"
                          >
                            <span className="recent-entry-card__icon">
                              <BadgeIcon className="h-4 w-4" />
                            </span>
                            <span className="recent-entry-card__meta">
                              <strong>{record.point.placeName}</strong>
                              <small>
                                {formatDateTime(record.point.createdAt, "d MMM yyyy · HH:mm")} · {record.projectName}
                              </small>
                              <small>{record.point.soundscapeClassification?.summary || badge.label}</small>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="module-copy text-sm">
                        No hay coincidencias para la búsqueda actual.
                      </p>
                    )}
                  </div>
                </div>

                <div className="panel dashboard-map-panel panel-tone panel-tone--sky">
                  <div className="panel-heading">
                    <p className="eyebrow">Mapa de calor de grabaciones</p>
                    <h3 className="display-heading text-3xl">Actividad global de campo</h3>
                    <p className="module-copy text-sm">
                      El azul intenso marca tu posición actual. Los puntos más grandes concentran más salidas y registros.
                    </p>
                  </div>

                  <div className="action-row action-row--compact">
                    <span className="telemetry-chip">
                      <MapPinned className="h-3.5 w-3.5" />
                      {activityClusters.length} zonas
                    </span>
                    <span className="telemetry-chip">
                      <LocateFixed className="h-3.5 w-3.5" />
                      {currentLocationLabel}
                    </span>
                  </div>

                  <FieldActivityMap
                    clusters={activityClusters}
                    currentLocation={
                      currentGps
                        ? {
                            lat: currentGps.lat,
                            lon: currentGps.lon,
                            label: currentLocationLabel,
                          }
                        : null
                    }
                  />
                </div>

                <div className="panel dashboard-insights-panel panel-tone panel-tone--amber">
                  <div className="panel-heading">
                    <p className="eyebrow">Volumen y pendientes</p>
                    <h3 className="display-heading text-3xl">Estado del archivo y la sincronización</h3>
                    <p className="module-copy text-sm">
                      Aquí ves cuánto material hay y qué queda por resolver antes de cerrar la salida.
                    </p>
                  </div>

                  <div className="stats-grid">
                    <div className="soft-card">
                      <p className="eyebrow">Trabajos</p>
                      <p className="summary-value">{projectCount}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Salidas</p>
                      <p className="summary-value">{sessions.length}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Fotos</p>
                      <p className="summary-value">{totalPhotoCount}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Tomas H6</p>
                      <p className="summary-value">{totalAudioTakeCount}</p>
                    </div>
                  </div>

                  <div className="project-preview-list">
                    <div className="soft-card">
                      <p className="eyebrow">Pendiente nube</p>
                      <p className="summary-value">{pendingCloudSessionCount}</p>
                      <p className="module-copy text-sm">Salidas sin respaldo completo.</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Pendiente catálogo</p>
                      <p className="summary-value">{pendingCatalogSessionCount}</p>
                      <p className="module-copy text-sm">Salidas que aún no aparecen en otros dispositivos.</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Metadatos</p>
                      <p className="summary-value">{pendingEnrichmentCount}</p>
                      <p className="module-copy text-sm">Puntos pendientes de clima o lugar.</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow">Tomas por asociar</p>
                      <p className="summary-value">{unassignedAudioTakeCount}</p>
                      <p className="module-copy text-sm">Audios H6 todavía sin punto asignado.</p>
                    </div>
                  </div>

                  {recentProjectGroups.length > 0 ? (
                    <div className="project-preview-list">
                      {recentProjectGroups.map((group) => (
                        <button
                          key={group.key}
                          type="button"
                          onClick={() => focusArchiveProject(group.key)}
                          className="soft-card text-left"
                        >
                          <p className="eyebrow">{group.name}</p>
                          <p className="module-copy text-sm">
                            {group.sessionCount} salidas · {group.pointCount} puntos · última salida {formatDateTime(group.latestStartedAt, "d MMM")}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="module-copy text-sm">
                      Todavía no hay actividad archivada suficiente para construir el histórico.
                    </p>
                  )}
                </div>
              </motion.section>
            ) : null}

            {view === 'point' ? (
              <motion.section
                key="log"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                className="layout-log"
              >
                {!activeSession ? (
                  <div className="panel empty-state-card">
                    <p className="display-heading text-3xl">No hay una salida activa</p>
                    <p className="module-copy text-sm">
                      Abre el panel, crea una salida y vuelve aquí para lanzar registros con GPS, clima automática y clasificación sonora.
                    </p>
                    <button type="button" onClick={() => setView('session')} className="ui-button ui-button-primary">
                      Volver al panel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="panel panel-primary log-summary-card panel-tone panel-tone--sky">
                      <div className="panel-heading panel-heading--inverse">
                        <p className="eyebrow eyebrow-inverse">Registro activo</p>
                        <h3 className="display-heading text-3xl panel-primary-title">{activeSessionProjectName}</h3>
                        <p className="module-copy text-sm">
                          {activeSession.name} · {activeSession.region || 'zona sin definir'}
                        </p>
                      </div>

                      {!isOnline ? (
                        <div className="capture-alert capture-alert--offline">
                          <WifiOff className="h-4 w-4" />
                          <div>
                            <strong>Modo offline activo.</strong> Guarda puntos ahora y la app resolverá lugar y clima cuando vuelva la conexión.
                          </div>
                        </div>
                      ) : null}

                      {storageMode === 'memory-only' ? (
                        <div className="capture-alert capture-alert--warning">
                          <RefreshCw className="h-4 w-4" />
                          <div>
                            <strong>Archivo local no disponible.</strong> Puedes seguir trabajando, pero esta salida sólo queda en memoria hasta recuperar almacenamiento.
                          </div>
                        </div>
                      ) : null}

                      <div className="auto-meta-grid">
                        <div className="soft-card">
                          <p className="eyebrow">Fecha / hora</p>
                          <p className="summary-value">{captureTimeLabel}</p>
                          <p className="module-copy text-sm">{captureDateLabel}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">GPS bloqueado</p>
                          <p className="summary-value">{gpsAccuracyLabel}</p>
                          <p className="module-copy text-sm">{gpsLabel}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Lugar</p>
                          <p className="summary-value">{livePlaceLabel}</p>
                          <p className="module-copy text-sm">{locationMessage || locationStatusLabel}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Clima automático</p>
                          <p className="summary-value">{liveClimateLabel}</p>
                          <p className="module-copy text-sm">{weatherSnapshot?.details || weatherMessage}</p>
                        </div>
                      </div>

                      <div className="capture-readiness-card">
                        <div className="capture-readiness-card__header">
                          <p className="eyebrow eyebrow-inverse">Preparación rápida</p>
                          <span className="capture-readiness-card__count">{captureReadinessLabel}</span>
                        </div>
                        <div className="capture-readiness-grid">
                          {captureReadinessItems.map((item) => (
                            <div key={item.label} className={`capture-readiness-pill ${item.ready ? 'is-ready' : ''}`}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="capture-quick-tools">
                        <button
                          type="button"
                          onClick={() => void addQuickPointToSession()}
                          className="ui-button ui-button-primary"
                          disabled={isQuickCapturing}
                        >
                          <Mic className="h-4 w-4" />
                          {isQuickCapturing ? 'Guardando...' : 'Guardar registro rápido'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void listenAndClassifySoundscape()}
                          disabled={soundscapeStatus === 'listening'}
                          className="listen-button capture-quick-tool"
                        >
                          <Sparkles className="h-5 w-5" />
                          {soundscapeStatus === 'listening' ? 'Analizando 15 s...' : 'DETECTAR AMBIENTE'}
                        </button>
                        <label className="ui-button ui-button-secondary ui-button-upload">
                          <Camera className="h-4 w-4" />
                          Añadir foto
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            multiple
                            className="hidden"
                            onChange={handleDraftPhotosInput}
                          />
                        </label>
                      </div>

                      <div className="action-row action-row--support">
                        <button type="button" onClick={() => void activateGpsAndApplyToDraft()} className="ui-button ui-button-secondary">
                          <LocateFixed className="h-4 w-4" />
                          Activar GPS
                        </button>
                        <button
                          type="button"
                          onClick={refreshDetectedPlace}
                          disabled={!canRefreshDetectedPlace}
                          className="ui-button ui-button-secondary"
                        >
                          <MapPin className="h-4 w-4" />
                          Releer ubicación
                        </button>
                        <button
                          type="button"
                          onClick={refreshAutomaticWeather}
                          disabled={!canRefreshWeather || weatherStatus === 'loading'}
                          className="ui-button ui-button-secondary"
                        >
                          <CloudRain className={`h-4 w-4 ${weatherStatus === 'loading' ? 'animate-spin' : ''}`} />
                          Actualizar clima
                        </button>
                      </div>
                    </div>

                    <div className="panel log-form-card panel-tone panel-tone--mint">
                      <div className="panel-heading">
                        <p className="eyebrow">Datos esenciales</p>
                        <h3 className="display-heading text-3xl">Lo mínimo para cerrar un buen registro</h3>
                        <p className="module-copy text-sm">
                          Ajusta sólo lo que la app no haya resuelto sola. Los campos técnicos viven en avanzado para que la pantalla siga limpia bajo presión.
                        </p>
                      </div>

                      <div className="quick-form-grid">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Nombre del lugar</span>
                          <input
                            value={pointDraft.placeName}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, placeName: event.target.value }))}
                            className="field-input"
                            placeholder="Ría interior, orilla sur"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Hábitat / entorno</span>
                          <input
                            value={pointDraft.habitat}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, habitat: event.target.value }))}
                            className="field-input"
                            placeholder="Costa, ribera, bosque, urbano..."
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>ID / referencia Zoom H6</span>
                          <input
                            value={pointDraft.zoomTakeReference}
                            onChange={(event) =>
                              setPointDraft((previous) => ({ ...previous, zoomTakeReference: event.target.value }))
                            }
                            className="field-input"
                            placeholder="H6-032"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)] md:col-span-2">
                          <span>Notas</span>
                          <textarea
                            value={pointDraft.notes}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, notes: event.target.value }))}
                            rows={4}
                            className="field-input min-h-28"
                            placeholder="Incidencias, decisiones de microfonía, acceso, observaciones..."
                          />
                        </label>
                      </div>

                      <div className="action-row">
                        <button type="button" onClick={() => void addPointToSession()} className="ui-button ui-button-primary">
                          Guardar registro completo
                        </button>
                      </div>

                      <details className="manual-details">
                        <summary className="manual-details__summary">
                          <div>
                            <p className="eyebrow">Campos avanzados</p>
                            <p className="module-copy text-sm">
                              Coordenadas manuales, clima observado, etiquetas y setup técnico cuando necesites más precisión.
                            </p>
                          </div>
                          <span className="manual-details__hint">Abrir</span>
                        </summary>

                        <div className="manual-details__body grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Clima observado</span>
                            <input
                              value={pointDraft.observedWeather}
                              onChange={(event) =>
                                setPointDraft((previous) => ({ ...previous, observedWeather: event.target.value }))
                              }
                              className="field-input"
                              placeholder="Bruma ligera, 14 ºC, viento suave"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Etiquetas manuales</span>
                            <input
                              value={pointDraft.tagsText}
                              onChange={(event) => setPointDraft((previous) => ({ ...previous, tagsText: event.target.value }))}
                              className="field-input"
                              placeholder="agua, costa, amanecer"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)] md:col-span-2">
                            <span>Características del paisaje</span>
                            <textarea
                              value={pointDraft.characteristics}
                              onChange={(event) =>
                                setPointDraft((previous) => ({ ...previous, characteristics: event.target.value }))
                              }
                              rows={4}
                              className="field-input min-h-28"
                              placeholder="Distancia a la fuente, relieve, reverberación, presencia humana..."
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Latitud</span>
                            <input
                              value={pointDraft.latitude}
                              onChange={(event) =>
                                setPointDraft((previous) => ({
                                  ...previous,
                                  latitude: event.target.value,
                                  coordinateSource: 'manual',
                                }))
                              }
                              className="field-input telemetry-text"
                              placeholder="42.240598"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Longitud</span>
                            <input
                              value={pointDraft.longitude}
                              onChange={(event) =>
                                setPointDraft((previous) => ({
                                  ...previous,
                                  longitude: event.target.value,
                                  coordinateSource: 'manual',
                                }))
                              }
                              className="field-input telemetry-text"
                              placeholder="-8.720727"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)] md:col-span-2">
                            <span>Setup de micros</span>
                            <input
                              value={pointDraft.microphoneSetup}
                              onChange={(event) =>
                                setPointDraft((previous) => ({ ...previous, microphoneSetup: event.target.value }))
                              }
                              className="field-input"
                              placeholder="Zoom H6 · XY 90º"
                            />
                          </label>
                        </div>
                      </details>
                    </div>

                    <div className="panel listen-panel panel-tone panel-tone--amber">
                      <div className="panel-heading">
                        <p className="eyebrow">Sección IA</p>
                        <h3 className="display-heading text-3xl">Detectar Elementos Del Ambiente</h3>
                        <p className="module-copy text-sm">
                          Escucha 15 segundos con el micro del dispositivo para estimar pájaros, personas hablando, música, pasos, río, mar, lluvia o tráfico. No guarda el audio y la detección es local y aproximada.
                        </p>
                      </div>

                      <div className="classification-card">
                        <p className="eyebrow">Resultado</p>
                        <p className="summary-value">
                          {draftSoundscapeClassification?.summary || 'Sin detección todavía'}
                        </p>
                        <p className="module-copy text-sm">{soundscapeMessage}</p>
                        {draftSoundscapeClassification ? (
                          <div className="tag-strip">
                            {draftSoundscapeClassification.tags.map((tag) => (
                              <span key={tag} className="tag-pill">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="action-row">
                        <button
                          type="button"
                          onClick={() => void listenAndClassifySoundscape()}
                          disabled={soundscapeStatus === 'listening'}
                          className="ui-button ui-button-secondary"
                        >
                          <Sparkles className="h-4 w-4" />
                          {soundscapeStatus === 'listening' ? 'Analizando...' : 'Volver a detectar'}
                        </button>
                      </div>
                    </div>

                    <div className="panel photos-panel panel-tone panel-tone--clay">
                      <div className="panel-heading">
                        <p className="eyebrow">Área de fotos</p>
                        <h3 className="display-heading text-3xl">Setup y entorno</h3>
                      </div>

                      <label className="upload-zone upload-zone--large">
                        <ImagePlus className="h-8 w-8 text-[color:var(--signal-strong)]" />
                        <div>
                          <p className="display-heading text-2xl">Añadir fotos del punto</p>
                          <p className="module-copy text-sm">
                            Documenta micros, orientación, entorno o condiciones específicas del lugar.
                          </p>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          multiple
                          className="hidden"
                          onChange={handleDraftPhotosInput}
                        />
                      </label>

                      {draftPhotos.length > 0 ? (
                        <div className="photo-grid">
                          {draftPhotos.map((photo) => (
                            <div key={photo.id} className="soft-card">
                              <img src={photo.previewUrl} alt={photo.fileName} className="h-40 w-full object-cover" />
                              <div className="action-row action-row--compact mt-3">
                                <p className="module-copy text-sm">{photo.fileName}</p>
                                <button type="button" onClick={() => removeDraftPhoto(photo.id)} className="icon-button">
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="panel log-map-panel panel-tone panel-tone--sky">
                      <div className="panel-heading">
                        <p className="eyebrow">Exploración</p>
                        <h3 className="display-heading text-3xl">Mapa y registros previos</h3>
                      </div>

                      <div className="segment-switch">
                        <button
                          type="button"
                          onClick={() => setCaptureWorkspace('map')}
                          className={`segment-switch__button ${captureWorkspace === 'map' ? 'is-active' : ''}`}
                        >
                          Mapa
                        </button>
                        <button
                          type="button"
                          onClick={() => setCaptureWorkspace('points')}
                          className={`segment-switch__button ${captureWorkspace === 'points' ? 'is-active' : ''}`}
                        >
                          Lista
                        </button>
                      </div>

                      {captureWorkspace === 'map' ? (
                        <SessionMap
                          points={activeSessionMapPoints}
                          selectedPointId={selectedPointId}
                          onSelectPoint={(pointId) => {
                            setSelectedPointId(pointId);
                            setRecordSessionId(activeSession.id);
                            setRecordPointId(pointId);
                          }}
                          draftPoint={
                            draftPointCoordinates
                              ? {
                                  lat: draftPointCoordinates.lat,
                                  lon: draftPointCoordinates.lon,
                                  label: draftPointLabel,
                                }
                              : null
                          }
                        />
                      ) : sortedActiveSessionPoints.length > 0 ? (
                        <div className="grid gap-3">
                          {sortedActiveSessionPoints.map((point) => (
                            <React.Fragment key={point.id}>
                              <SessionPointCard
                                point={{
                                  id: point.id,
                                  placeName: point.placeName,
                                  createdAt: point.createdAt,
                                  observedWeather: point.observedWeather,
                                  zoomTakeReference: point.zoomTakeReference,
                                  microphoneSetup: point.microphoneSetup,
                                  tags: point.tags,
                                  photoPreviewUrl: point.photos[0]?.previewUrl ?? undefined,
                                }}
                                active={point.id === selectedPoint?.id}
                                onSelect={() => {
                                  setSelectedPointId(point.id);
                                  setRecordSessionId(activeSession.id);
                                  setRecordPointId(point.id);
                                }}
                              />
                            </React.Fragment>
                          ))}
                        </div>
                      ) : (
                        <p className="module-copy text-sm">
                          Todavía no hay registros guardados en esta salida.
                        </p>
                      )}
                    </div>

                    <div className="panel record-preview-card panel-tone panel-tone--amber">
                      <div className="panel-heading">
                        <p className="eyebrow">Último registro visible</p>
                        <h3 className="display-heading text-3xl">
                          {selectedPoint ? selectedPoint.placeName : 'Sin registro seleccionado'}
                        </h3>
                      </div>

                      {selectedPoint ? (
                        <>
                          <p className="module-copy text-sm">
                            {selectedPoint.soundscapeClassification?.summary || selectedPoint.observedWeather || 'Sin resumen todavía'}
                          </p>
                          <div className="action-row">
                            <button
                              type="button"
                              onClick={() => openRecordView(activeSession.id, selectedPoint.id)}
                              className="ui-button ui-button-secondary"
                            >
                              <History className="h-4 w-4" />
                              Ver registro completado
                            </button>
                            <button
                              type="button"
                              onClick={() => void removePointFromActiveSession(selectedPoint.id)}
                              className="ui-button ui-button-danger"
                            >
                              Eliminar
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="module-copy text-sm">Guarda un punto para abrir su ficha final.</p>
                      )}
                    </div>
                  </>
                )}
              </motion.section>
            ) : null}

            {view === 'export' ? (
              <motion.section
                key="record"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                className="layout-record"
              >
                {!recordSession || !recordPoint ? (
                  <div className="panel empty-state-card">
                    <p className="display-heading text-3xl">Todavía no hay registros completos</p>
                    <p className="module-copy text-sm">
                      Crea o selecciona un registro desde el panel o desde la captura activa para revisar su ficha final.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="panel archive-browser-panel panel-tone panel-tone--mint">
                      <div className="panel-heading">
                        <p className="eyebrow">Archivo visible</p>
                        <h3 className="display-heading text-3xl">Trabajos y salidas archivadas</h3>
                        <p className="module-copy text-sm">
                          Filtra por trabajo y abre cualquier salida sin adivinar dónde quedó guardada.
                        </p>
                      </div>

                      <div className="archive-filter-strip">
                        <button
                          type="button"
                          onClick={() => focusArchiveProject('all')}
                          className={`archive-filter-button ${selectedArchiveProjectKey === 'all' ? 'is-active' : ''}`}
                        >
                          Todos
                        </button>
                        {archiveProjectGroups.map((group) => (
                          <button
                            key={group.key}
                            type="button"
                            onClick={() => focusArchiveProject(group.key)}
                            className={`archive-filter-button ${selectedArchiveProjectKey === group.key ? 'is-active' : ''}`}
                          >
                            {group.name}
                          </button>
                        ))}
                      </div>

                      <p className="module-copy text-sm">
                        {currentArchiveProject
                          ? `${currentArchiveProject.sessionCount} salidas · ${currentArchiveProject.pointCount} registros · ${currentArchiveProject.audioTakeCount} tomas H6`
                          : `${visibleArchiveSessions.length} salidas visibles en total`}
                      </p>

                      {currentArchiveProject ? (
                        <div className="soft-card project-admin-card">
                          <p className="eyebrow">Gestionar trabajo</p>
                          {canManageSelectedProject ? (
                            <>
                              <p className="module-copy text-sm">
                                Un trabajo agrupa varias salidas. Si lo quitas, no borras registros: esas salidas pasan a <strong>Sin trabajo</strong>.
                              </p>
                              <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                                <span>Nombre del trabajo</span>
                                <input
                                  value={projectDraftName}
                                  onChange={(event) => setProjectDraftName(event.target.value)}
                                  className="field-input"
                                  placeholder="Paisajes urbanos de Vigo"
                                />
                              </label>
                              <div className="action-row">
                                <button
                                  type="button"
                                  onClick={() => void renameProject(currentArchiveProject.key)}
                                  disabled={isUpdatingProjectKey === currentArchiveProject.key}
                                  className="ui-button ui-button-secondary"
                                >
                                  {isUpdatingProjectKey === currentArchiveProject.key ? 'Guardando...' : 'Renombrar trabajo'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void clearProject(currentArchiveProject.key)}
                                  disabled={isUpdatingProjectKey === currentArchiveProject.key}
                                  className="ui-button ui-button-danger"
                                >
                                  {isUpdatingProjectKey === currentArchiveProject.key ? 'Actualizando...' : 'Quitar trabajo'}
                                </button>
                              </div>
                            </>
                          ) : (
                            <p className="module-copy text-sm">
                              <strong>Sin trabajo</strong> no es un trabajo guardado: es el destino de las salidas que no tienen etiqueta.
                            </p>
                          )}
                        </div>
                      ) : null}

                      {visibleArchiveSessions.length > 0 ? (
                        <div className="archive-session-list">
                          {visibleArchiveSessions.map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => focusArchiveSession(session.id)}
                              className={`library-entry-card ${recordSession?.id === session.id ? 'library-entry-card--active' : ''}`}
                            >
                              <span className="library-entry-card__copy">
                                <span className="library-entry-card__eyebrow">
                                    {session.status === 'active' ? 'Activa ahora' : 'Salida cerrada'}
                                </span>
                                <strong className="library-entry-card__title">{session.name}</strong>
                                <span className="library-entry-card__meta">
                                  {resolveProjectName(session.projectName)} · {session.points.length} registros · {session.audioTakes.length} tomas H6
                                </span>
                              </span>
                              <span className="library-entry-card__cta">Abrir</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="module-copy text-sm">
                          No hay salidas en el filtro actual.
                        </p>
                      )}
                    </div>

                    <div className="panel archive-records-panel panel-tone panel-tone--sky">
                      <div className="panel-heading">
                        <p className="eyebrow">Salida abierta</p>
                        <h3 className="display-heading text-3xl">{recordSession.name}</h3>
                        <p className="module-copy text-sm">
                          {resolveProjectName(recordSession.projectName)} · {recordSession.region || 'sin zona'} ·{' '}
                          {formatDateTime(recordSession.startedAt, "d MMM yyyy · HH:mm")}
                        </p>
                      </div>

                      <div className="action-row action-row--compact">
                        <span className="telemetry-chip">
                          {recordSessionPoints.length} registros
                        </span>
                        <span className="telemetry-chip">
                          {recordSessionPhotoLibrary.length} fotos
                        </span>
                        <span className="telemetry-chip">
                          {recordSessionAudioLibrary.length} tomas H6
                        </span>
                      </div>

                      {recordSessionPoints.length > 0 ? (
                        <div className="archive-point-list">
                          {recordSessionPoints.map((point) => (
                            <React.Fragment key={point.id}>
                              <SessionPointCard
                                point={{
                                  id: point.id,
                                  placeName: point.placeName,
                                  createdAt: point.createdAt,
                                  observedWeather: point.observedWeather,
                                  zoomTakeReference: point.zoomTakeReference,
                                  microphoneSetup: point.microphoneSetup,
                                  tags: point.tags,
                                  photoPreviewUrl: point.photos[0]?.previewUrl ?? undefined,
                                }}
                                active={point.id === recordPoint?.id}
                                onSelect={() => openRecordView(recordSession.id, point.id)}
                              />
                            </React.Fragment>
                          ))}
                        </div>
                      ) : (
                        <p className="module-copy text-sm">
                          Esta salida todavía no tiene registros guardados.
                        </p>
                      )}
                    </div>

                    <div className="panel archive-media-panel panel-tone panel-tone--amber">
                      <div className="panel-heading">
                        <p className="eyebrow">Fotos y audio</p>
                        <h3 className="display-heading text-3xl">Biblioteca visible de la salida</h3>
                        <p className="module-copy text-sm">
                          Las fotos y las tomas H6 quedan a la vista en la misma pantalla, sin menús avanzados.
                        </p>
                      </div>

                      <div className="home-media-section">
                        <div className="home-media-section__header">
                          <span className="telemetry-chip">
                            <Camera className="h-3.5 w-3.5" />
                            {recordSessionPhotoLibrary.length} fotos
                          </span>
                          <span className="telemetry-chip">
                            <AudioWaveform className="h-3.5 w-3.5" />
                            {recordSessionAudioLibrary.filter((take) => take.associatedPointId).length} tomas asociadas
                          </span>
                        </div>

                        {recordSessionPhotoLibrary.length > 0 ? (
                          <div className="archive-media-grid">
                            {recordSessionPhotoLibrary.map((photo) => (
                              <button
                                key={photo.id}
                                type="button"
                                onClick={() => openRecordView(recordSession.id, photo.pointId)}
                                className="media-thumb-card"
                              >
                                <img src={photo.previewUrl} alt={photo.pointName} className="media-thumb-card__image" />
                                <span className="media-thumb-card__caption">
                                  <strong>{photo.pointName}</strong>
                                  <small>{formatDateTime(photo.createdAt, "d MMM · HH:mm")}</small>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">Esta salida todavía no tiene fotos visibles.</p>
                        )}
                      </div>

                      <div className="home-media-section">
                        <div className="home-media-section__header">
                          <span className="telemetry-chip">
                            <AudioWaveform className="h-3.5 w-3.5" />
                            {recordSessionAudioLibrary.length} tomas H6
                          </span>
                        </div>

                        {recordSessionAudioLibrary.length > 0 ? (
                          <div className="archive-audio-list">
                            {recordSessionAudioLibrary.map((take) => {
                              const linkedPoint =
                                recordSession.points.find((point) => point.id === take.associatedPointId) ?? null;
                              const matchLabel =
                                take.matchedBy === 'reference'
                                  ? 'Referencia'
                                  : take.matchedBy === 'time'
                                    ? 'Hora'
                                    : take.matchedBy === 'sequence'
                                      ? 'Orden'
                                    : take.matchedBy === 'manual'
                                      ? 'Manual'
                                      : 'Sin asociar';

                              return (
                                <button
                                  key={take.id}
                                  type="button"
                                  onClick={() =>
                                    linkedPoint ? openRecordView(recordSession.id, linkedPoint.id) : focusArchiveSession(recordSession.id)
                                  }
                                  className="library-entry-card"
                                >
                                  <span className="library-entry-card__copy">
                                    <span className="library-entry-card__eyebrow">Toma H6 · {matchLabel}</span>
                                    <strong className="library-entry-card__title">{take.fileName}</strong>
                                    <span className="library-entry-card__meta">
                                      {linkedPoint ? linkedPoint.placeName : 'Sin punto asociado'} ·{' '}
                                      {formatDateTime(take.inferredRecordedAt, "d MMM yyyy · HH:mm")}
                                    </span>
                                  </span>
                                  <span className="library-entry-card__cta">
                                    {linkedPoint ? 'Abrir registro' : 'Abrir salida'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="module-copy text-sm">Esta salida todavía no tiene tomas H6 importadas.</p>
                        )}
                      </div>
                    </div>

                    <div className="panel record-header-card panel-tone panel-tone--sky">
                      <div className="panel-heading">
                        <p className="eyebrow">Registro seleccionado</p>
                        <h3 className="display-heading text-4xl">{recordPoint.placeName}</h3>
                        <p className="module-copy text-sm">
                          {recordSession.name} · {resolveProjectName(recordSession.projectName)} · {formatDateTime(recordPoint.createdAt, "d MMM yyyy · HH:mm:ss")}
                        </p>
                      </div>

                      <div className="record-header-card__meta">
                        <div className="soft-card">
                          <p className="eyebrow">ID H6 asociado</p>
                          <p className="summary-value">{recordPoint.zoomTakeReference || 'Sin ID'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">IA sonora</p>
                          <p className="summary-value">{recordPoint.soundscapeClassification?.summary || 'Sin clasificar'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Estado de salida</p>
                          <p className="summary-value">{recordSession.status === 'active' ? 'Activa' : 'Cerrada'}</p>
                        </div>
                      </div>

                      <div className="action-row">
                        <button
                          type="button"
                          onClick={() => exportSessionPointCsv(recordSession, recordPoint)}
                          className="ui-button ui-button-primary"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                          Exportar CSV
                        </button>
                        <button
                          type="button"
                          onClick={() => exportSessionPointKml(recordSession, recordPoint)}
                          className="ui-button ui-button-secondary"
                        >
                          <MapIcon className="h-4 w-4" />
                          Exportar KML
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportSession(recordSession)}
                          className="ui-button ui-button-secondary"
                        >
                          <Download className="h-4 w-4" />
                          Exportar ZIP
                        </button>
                        {recordSession.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => setView('point')}
                            className="ui-button ui-button-secondary"
                          >
                            <Mic className="h-4 w-4" />
                            Seguir registrando
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="panel record-gallery-card panel-tone panel-tone--clay">
                      <div className="panel-heading">
                        <p className="eyebrow">Fotos del registro</p>
                        <h3 className="display-heading text-3xl">Galería del punto seleccionado</h3>
                      </div>

                      {recordPoint.photos.some((photo) => photo.previewUrl) ? (
                        <div className="record-gallery-grid">
                          {recordPoint.photos.map((photo) =>
                            photo.previewUrl ? (
                              <img
                                key={photo.id}
                                src={photo.previewUrl}
                                alt={photo.fileName}
                                className="record-gallery-grid__image"
                              />
                            ) : null,
                          )}
                        </div>
                      ) : (
                        <p className="module-copy text-sm">Este registro no tiene imágenes asociadas.</p>
                      )}
                    </div>

                    <div className="panel record-metadata-card panel-tone panel-tone--mint">
                      <div className="panel-heading">
                        <p className="eyebrow">Ficha del registro</p>
                        <h3 className="display-heading text-3xl">GPS, clima, notas y etiquetas</h3>
                      </div>

                      <div className="record-meta-grid">
                        <div className="soft-card">
                          <p className="eyebrow">GPS</p>
                          <p className="summary-value">{recordPoint.gps.accuracy ? `${Math.round(recordPoint.gps.accuracy)} m` : 'n/d'}</p>
                          <p className="module-copy text-sm">
                            {recordPoint.gps.lat.toFixed(6)}, {recordPoint.gps.lon.toFixed(6)}
                          </p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Clima</p>
                          <p className="summary-value">{recordPoint.observedWeather || 'Sin dato'}</p>
                          <p className="module-copy text-sm">{recordPoint.automaticWeather?.details || 'Sin detalle automático'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">IA sonora</p>
                          <p className="summary-value">{recordPoint.soundscapeClassification?.summary || 'Sin clasificar'}</p>
                          <p className="module-copy text-sm">{recordPoint.soundscapeClassification?.details || 'No se ejecutó clasificación pasiva.'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Lugar resuelto</p>
                          <p className="summary-value">{recordPoint.detectedPlace?.placeName || recordPoint.placeName}</p>
                          <p className="module-copy text-sm">{recordPoint.detectedPlace?.context || 'Sin contexto adicional'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Micros / setup</p>
                          <p className="summary-value">{recordPoint.microphoneSetup || 'Sin setup'}</p>
                          <p className="module-copy text-sm">Referencia H6: {recordPoint.zoomTakeReference || 'Sin ID'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow">Trabajo</p>
                          <p className="summary-value">{resolveProjectName(recordSession.projectName)}</p>
                          <p className="module-copy text-sm">{recordSession.region || 'Sin región'}</p>
                        </div>
                      </div>

                      {recordPoint.soundscapeClassification?.tags.length ? (
                        <div className="tag-strip">
                          {recordPoint.soundscapeClassification.tags.map((tag) => (
                            <span key={tag} className="tag-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {recordPoint.tags.length ? (
                        <div className="tag-strip">
                          {recordPoint.tags.map((tag) => (
                            <span key={tag} className="tag-pill">
                              {tag}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {recordPoint.notes ? (
                        <div className="soft-card">
                          <p className="eyebrow">Notas</p>
                          <p className="module-copy text-sm">{recordPoint.notes}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="panel record-map-card panel-tone panel-tone--sky">
                      <div className="panel-heading">
                        <p className="eyebrow">Posición</p>
                        <h3 className="display-heading text-3xl">Mapa del registro seleccionado</h3>
                      </div>

                      <SessionMap
                        points={[
                          {
                            id: recordPoint.id,
                            placeName: recordPoint.placeName,
                            lat: recordPoint.gps.lat,
                            lon: recordPoint.gps.lon,
                            orderLabel: '1',
                          },
                        ]}
                        selectedPointId={recordPoint.id}
                        onSelectPoint={() => undefined}
                      />
                    </div>

                    {renderArchiveSessionCard(recordSession)}
                  </>
                )}
              </motion.section>
            ) : null}
          </AnimatePresence>
        </main>
      </div>

    </div>
  );
}
