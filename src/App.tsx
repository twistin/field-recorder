import React, { useEffect, useRef, useState } from 'react';
import {
  AudioWaveform,
  CheckCircle2,
  Bird,
  Camera,
  CarFront,
  CloudRain,
  Download,
  FileSpreadsheet,
  Globe,
  House,
  History,
  ImagePlus,
  Info,
  LocateFixed,
  Menu,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Mic,
  MoonStar,
  RefreshCw,
  Search,
  Sparkles,
  SunMedium,
  TriangleAlert,
  Trash2,
  Upload,
  Waves,
  WifiOff,
  Wind,
  X,
} from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { v4 as uuidv4 } from 'uuid';

import { FieldActivityMap } from './components/FieldActivityMap';
import { SessionMap } from './components/SessionMap';
import { SessionPointCard } from './components/SessionPointCard';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  SegmentedControl,
  SectionHeader,
  StructuredList,
  SummaryStrip,
} from './components/ui';
import {
  getContentSwapMotion,
  getProminentInteractiveMotion,
  getSurfaceEnterMotion,
  getViewTransitionMotion,
} from './components/ui/motion';
import {
  deleteFieldSession,
  listFieldSessions,
  saveFieldSession,
} from './lib/fieldSessionsDb';
import {
  isSupportedImportedAudioFileName,
  mergeSessionAudioTakes,
  reconcileSessionAudioTakes,
} from './lib/zoomImportShared';
import type { CatalogSessionPayload, CatalogSessionSummary } from './lib/catalogPayload';
import type {
  AutomaticWeatherSummary,
  DetectedPlaceSummary,
  FieldSession,
  GpsCoordinates,
  SessionRoutePlan,
  SessionAudioTake,
  SessionPhoto,
  SessionPoint,
  SoundscapeClassification,
} from './types/fieldSessions';
import type { PublishedSelection } from './types/publishedSelections';

type View = 'home' | 'session' | 'point' | 'export';
type DisplayMode = 'night' | 'sun';
type HomeMediaFilter = 'all' | 'photos' | 'audio';
type HomeSecondaryTab = 'work' | 'media';
type SessionSupportTab = 'browser' | 'search' | 'map' | 'insights';
type CaptureSupportTab = 'map' | 'photos' | 'ai' | 'record';
type StatusTone = 'info' | 'success' | 'warning';
type ViewportMode = 'mobile' | 'tablet' | 'desktop' | 'wide';
type NavigationItem = {
  view: View;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
};

const DISPLAY_MODE_STORAGE_KEY = 'fieldnotes-display-mode';
const PREFERRED_PROJECT_NAME_STORAGE_KEY = 'fieldnotes-preferred-project-name';
const REMOTE_CATALOG_REFRESH_INTERVAL_MS = 45_000;
const REMOTE_CATALOG_REFRESH_MIN_GAP_MS = 12_000;
const CATALOG_API_UNAVAILABLE_MESSAGE =
  'La API del catálogo no está disponible en este entorno. Usa `vercel dev` o despliega la app con las rutas /api/catalog activas.';
const HOME_RECORD_PREVIEW_LIMIT = 3;
const HOME_MEDIA_OVERVIEW_PHOTO_LIMIT = 2;
const HOME_MEDIA_OVERVIEW_AUDIO_LIMIT = 2;
const HOME_MEDIA_PREVIEW_LIMIT = 4;
const HOME_AUDIO_PREVIEW_LIMIT = 4;
const DEFAULT_ROUTE_ARRIVAL_RADIUS_METERS = 150;

let exportFieldSessionLibPromise: Promise<typeof import('./lib/exportFieldSession')> | null = null;
let locationLookupLibPromise: Promise<typeof import('./lib/locationLookup')> | null = null;
let soundscapeClassificationLibPromise: Promise<typeof import('./lib/soundscapeClassification')> | null = null;
let weatherLibPromise: Promise<typeof import('./lib/weather')> | null = null;
let zoomImportLibPromise: Promise<typeof import('./lib/zoomImport')> | null = null;
let cloudSyncLibPromise: Promise<typeof import('./lib/cloudSync')> | null = null;
let catalogSyncLibPromise: Promise<typeof import('./lib/catalogSync')> | null = null;
let publishedSelectionsLibPromise: Promise<typeof import('./lib/publishedSelections')> | null = null;

function loadExportFieldSessionLib() {
  exportFieldSessionLibPromise ??= import('./lib/exportFieldSession');
  return exportFieldSessionLibPromise;
}

function loadLocationLookupLib() {
  locationLookupLibPromise ??= import('./lib/locationLookup');
  return locationLookupLibPromise;
}

function loadSoundscapeClassificationLib() {
  soundscapeClassificationLibPromise ??= import('./lib/soundscapeClassification');
  return soundscapeClassificationLibPromise;
}

function loadWeatherLib() {
  weatherLibPromise ??= import('./lib/weather');
  return weatherLibPromise;
}

function loadZoomImportLib() {
  zoomImportLibPromise ??= import('./lib/zoomImport');
  return zoomImportLibPromise;
}

function loadCloudSyncLib() {
  cloudSyncLibPromise ??= import('./lib/cloudSync');
  return cloudSyncLibPromise;
}

function loadCatalogSyncLib() {
  catalogSyncLibPromise ??= import('./lib/catalogSync');
  return catalogSyncLibPromise;
}

function loadPublishedSelectionsLib() {
  publishedSelectionsLibPromise ??= import('./lib/publishedSelections');
  return publishedSelectionsLibPromise;
}

function getViewportWidth() {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function getViewportMode(width: number): ViewportMode {
  if (width < 760) {
    return 'mobile';
  }

  if (width < 960) {
    return 'tablet';
  }

  if (width < 1440) {
    return 'desktop';
  }

  return 'wide';
}
const HOME_MEDIA_FILTERS: Array<{ id: HomeMediaFilter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'photos', label: 'Fotos' },
  { id: 'audio', label: 'Tomas H6' },
];

interface SessionDraft {
  name: string;
  projectName: string;
  region: string;
  notes: string;
  equipmentPreset: string;
  routeUrl: string;
  routeDestinationLabel: string;
  routeLatitude: string;
  routeLongitude: string;
  routeArrivalRadiusMeters: string;
  armCaptureOnArrival: boolean;
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

function buildSelectionCaption(session: Pick<FieldSession, 'projectName'>, point: Pick<SessionPoint, 'placeName' | 'notes' | 'observedWeather' | 'soundscapeClassification'>): string {
  const note = point.notes.trim();
  if (note) {
    return note;
  }

  return [
    point.placeName.trim(),
    point.soundscapeClassification?.summary || point.observedWeather || '',
    resolveProjectName(session.projectName),
  ]
    .filter(Boolean)
    .join(' · ');
}

function buildPublishedSelectionId(
  sessionId: string,
  pointId: string,
  photoId: string,
  audioTakeId: string,
): string {
  return ['pubsel', sessionId, pointId, photoId, audioTakeId].join('-');
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

function buildStorageProxyUrl(blobRef: string): string {
  return `/api/storage/blob?blob=${encodeURIComponent(blobRef)}`;
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

function normalizeNavigationUrl(value: string): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  try {
    const nextUrl = new URL(trimmedValue);
    if (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:') {
      return null;
    }

    return nextUrl.toString();
  } catch {
    return null;
  }
}

function extractCoordinatesFromNavigationUrl(value: string): { lat: number; lon: number } | null {
  const normalizedUrl = normalizeNavigationUrl(value);
  if (!normalizedUrl) {
    return null;
  }

  const decodedUrl = decodeURIComponent(normalizedUrl);
  const patterns = [
    /[?&](?:destination|query|q)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  ];

  for (const pattern of patterns) {
    const match = decodedUrl.match(pattern);
    if (!match) {
      continue;
    }

    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return { lat, lon };
    }
  }

  return null;
}

function isShortGoogleMapsUrl(value: string): boolean {
  const normalizedUrl = normalizeNavigationUrl(value);
  if (!normalizedUrl) {
    return false;
  }

  try {
    return new URL(normalizedUrl).hostname === 'maps.app.goo.gl';
  } catch {
    return false;
  }
}

function parseArrivalRadius(value: string): number | null {
  const parsed = parseOptionalNumber(value);
  if (parsed == null || parsed <= 0) {
    return null;
  }

  return Math.round(parsed);
}

function clampArrivalRadius(radiusMeters: number): number {
  return Math.max(25, Math.min(2000, Math.round(radiusMeters)));
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

function resolveRouteDestinationCoordinatesFromDraft(
  draft: Pick<SessionDraft, 'routeLatitude' | 'routeLongitude' | 'routeUrl'>,
): { lat: number; lon: number } | null {
  const latitude = parseCoordinate(draft.routeLatitude);
  const longitude = parseCoordinate(draft.routeLongitude);

  if (latitude !== null && longitude !== null) {
    return {
      lat: latitude,
      lon: longitude,
    };
  }

  if (draft.routeLatitude.trim() || draft.routeLongitude.trim()) {
    return null;
  }

  return extractCoordinatesFromNavigationUrl(draft.routeUrl);
}

function resolveRoutePlanDestination(
  routePlan: Pick<SessionRoutePlan, 'destinationLat' | 'destinationLon'> | null | undefined,
): { lat: number; lon: number } | null {
  if (routePlan?.destinationLat == null || routePlan.destinationLon == null) {
    return null;
  }

  return {
    lat: routePlan.destinationLat,
    lon: routePlan.destinationLon,
  };
}

function formatDistanceLabel(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
}

function calculateDistanceMeters(
  from: Pick<GpsCoordinates, 'lat' | 'lon'>,
  to: { lat: number; lon: number },
): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const fromLat = (from.lat * Math.PI) / 180;
  const toLat = (to.lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(fromLat) * Math.cos(toLat);

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(a));
}

function buildSessionDraft(overrides?: Partial<SessionDraft>): SessionDraft {
  const now = new Date();
  return {
    name: overrides?.name ?? `Salida ${format(now, 'yyyy-MM-dd', { locale: es })}`,
    projectName: overrides?.projectName ?? '',
    region: overrides?.region ?? '',
    notes: overrides?.notes ?? '',
    equipmentPreset: overrides?.equipmentPreset ?? 'Zoom H6 · XY',
    routeUrl: overrides?.routeUrl ?? '',
    routeDestinationLabel: overrides?.routeDestinationLabel ?? '',
    routeLatitude: overrides?.routeLatitude ?? '',
    routeLongitude: overrides?.routeLongitude ?? '',
    routeArrivalRadiusMeters: overrides?.routeArrivalRadiusMeters ?? '',
    armCaptureOnArrival: overrides?.armCaptureOnArrival ?? false,
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
    blob: take.blob instanceof Blob ? take.blob : buildPlaceholderAudioBlob(take.mimeType),
    durationSeconds: take.durationSeconds ?? null,
    sampleRateHz: take.sampleRateHz ?? null,
    bitDepth: take.bitDepth ?? null,
    channels: take.channels ?? null,
    inputSetup: take.inputSetup ?? '',
    lowCutEnabled: take.lowCutEnabled ?? null,
    limiterEnabled: take.limiterEnabled ?? null,
    phantomPowerEnabled: take.phantomPowerEnabled ?? null,
    takeNotes: take.takeNotes ?? '',
    cloudPath: take.cloudPath ?? null,
    cloudUrl: take.cloudUrl ?? null,
    cloudSyncedAt: take.cloudSyncedAt ?? null,
  };
}

function normalizeRoutePlan(routePlan: SessionRoutePlan | null | undefined): SessionRoutePlan | null {
  if (!routePlan) {
    return null;
  }

  return {
    navigationUrl: normalizeNavigationUrl(routePlan.navigationUrl) ?? '',
    destinationLabel: routePlan.destinationLabel ?? '',
    destinationLat: routePlan.destinationLat ?? null,
    destinationLon: routePlan.destinationLon ?? null,
    arrivalRadiusMeters: clampArrivalRadius(routePlan.arrivalRadiusMeters || DEFAULT_ROUTE_ARRIVAL_RADIUS_METERS),
    activateCaptureOnArrival: Boolean(routePlan.activateCaptureOnArrival),
    arrivalDetectedAt: routePlan.arrivalDetectedAt ?? null,
  };
}

function validateSessionRouteDraft(draft: SessionDraft): string | null {
  if (draft.routeUrl.trim() && !normalizeNavigationUrl(draft.routeUrl)) {
    return 'El enlace de navegación no es válido. Usa una URL completa de Google Maps.';
  }

  if ((draft.routeLatitude.trim() || draft.routeLongitude.trim()) && !resolveRouteDestinationCoordinatesFromDraft(draft)) {
    return 'Las coordenadas del destino no son válidas. Completa latitud y longitud o deja ambas vacías.';
  }

  if (draft.routeArrivalRadiusMeters.trim() && !parseArrivalRadius(draft.routeArrivalRadiusMeters)) {
    return 'El radio de llegada debe ser un número positivo en metros.';
  }

  if (draft.armCaptureOnArrival && !resolveRouteDestinationCoordinatesFromDraft(draft)) {
    return 'Para activar al llegar necesito coordenadas del destino. Los enlaces cortos de Maps no siempre las incluyen.';
  }

  return null;
}

function buildRoutePlanFromDraft(draft: SessionDraft): SessionRoutePlan | null {
  const normalizedUrl = normalizeNavigationUrl(draft.routeUrl) ?? '';
  const destinationCoordinates = resolveRouteDestinationCoordinatesFromDraft(draft);
  const routeArrivalRadius =
    parseArrivalRadius(draft.routeArrivalRadiusMeters) ?? DEFAULT_ROUTE_ARRIVAL_RADIUS_METERS;
  const hasRouteData =
    Boolean(normalizedUrl) ||
    Boolean(draft.routeDestinationLabel.trim()) ||
    Boolean(destinationCoordinates) ||
    draft.armCaptureOnArrival;

  if (!hasRouteData) {
    return null;
  }

  return {
    navigationUrl: normalizedUrl,
    destinationLabel: draft.routeDestinationLabel.trim(),
    destinationLat: destinationCoordinates?.lat ?? null,
    destinationLon: destinationCoordinates?.lon ?? null,
    arrivalRadiusMeters: clampArrivalRadius(routeArrivalRadius),
    activateCaptureOnArrival: draft.armCaptureOnArrival,
    arrivalDetectedAt: null,
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
    routePlan: normalizeRoutePlan(session.routePlan),
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
  return remoteSource ? buildStorageProxyUrl(remoteSource) : null;
}

function buildPlaceholderPhotoBlob(mimeType: string): Blob {
  return new Blob([], { type: mimeType || 'application/octet-stream' });
}

function buildPlaceholderAudioBlob(mimeType: string): Blob {
  return new Blob([], { type: mimeType || 'audio/wav' });
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
  const existingAudioTakes = new Map((existingSession?.audioTakes ?? []).map((take) => [take.id, take]));

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
    audioTakes: session.audioTakes.map((take) => {
      const existingTake = existingAudioTakes.get(take.id);

      return {
        ...take,
        blob:
          existingTake?.blob && existingTake.blob.size > 0
            ? existingTake.blob
            : buildPlaceholderAudioBlob(take.mimeType),
      };
    }),
  });

  return {
    ...normalizedSession,
    audioTakes: normalizedSession.audioTakes.map((take) => {
      const existingTake = existingAudioTakes.get(take.id);

      return {
        ...take,
        blob:
          existingTake?.blob && existingTake.blob.size > 0
            ? existingTake.blob
            : take.blob,
      };
    }),
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
    audioTakes: currentUiSession.audioTakes.map((take) => {
      const syncedTake = cloudSession.audioTakes.find((entry) => entry.id === take.id);
      if (!syncedTake) {
        return take;
      }

      return {
        ...take,
        cloudPath: syncedTake.cloudPath ?? null,
        cloudUrl: syncedTake.cloudUrl ?? null,
        cloudSyncedAt: syncedTake.cloudSyncedAt ?? null,
      };
    }),
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

function isSameLocalCalendarDay(left: Date | string | number, right: Date | string | number): boolean {
  const leftDate = new Date(left);
  const rightDate = new Date(right);

  return (
    leftDate.getFullYear() === rightDate.getFullYear()
    && leftDate.getMonth() === rightDate.getMonth()
    && leftDate.getDate() === rightDate.getDate()
  );
}

function findLatestSpilloverPointCreatedAt(
  session: Pick<UiFieldSession, 'startedAt' | 'points'>,
): string | null {
  const spilloverPoints = session.points
    .filter((point) => !isSameLocalCalendarDay(point.createdAt, session.startedAt))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  return spilloverPoints[0]?.createdAt ?? null;
}

function findLatestProjectName(sessions: UiFieldSession[]): string {
  return [...sessions]
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
    .find((session) => session.projectName.trim())?.projectName.trim() ?? '';
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
  priority = false,
  minimal = false,
}: {
  active: boolean;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  compact?: boolean;
  priority?: boolean;
  minimal?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={compact || minimal ? `${label}. ${description}` : undefined}
      className={`dock-button ${active ? 'is-active' : ''} ${compact ? 'is-compact' : ''} ${priority ? 'is-priority' : ''} ${minimal ? 'is-minimal' : ''}`}
    >
      <span className="dock-button__icon" aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <span className="dock-button__text">
        <span className="dock-button__label">{label}</span>
        {!compact && !minimal ? <span className="dock-button__description">{description}</span> : null}
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
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.button
      type="button"
      onClick={onClick}
      {...getProminentInteractiveMotion(prefersReducedMotion)}
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

function AppNavigationPanels({
  titleId,
  activeView,
  navigationItems,
  onNavigate,
}: {
  titleId: string;
  activeView: View;
  navigationItems: NavigationItem[];
  onNavigate?: () => void;
}) {
  return (
    <section className="panel sidebar-nav-panel" aria-labelledby={titleId}>
      <div className="sidebar-brand">
        <p className="eyebrow sidebar-brand__eyebrow">FieldNotes AI</p>
        <h2 id={titleId} className="sidebar-brand__title">
          Campo
        </h2>
      </div>
      <nav className="sidebar-nav" aria-label="Navegación principal">
        <ul className="sidebar-nav__list">
          {navigationItems.map((item) => (
            <li key={item.view} className="sidebar-nav__item">
              <ViewButton
                active={activeView === item.view}
                label={item.label}
                description={item.description}
                icon={item.icon}
                minimal
                onClick={() => {
                  item.onClick();
                  onNavigate?.();
                }}
              />
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}

function ShellHeader({
  currentViewLabel,
  supportText,
  isSunMode,
  onToggleDisplayMode,
  isDrawerOpen,
  onOpenDrawer,
  menuButtonRef,
}: {
  currentViewLabel: string;
  supportText: string;
  isSunMode: boolean;
  onToggleDisplayMode: () => void;
  isDrawerOpen: boolean;
  onOpenDrawer: () => void;
  menuButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Card as="header" variant="panel" border="subtle" className="fieldnotes-shell-header" aria-label="Cabecera de aplicación">
      <div className="fieldnotes-shell-header__leading">
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button fieldnotes-shell-header__menu-button"
          aria-label="Abrir navegación"
          aria-haspopup="dialog"
          aria-expanded={isDrawerOpen}
          aria-controls="fieldnotes-tablet-drawer"
          onClick={onOpenDrawer}
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="fieldnotes-shell-header__copy">
          <p className="eyebrow fieldnotes-shell-header__eyebrow">FieldNotes AI</p>
          <p className="fieldnotes-shell-header__title">Campo</p>
          <div className="fieldnotes-shell-header__context">
            <Badge variant="muted">{currentViewLabel}</Badge>
            <p className="fieldnotes-shell-header__support">{supportText}</p>
          </div>
        </div>
      </div>

      <div className="fieldnotes-shell-header__actions">
        <button
          type="button"
          onClick={onToggleDisplayMode}
          className={`mode-toggle ${isSunMode ? 'is-sun' : ''}`}
          aria-label={isSunMode ? 'Activar modo noche' : 'Activar modo sol'}
        >
          <span className="mode-toggle__icon">
            {isSunMode ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
          </span>
          {isSunMode ? 'Modo noche' : 'Modo sol'}
        </button>
      </div>
    </Card>
  );
}

export default function App() {
  const prefersReducedMotion = useReducedMotion();
  const [view, setView] = useState<View>('home');
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth());
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(buildSessionDraft());
  const [pointDraft, setPointDraft] = useState<PointDraft>(buildPointDraft());
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([]);
  const [dashboardQuery, setDashboardQuery] = useState('');
  const [sessions, setSessions] = useState<UiFieldSession[]>([]);
  const [selectedArchiveProjectKey, setSelectedArchiveProjectKey] = useState<'all' | string>('all');
  const [projectDraftName, setProjectDraftName] = useState('');
  const [sessionSupportTab, setSessionSupportTab] = useState<SessionSupportTab>('browser');
  const [captureWorkspace, setCaptureWorkspace] = useState<'map' | 'points'>('map');
  const [captureSupportTab, setCaptureSupportTab] = useState<CaptureSupportTab>('map');
  const [archiveWorkspace, setArchiveWorkspace] = useState<'session' | 'media' | 'record'>('session');
  const [homeMediaFilter, setHomeMediaFilter] = useState<HomeMediaFilter>('all');
  const [homeSecondaryTab, setHomeSecondaryTab] = useState<HomeSecondaryTab>('work');
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isArchiveBrowserOpen, setIsArchiveBrowserOpen] = useState(false);
  const [preferredProjectName, setPreferredProjectName] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    try {
      return window.localStorage.getItem(PREFERRED_PROJECT_NAME_STORAGE_KEY)?.trim() ?? '';
    } catch {
      return '';
    }
  });
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
  const [statusTone, setStatusTone] = useState<StatusTone>('info');
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
  const [isSplittingSessionId, setIsSplittingSessionId] = useState<string | null>(null);
  const [catalogApiStatus, setCatalogApiStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [zoomImportTargetSessionId, setZoomImportTargetSessionId] = useState<string | null>(null);
  const [publishPhotoId, setPublishPhotoId] = useState<string>('');
  const [publishAudioTakeId, setPublishAudioTakeId] = useState<string>('');
  const [publishCaption, setPublishCaption] = useState('');
  const [publishedSelectionsForPoint, setPublishedSelectionsForPoint] = useState<PublishedSelection[]>([]);
  const [isPublishingSelection, setIsPublishingSelection] = useState(false);

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
  const mainContentRef = useRef<HTMLElement | null>(null);
  const drawerPanelRef = useRef<HTMLElement | null>(null);
  const drawerMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasNavDrawerOpenRef = useRef(false);
  const archiveDrawerPanelRef = useRef<HTMLElement | null>(null);
  const archiveDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const archiveDrawerCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasArchiveBrowserOpenRef = useRef(false);

  function announceStatus(message: string, tone: StatusTone = 'info') {
    setStatusNote(message);
    setStatusTone(tone);
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const isActiveSessionFromAnotherDay = activeSession ? !isSameLocalCalendarDay(activeSession.startedAt, now) : false;
  const activeSessionLatestSpilloverPointAt = activeSession ? findLatestSpilloverPointCreatedAt(activeSession) : null;
  const activeSessionLatestSpilloverPointCount =
    activeSession && activeSessionLatestSpilloverPointAt
      ? activeSession.points.filter((point) => isSameLocalCalendarDay(point.createdAt, activeSessionLatestSpilloverPointAt)).length
      : 0;
  const activeSessionDateWarning = activeSession
    ? activeSessionLatestSpilloverPointAt
      ? `Esta salida se abrió el ${formatDateTime(activeSession.startedAt, "d MMM yyyy")} y contiene ${activeSessionLatestSpilloverPointCount} registro${activeSessionLatestSpilloverPointCount === 1 ? '' : 's'} del ${formatDateTime(activeSessionLatestSpilloverPointAt, "d MMM yyyy")}. Sepáralos en una salida nueva antes de seguir.`
      : isActiveSessionFromAnotherDay
        ? `Esta salida sigue abierta desde el ${formatDateTime(activeSession.startedAt, "d MMM yyyy")}. Si hoy es otra salida, ciérrala y abre una nueva antes de registrar.`
        : null
    : null;
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
  const sessionDraftRouteCoordinates = resolveRouteDestinationCoordinatesFromDraft(sessionDraft);
  const sessionDraftRouteHasShortMapsUrl = isShortGoogleMapsUrl(sessionDraft.routeUrl);
  const sessionDraftRouteRadius =
    parseArrivalRadius(sessionDraft.routeArrivalRadiusMeters) ?? DEFAULT_ROUTE_ARRIVAL_RADIUS_METERS;
  const knownProjectNames = Array.from(
    new Set(
      sessions
        .map((session) => session.projectName.trim())
        .filter(Boolean),
    ),
  ).sort((left: string, right: string) => left.localeCompare(right, 'es'));
  const latestKnownProjectName = findLatestProjectName(sessions);
  const visibleArchiveProjectGroups =
    selectedArchiveProjectKey === 'all'
      ? archiveProjectGroups
      : archiveProjectGroups.filter((group) => group.key === selectedArchiveProjectKey);
  const activeRoutePlan = activeSession?.routePlan ?? null;
  const activeRouteDestination = resolveRoutePlanDestination(activeRoutePlan);
  const activeRouteDestinationLabel =
    activeRoutePlan?.destinationLabel.trim() || activeSession?.region.trim() || 'Destino programado';
  const activeRouteDistanceMeters =
    currentGps && activeRouteDestination ? calculateDistanceMeters(currentGps, activeRouteDestination) : null;
  const isWithinActiveRouteArrivalRadius =
    Boolean(
      activeRoutePlan &&
      currentGps &&
      activeRouteDestination &&
      activeRouteDistanceMeters != null &&
      activeRouteDistanceMeters <= activeRoutePlan.arrivalRadiusMeters,
    );

  function rememberPreferredProjectName(projectName: string) {
    const trimmedProjectName = projectName.trim();
    setPreferredProjectName(trimmedProjectName);

    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (trimmedProjectName) {
        window.localStorage.setItem(PREFERRED_PROJECT_NAME_STORAGE_KEY, trimmedProjectName);
      } else {
        window.localStorage.removeItem(PREFERRED_PROJECT_NAME_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures and keep the current in-memory preference.
    }
  }

  function buildNextSessionDraft(sourceSession?: Pick<UiFieldSession, 'projectName' | 'region' | 'equipmentPreset'> | null) {
    return buildSessionDraft({
      projectName: sourceSession?.projectName.trim() || preferredProjectName,
      region: sourceSession?.region.trim() || '',
      equipmentPreset: sourceSession?.equipmentPreset.trim() || 'Zoom H6 · XY',
    });
  }

  function buildFollowUpSession(previousSession: Pick<UiFieldSession, 'projectName' | 'region' | 'equipmentPreset'>, createdAt: string): UiFieldSession {
    return {
      id: uuidv4(),
      name: `Salida ${formatDateTime(createdAt, 'yyyy-MM-dd')}`,
      projectName: previousSession.projectName.trim(),
      region: previousSession.region.trim(),
      notes: '',
      createdAt,
      startedAt: createdAt,
      status: 'active',
      equipmentPreset: previousSession.equipmentPreset.trim() || 'Zoom H6 · XY',
      points: [],
      audioTakes: [],
    };
  }

  function openNavigationRoute(routePlan: SessionRoutePlan) {
    if (!routePlan.navigationUrl) {
      setAppError('Esta salida no tiene un enlace de navegación guardado.');
      return;
    }

    setAppError(null);
    const openedWindow = window.open(routePlan.navigationUrl, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.assign(routePlan.navigationUrl);
    }
    announceStatus('Ruta abierta en navegación.', 'info');
  }

  async function applyCurrentGpsToRouteDestination() {
    setAppError(null);

    const nextLocation = currentGpsRef.current ?? (await requestCurrentLocation());
    if (!nextLocation) {
      setAppError('No pude usar la ubicación actual para fijar el destino.');
      return;
    }

    setSessionDraft((previous) => ({
      ...previous,
      routeLatitude: nextLocation.lat.toFixed(6),
      routeLongitude: nextLocation.lon.toFixed(6),
    }));
    announceStatus('Destino actualizado con la ubicación actual.', 'success');
  }

  function prepareCaptureForRoutePlan(routePlan: SessionRoutePlan) {
    const destination = resolveRoutePlanDestination(routePlan);
    const destinationLabel = routePlan.destinationLabel.trim();

    setPointDraft((previous) => ({
      ...previous,
      placeName: shouldOverwritePointPlaceName(previous.placeName) && destinationLabel
        ? destinationLabel
        : previous.placeName,
      latitude: destination ? destination.lat.toFixed(6) : previous.latitude,
      longitude: destination ? destination.lon.toFixed(6) : previous.longitude,
      coordinateSource: destination ? 'manual' : previous.coordinateSource,
    }));

    setView('point');
    setAppError(null);
    announceStatus(
      destinationLabel
        ? `Captura preparada para ${destinationLabel}.`
        : 'Captura preparada con el destino programado.',
      'success',
    );
  }

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
    setIsNavDrawerOpen(false);
    setIsArchiveBrowserOpen(false);
  }, [view]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleResize = () => {
      const nextWidth = window.innerWidth;
      setViewportWidth(nextWidth);

      if (nextWidth < 760 || nextWidth >= 960) {
        setIsNavDrawerOpen(false);
      }

       if (nextWidth >= 1120) {
        setIsArchiveBrowserOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined' || (!isNavDrawerOpen && !isArchiveBrowserOpen)) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isArchiveBrowserOpen, isNavDrawerOpen]);

  useEffect(() => {
    if (!isNavDrawerOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNavDrawerOpen(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const drawer = drawerPanelRef.current;
      if (!drawer) {
        return;
      }

      const focusableElements = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (focusableElements.length === 0) {
        return;
      }

      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isNavDrawerOpen]);

  useEffect(() => {
    if (isNavDrawerOpen) {
      drawerCloseButtonRef.current?.focus();
    } else if (wasNavDrawerOpenRef.current) {
      drawerMenuButtonRef.current?.focus();
    }

    wasNavDrawerOpenRef.current = isNavDrawerOpen;
  }, [isNavDrawerOpen]);

  useEffect(() => {
    if (!isArchiveBrowserOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsArchiveBrowserOpen(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const drawer = archiveDrawerPanelRef.current;
      if (!drawer) {
        return;
      }

      const focusableElements = drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (focusableElements.length === 0) {
        return;
      }

      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isArchiveBrowserOpen]);

  useEffect(() => {
    if (isArchiveBrowserOpen) {
      archiveDrawerCloseButtonRef.current?.focus();
    } else if (wasArchiveBrowserOpenRef.current) {
      archiveDrawerTriggerRef.current?.focus();
    }

    wasArchiveBrowserOpenRef.current = isArchiveBrowserOpen;
  }, [isArchiveBrowserOpen]);

  useEffect(() => {
    if (selectedArchiveProjectKey === 'all') {
      return;
    }

    if (!archiveProjectGroups.some((group) => group.key === selectedArchiveProjectKey)) {
      setSelectedArchiveProjectKey('all');
    }
  }, [archiveProjectGroups, selectedArchiveProjectKey]);

  useEffect(() => {
    if (preferredProjectName || !latestKnownProjectName) {
      return;
    }

    rememberPreferredProjectName(latestKnownProjectName);
  }, [latestKnownProjectName, preferredProjectName]);

  useEffect(() => {
    if (activeSession || sessionDraft.projectName.trim() || !preferredProjectName) {
      return;
    }

    setSessionDraft((previous) =>
      previous.projectName.trim()
        ? previous
        : {
            ...previous,
            projectName: preferredProjectName,
          },
    );
  }, [activeSession, preferredProjectName, sessionDraft.projectName]);

  useEffect(() => {
    if (!recordSession) {
      setArchiveWorkspace('session');
      return;
    }

    if (!recordPoint && archiveWorkspace === 'record') {
      setArchiveWorkspace('session');
    }
  }, [archiveWorkspace, recordPoint, recordSession]);

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
      announceStatus('Conexión recuperada. Reintentando sincronizar lugar y clima pendientes.', 'success');
    };

    const handleOffline = () => {
      setIsOnline(false);
      announceStatus('Modo offline activo. Los puntos se guardarán y se enriquecerán al volver la conexión.', 'warning');
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
        announceStatus('No se pudo abrir el archivo local. La salida actual quedará sólo en memoria.', 'warning');
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
    if (!activeSession || !activeRoutePlan?.activateCaptureOnArrival) {
      return;
    }

    if (activeRoutePlan.arrivalDetectedAt || !activeRouteDestination || !isWithinActiveRouteArrivalRadius) {
      return;
    }

    const nextSession: UiFieldSession = {
      ...activeSession,
      routePlan: {
        ...activeRoutePlan,
        arrivalDetectedAt: new Date().toISOString(),
      },
    };

    void persistSession(nextSession);
    announceStatus(`Llegada detectada cerca de ${activeRouteDestinationLabel}. La captura ya puede activarse.`, 'success');
  }, [
    activeRouteDestination,
    activeRouteDestinationLabel,
    activeRoutePlan,
    activeSession,
    isWithinActiveRouteArrivalRadius,
  ]);

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
      announceStatus('Falló la escritura local. La salida seguirá en memoria hasta recargar.', 'warning');
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
      const { reverseGeocodePlace } = await loadLocationLookupLib();
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
      const { fetchAutomaticWeather } = await loadWeatherLib();
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
      const { captureSoundscapeClassification } = await loadSoundscapeClassificationLib();
      const classification = await captureSoundscapeClassification({ durationMs: 15_000 });
      setDraftSoundscapeClassification(classification);
      setSoundscapeStatus('ready');
      setSoundscapeMessage(classification.details);
      announceStatus(`Detección acústica lista: ${classification.summary}.`, 'success');
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
    const routeValidationError = validateSessionRouteDraft(sessionDraft);
    if (routeValidationError) {
      setAppError(routeValidationError);
      return;
    }

    const createdAt = new Date().toISOString();
    const routePlan = buildRoutePlanFromDraft(sessionDraft);
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
      routePlan,
    };

    rememberPreferredProjectName(nextSession.projectName);
    setActiveSessionId(nextSession.id);
    setSelectedPointId(null);
    setAppError(null);
    void persistSession(nextSession);
    setPointDraft(buildPointDraft(nextSession.equipmentPreset, currentGpsRef.current));
    setSessionDraft(buildNextSessionDraft(nextSession));
    announceStatus(
      routePlan?.navigationUrl
        ? 'Salida iniciada con ruta programada. La captura quedará lista al llegar.'
        : 'Salida iniciada. Empieza a registrar puntos de escucha.',
      'success',
    );
    setView(routePlan ? 'session' : 'point');
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
    rememberPreferredProjectName(nextSession.projectName);
    setActiveSessionId(null);
    resetPointDraft(nextSession.equipmentPreset);
    announceStatus(`Salida "${nextSession.name}" cerrada y lista para exportación.`, 'success');
    setView('export');
  }

  async function closeActiveSessionAndPrepareNext() {
    if (!activeSession) {
      return;
    }

    const nextSession: UiFieldSession = {
      ...activeSession,
      status: 'closed',
      endedAt: new Date().toISOString(),
    };

    await persistSession(nextSession);
    rememberPreferredProjectName(nextSession.projectName);
    setActiveSessionId(null);
    setSelectedPointId(null);
    setSessionDraft(buildNextSessionDraft(nextSession));
    resetPointDraft(nextSession.equipmentPreset);
    announceStatus(`Salida "${nextSession.name}" cerrada. Nueva salida preparada dentro del mismo trabajo.`, 'success');
    setView('session');
  }

  async function ensureSessionForCurrentOuting(session: UiFieldSession): Promise<UiFieldSession> {
    if (isSameLocalCalendarDay(session.startedAt, Date.now())) {
      return session;
    }

    const closedSession: UiFieldSession = {
      ...session,
      status: 'closed',
      endedAt: new Date().toISOString(),
    };
    const nextSessionCreatedAt = new Date().toISOString();
    const nextSession = buildFollowUpSession(closedSession, nextSessionCreatedAt);

    await persistSession(closedSession);
    await persistSession(nextSession);

    rememberPreferredProjectName(nextSession.projectName);
    setActiveSessionId(nextSession.id);
    setSelectedPointId(null);
    setSessionDraft(buildNextSessionDraft(nextSession));
    announceStatus(
      `La salida anterior (${formatDateTime(closedSession.startedAt, "d MMM")}) se cerró automáticamente. Estás registrando en una salida nueva de hoy.`,
      'warning',
    );

    return nextSession;
  }

  async function splitSessionRecordsFromLatestSpilloverDay(sessionId: string) {
    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      return;
    }

    const spilloverPointAt = findLatestSpilloverPointCreatedAt(session);
    if (!spilloverPointAt) {
      announceStatus('Esta salida no tiene registros mezclados de otro día.');
      return;
    }

    const movedPoints = session.points.filter((point) => isSameLocalCalendarDay(point.createdAt, spilloverPointAt));
    if (movedPoints.length === 0) {
      announceStatus('No encontré registros válidos para separar.', 'warning');
      return;
    }

    const movedPointIds = new Set(movedPoints.map((point) => point.id));
    const movedAudioTakes = session.audioTakes.filter(
      (take) =>
        (take.associatedPointId && movedPointIds.has(take.associatedPointId))
        || (!take.associatedPointId && isSameLocalCalendarDay(take.inferredRecordedAt, spilloverPointAt)),
    );
    const movedAudioTakeIds = new Set(movedAudioTakes.map((take) => take.id));
    const remainingPoints = session.points.filter((point) => !movedPointIds.has(point.id));
    const remainingAudioTakes = session.audioTakes.filter((take) => !movedAudioTakeIds.has(take.id));

    const activityTimestamps = [
      ...movedPoints.map((point) => new Date(point.createdAt).getTime()),
      ...movedAudioTakes
        .map((take) => new Date(take.inferredRecordedAt).getTime())
        .filter((timestamp) => Number.isFinite(timestamp)),
    ].sort((left, right) => left - right);
    const nextSessionCreatedAt =
      activityTimestamps.length > 0 ? new Date(activityTimestamps[0]).toISOString() : spilloverPointAt;
    const latestMovedActivityAt =
      activityTimestamps.length > 0
        ? new Date(activityTimestamps[activityTimestamps.length - 1]).toISOString()
        : spilloverPointAt;
    const hasAnotherActiveSession = sessionsRef.current.some(
      (entry) => entry.id !== session.id && entry.status === 'active',
    );
    const shouldActivateRecoveredSession = isSameLocalCalendarDay(spilloverPointAt, Date.now()) && !hasAnotherActiveSession;
    const recoveredSessionBase = buildFollowUpSession(session, nextSessionCreatedAt);
    const recoveredSession: UiFieldSession = {
      ...recoveredSessionBase,
      status: shouldActivateRecoveredSession ? 'active' : 'closed',
      endedAt: shouldActivateRecoveredSession ? undefined : latestMovedActivityAt,
      points: movedPoints,
      audioTakes: reconcileSessionAudioTakes(movedPoints, movedAudioTakes),
    };
    const repairedSourceSession: UiFieldSession = {
      ...session,
      status: session.status === 'active' ? 'closed' : session.status,
      endedAt: session.status === 'active' ? new Date().toISOString() : session.endedAt,
      points: remainingPoints,
      audioTakes: reconcileSessionAudioTakes(remainingPoints, remainingAudioTakes),
    };

    setIsSplittingSessionId(sessionId);
    setAppError(null);

    try {
      await persistSession(repairedSourceSession);
      await persistSession(recoveredSession);

      rememberPreferredProjectName(recoveredSession.projectName);
      setSelectedArchiveProjectKey(buildProjectKey(recoveredSession.projectName));

      if (activeSessionId === session.id) {
        if (shouldActivateRecoveredSession) {
          setActiveSessionId(recoveredSession.id);
          setSelectedPointId(recoveredSession.points[0]?.id ?? null);
          setView('session');
        } else {
          setActiveSessionId(null);
          setSelectedPointId(null);
          setView('export');
        }
      }

      if (recordSessionId === session.id) {
        setRecordSessionId(recoveredSession.id);
        setRecordPointId(recoveredSession.points[0]?.id ?? null);
        setArchiveWorkspace('session');
      }

      announceStatus(
        `Separados ${movedPoints.length} registro${movedPoints.length === 1 ? '' : 's'} del ${formatDateTime(spilloverPointAt, "d MMM yyyy")} en una salida nueva.`,
        'success',
      );
    } catch (error) {
      console.error('Split session by day failed:', error);
      setAppError('No pude separar los registros del día mezclado.');
    } finally {
      setIsSplittingSessionId(null);
    }
  }

  async function addPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una salida activa antes de registrar puntos.');
      return;
    }

    const sessionForCapture = await ensureSessionForCurrentOuting(activeSession);

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
    const nextPoints = [point, ...sessionForCapture.points];

    const nextSession: UiFieldSession = {
      ...sessionForCapture,
      points: nextPoints,
      audioTakes: reconcileSessionAudioTakes(nextPoints, sessionForCapture.audioTakes),
    };

    await persistSession(nextSession);
    setSelectedPointId(point.id);
    setRecordSessionId(sessionForCapture.id);
    setRecordPointId(point.id);
    setAppError(null);
    announceStatus(`Punto "${point.placeName}" guardado dentro de la salida.`, 'success');
    resetPointDraft(sessionForCapture.equipmentPreset);
  }

  async function addQuickPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una salida activa antes de registrar un punto rápido.');
      return;
    }

    const sessionForCapture = await ensureSessionForCurrentOuting(activeSession);

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
      const nextPoints = [point, ...sessionForCapture.points];

      const nextSession: UiFieldSession = {
        ...sessionForCapture,
        points: nextPoints,
        audioTakes: reconcileSessionAudioTakes(nextPoints, sessionForCapture.audioTakes),
      };

      await persistSession(nextSession);
      setSelectedPointId(point.id);
      setRecordSessionId(sessionForCapture.id);
      setRecordPointId(point.id);
      announceStatus(`Punto rápido "${point.placeName}" creado con GPS, fecha, hora y clima.`, 'success');
      resetPointDraft(sessionForCapture.equipmentPreset);
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
    announceStatus('Punto eliminado de la salida activa.');
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

      if (buildProjectKey(preferredProjectName) === projectKey) {
        rememberPreferredProjectName(nextProjectName);
      }

      setSelectedArchiveProjectKey(nextProjectName.trim() ? buildProjectKey(nextProjectName) : 'all');
      announceStatus(statusMessage, 'success');
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
      announceStatus('El trabajo ya tiene ese nombre.');
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
      const { exportFieldSessionPackage } = await loadExportFieldSessionLib();
      const exportSummary = await exportFieldSessionPackage(dehydrateSession(session));
      if (exportSummary.missingAudioCount > 0) {
        announceStatus(
          `Salida "${session.name}" exportada con ${exportSummary.exportedAudioCount}/${session.audioTakes.length} audios. Faltan ${exportSummary.missingAudioCount}; revisa takes/missing-audio.txt y reimporta la carpeta H6 si hace falta.`,
          'warning',
        );
      } else {
        announceStatus(`Salida "${session.name}" exportada.`, 'success');
      }
    } catch (error) {
      console.error('Export session failed:', error);
      setAppError('No se pudo exportar la salida.');
    } finally {
      setIsExportingSessionId(null);
    }
  }

  async function exportSelectedRecordCsv() {
    if (!recordSession || !recordPoint) {
      return;
    }

    try {
      const { exportSessionPointCsv } = await loadExportFieldSessionLib();
      exportSessionPointCsv(recordSession, recordPoint);
      announceStatus(`CSV exportado para "${recordPoint.placeName}".`, 'success');
    } catch (error) {
      console.error('Export record CSV failed:', error);
      setAppError('No se pudo exportar el registro en CSV.');
    }
  }

  async function exportSelectedRecordKml() {
    if (!recordSession || !recordPoint) {
      return;
    }

    try {
      const { exportSessionPointKml } = await loadExportFieldSessionLib();
      exportSessionPointKml(recordSession, recordPoint);
      announceStatus(`KML exportado para "${recordPoint.placeName}".`, 'success');
    } catch (error) {
      console.error('Export record KML failed:', error);
      setAppError('No se pudo exportar el registro en KML.');
    }
  }

  async function publishCurrentSelection() {
    if (!recordSession || !recordPoint) {
      return;
    }

    if (!isOnline) {
      setAppError('Necesitas conexión para publicar una selección web.');
      return;
    }

    const photo = recordPoint.photos.find((entry) => entry.id === publishPhotoId) ?? null;
    const audioTake =
      recordSession.audioTakes.find((entry) => entry.id === publishAudioTakeId && entry.associatedPointId === recordPoint.id) ??
      null;

    if (!photo) {
      setAppError('Selecciona una imagen para publicar.');
      return;
    }

    if (!audioTake) {
      setAppError('Selecciona una toma H6 asociada al punto para publicar.');
      return;
    }

    setIsPublishingSelection(true);
    setAppError(null);

    try {
      const { publishSelection, syncSelectionToCloud } = await Promise.all([
        loadPublishedSelectionsLib(),
        loadCloudSyncLib(),
      ]).then(([publishedSelectionsLib, cloudSyncLib]) => ({
        publishSelection: publishedSelectionsLib.publishSelection,
        syncSelectionToCloud: cloudSyncLib.syncSelectionToCloud,
      }));
      const syncedSelection = await syncSelectionToCloud(dehydrateSession(recordSession), {
        photoId: photo.id,
        audioTakeId: audioTake.id,
      });
      const nextUiSession = mergeCloudSyncedSessionIntoUi(syncedSelection.session, recordSession);
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });

      const selection = await publishSelection({
        id: buildPublishedSelectionId(recordSession.id, recordPoint.id, photo.id, audioTake.id),
        sessionId: recordSession.id,
        pointId: recordPoint.id,
        photoId: photo.id,
        audioTakeId: audioTake.id,
        caption: publishCaption.trim() || buildSelectionCaption(recordSession, recordPoint),
        project: resolveProjectName(recordSession.projectName),
        session: recordSession.name,
        point: recordPoint.placeName,
        imageUrl: syncedSelection.imageUrl,
        audioUrl: syncedSelection.audioUrl,
        imageFileName: photo.fileName,
        audioFileName: audioTake.fileName,
        pointCapturedAt: recordPoint.createdAt,
        latitude: recordPoint.gps.lat,
        longitude: recordPoint.gps.lon,
        weather: recordPoint.observedWeather || recordPoint.automaticWeather?.summary || '',
        placeContext: recordPoint.detectedPlace?.context || '',
        tags: [...recordPoint.tags, ...(recordPoint.soundscapeClassification?.tags ?? [])],
        notes: recordPoint.notes,
        habitat: recordPoint.habitat,
        characteristics: recordPoint.characteristics,
        microphoneSetup: recordPoint.microphoneSetup,
        zoomTakeReference: recordPoint.zoomTakeReference || audioTake.detectedTakeReference || '',
      });

      setPublishedSelectionsForPoint((current) => [selection, ...current.filter((entry) => entry.id !== selection.id)]);
      announceStatus(`Selección web publicada para "${recordPoint.placeName}".`, 'success');
    } catch (error) {
      console.error('Publish selection failed:', error);
      setAppError(error instanceof Error ? error.message : 'No se pudo publicar la selección web.');
    } finally {
      setIsPublishingSelection(false);
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
      const { syncSessionToCloud } = await loadCloudSyncLib();
      const cloudSession = await syncSessionToCloud(dehydrateSession(syncingSession));
      const nextUiSession = mergeCloudSyncedSessionIntoUi(cloudSession, syncingSession);
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      announceStatus(`Salida "${nextUiSession.name}" respaldada en la nube.`, 'success');
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
      const catalogSync = await loadCatalogSyncLib();
      const catalogResult = await catalogSync.syncSessionToCatalog(dehydrateSession(syncingSession));
      setCatalogApiStatus('available');
      const nextUiSession: UiFieldSession = {
        ...syncingSession,
        catalogSyncStatus: 'synced',
        catalogSyncedAt: catalogResult.syncedAt,
        catalogError: null,
      };
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      announceStatus(`Salida "${nextUiSession.name}" sincronizada con el catálogo remoto.`, 'success');
    } catch (error) {
      console.error('Catalog sync failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo sincronizar el catálogo remoto.';
      const catalogSync = await loadCatalogSyncLib();
      if (catalogSync.isCatalogApiUnavailableError(error)) {
        setCatalogApiStatus('unavailable');
        announceStatus('Catálogo remoto desactivado en este entorno. La salida sigue disponible en local y en exportación.', 'warning');
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
      announceStatus('No hay salidas pendientes de respaldo.');
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
      announceStatus('No hay salidas pendientes de catálogo remoto.');
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
      const catalogSync = await loadCatalogSyncLib();
      const summaries = await catalogSync.listCatalogSessionsRemote();
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

        const remoteSession = await catalogSync.fetchCatalogSessionRemote(summary.id);
        const nextSession = buildCatalogSessionForUi(remoteSession, summary, currentSession);
        await persistSession(nextSession, { markCloudPending: false, markCatalogPending: false });
        importedNames.push(nextSession.name);

        if (!sessionsRef.current.some((entry) => entry.status === 'active') && nextSession.status === 'active') {
          setActiveSessionId(nextSession.id);
        }
      }

      if (importedNames.length === 1) {
        announceStatus(`Salida "${importedNames[0]}" actualizada desde el catálogo remoto.`, 'success');
      } else if (importedNames.length > 1) {
        announceStatus(`${importedNames.length} salidas actualizadas desde el catálogo remoto.`, 'success');
      }
    } catch (error) {
      console.error('Remote catalog refresh failed:', error);

      const catalogSync = await loadCatalogSyncLib();
      if (catalogSync.isCatalogApiUnavailableError(error)) {
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
        const { reverseGeocodePlace } = await loadLocationLookupLib();
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
        const { fetchAutomaticWeather } = await loadWeatherLib();
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
        announceStatus('No hay metadatos pendientes por sincronizar.');
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
        announceStatus(
          `Sincronizados ${updatedPoints} puntos pendientes en ${updatedSessions} salida${updatedSessions === 1 ? '' : 's'}.`,
          'success',
        );
      } else if (options?.force) {
        announceStatus('No pude enriquecer los puntos pendientes en este momento.', 'warning');
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
      const { buildImportedAudioTakes } = await loadZoomImportLib();
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
      announceStatus(
        `Importadas ${importedTakes.length} tomas de Zoom H6. ${linkedCount} asociadas, ${unmatchedCount} pendientes.${ignoredCount > 0 ? ` ${ignoredCount} archivos auxiliares ignorados.` : ''}`,
        'success',
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
    setArchiveWorkspace('record');

    if (activeSessionId === sessionId) {
      setSelectedPointId(pointId);
    }

    setView('export');
  }

  function focusArchiveSession(sessionId: string, workspace: 'session' | 'media' = 'session') {
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
    setArchiveWorkspace(workspace);

    if (session.status === 'active') {
      setActiveSessionId(session.id);
      setSelectedPointId(latestPoint?.id ?? null);
    }

    setView('export');
  }

  function focusArchiveProject(projectKey: string) {
    if (projectKey === 'all') {
      setSelectedArchiveProjectKey('all');
      setArchiveWorkspace('session');
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

  function openSessionMediaArchiveFromHome(sessionId: string) {
    focusArchiveSession(sessionId, 'media');
  }

  function openMediaArchiveFromHome() {
    const latestMediaEntry = sessionsRef.current
      .flatMap((session) => [
        ...session.points
          .filter((point) => point.photos.some((photo) => photo.previewUrl))
          .map((point) => ({
            sessionId: session.id,
            createdAt: point.createdAt,
          })),
        ...session.audioTakes.map((take) => ({
          sessionId: session.id,
          createdAt: take.inferredRecordedAt,
        })),
      ])
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

    if (latestMediaEntry) {
      focusArchiveSession(latestMediaEntry.sessionId, 'media');
      return;
    }

    const fallbackSession =
      [...sessionsRef.current].sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0] ??
      null;

    if (fallbackSession) {
      focusArchiveSession(fallbackSession.id, 'media');
      return;
    }

    setView('export');
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
  const activeSessionStartedLabel = activeSession ? formatDateTime(activeSession.startedAt, "d MMM · HH:mm") : null;
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
  const homeOperationalPendingDetail =
    totalOperationalPendingCount > 0
      ? [
          pendingEnrichmentCount > 0 ? 'Metadatos' : null,
          pendingCloudSessionCount > 0 ? 'Nube' : null,
          pendingCatalogSessionCount > 0 ? 'Catálogo' : null,
        ]
          .filter((part): part is string => Boolean(part))
          .join(' · ')
      : 'Sin tareas operativas';
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
  const recentInsightProjectGroups = recentProjectGroups.slice(0, 3);
  const recentNamedProjectGroups = archiveProjectGroups.filter((group) => group.key !== 'sin-trabajo').slice(0, 4);
  const recentSessions = sessions.slice(0, 5);
  const recentPhotoLibraryItems = allRecords
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
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const recentPhotoLibrary = recentPhotoLibraryItems.slice(0, HOME_MEDIA_PREVIEW_LIMIT);
  const recentOverviewPhotos = recentPhotoLibraryItems.slice(0, HOME_MEDIA_OVERVIEW_PHOTO_LIMIT);
  const recentAudioLibraryItems = sessions
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
    .sort((left, right) => new Date(right.inferredRecordedAt).getTime() - new Date(left.inferredRecordedAt).getTime());
  const recentAudioLibrary = recentAudioLibraryItems.slice(0, HOME_AUDIO_PREVIEW_LIMIT);
  const recentOverviewAudio = recentAudioLibraryItems.slice(0, HOME_MEDIA_OVERVIEW_AUDIO_LIMIT);
  const recentMediaLibraryItems = [
    ...recentPhotoLibraryItems.map((photo) => ({
      id: `photo-${photo.id}`,
      kind: 'photo' as const,
      sessionId: photo.sessionId,
      pointId: photo.pointId,
      pointName: photo.pointName,
      sessionName: photo.sessionName,
      previewUrl: photo.previewUrl,
      createdAt: photo.createdAt,
    })),
    ...recentAudioLibraryItems.map((take) => ({
      id: `audio-${take.id}`,
      kind: 'audio' as const,
      sessionId: take.sessionId,
      associatedPointId: take.associatedPointId,
      fileName: take.fileName,
      inferredRecordedAt: take.inferredRecordedAt,
      pointName: take.pointName,
      createdAt: take.inferredRecordedAt,
    })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const visibleArchiveSessions = visibleArchiveProjectGroups
    .flatMap((group) => group.sessions)
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
  const currentArchiveProject =
    selectedArchiveProjectKey === 'all'
      ? null
      : archiveProjectGroups.find((group) => group.key === selectedArchiveProjectKey) ?? null;
  const canManageSelectedProject = Boolean(currentArchiveProject) && currentArchiveProject.key !== 'sin-trabajo';
  const visibleArchiveRecordCount = visibleArchiveSessions.reduce((count, session) => count + session.points.length, 0);
  const visibleArchivePhotoCount = visibleArchiveSessions.reduce(
    (count, session) => count + session.points.reduce((sessionCount, point) => sessionCount + point.photos.length, 0),
    0,
  );
  const visibleArchiveAudioCount = visibleArchiveSessions.reduce((count, session) => count + session.audioTakes.length, 0);
  const visibleArchiveActiveCount = visibleArchiveSessions.filter((session) => session.status === 'active').length;
  const archiveBrowserSummaryItems = [
    {
      label: 'Salidas',
      value: currentArchiveProject ? currentArchiveProject.sessionCount : visibleArchiveSessions.length,
      detail:
        currentArchiveProject?.activeSessionCount || visibleArchiveActiveCount
          ? `${currentArchiveProject?.activeSessionCount ?? visibleArchiveActiveCount} activas`
          : 'Sin activas',
    },
    {
      label: 'Registros',
      value: currentArchiveProject ? currentArchiveProject.pointCount : visibleArchiveRecordCount,
      detail: currentArchiveProject ? 'En trabajo actual' : 'En filtro actual',
    },
    {
      label: 'Fotos',
      value: currentArchiveProject ? currentArchiveProject.photoCount : visibleArchivePhotoCount,
      detail: 'Visibles',
    },
    {
      label: 'Tomas H6',
      value: currentArchiveProject ? currentArchiveProject.audioTakeCount : visibleArchiveAudioCount,
      detail: 'Importadas',
    },
  ];

  useEffect(() => {
    setProjectDraftName(currentArchiveProject?.name ?? '');
  }, [currentArchiveProject?.key, currentArchiveProject?.name]);

  useEffect(() => {
    if (!recordSession || !recordPoint) {
      setPublishPhotoId('');
      setPublishAudioTakeId('');
      setPublishCaption('');
      setPublishedSelectionsForPoint([]);
      return;
    }

    const nextPhotoId = recordPoint.photos[0]?.id ?? '';
    const nextAudioTakeId =
      recordSession.audioTakes.find((take) => take.associatedPointId === recordPoint.id)?.id ?? '';

    setPublishPhotoId((current) =>
      current && recordPoint.photos.some((photo) => photo.id === current) ? current : nextPhotoId,
    );
    setPublishAudioTakeId((current) =>
      current && recordSession.audioTakes.some((take) => take.id === current && take.associatedPointId === recordPoint.id)
        ? current
        : nextAudioTakeId,
    );
    setPublishCaption(buildSelectionCaption(recordSession, recordPoint));
  }, [recordPoint?.id, recordSession?.id]);

  useEffect(() => {
    let active = true;

    if (!recordSession || !recordPoint || !isOnline) {
      setPublishedSelectionsForPoint([]);
      return () => {
        active = false;
      };
    }

    void loadPublishedSelectionsLib()
      .then(({ listPublishedSelections }) =>
        listPublishedSelections({
          sessionId: recordSession.id,
          pointId: recordPoint.id,
        }),
      )
      .then((selections) => {
        if (active) {
          setPublishedSelectionsForPoint(selections);
        }
      })
      .catch(() => {
        if (active) {
          setPublishedSelectionsForPoint([]);
        }
      });

    return () => {
      active = false;
    };
  }, [isOnline, recordPoint?.id, recordSession?.id]);

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
  const recordPointPhotoOptions = recordPoint?.photos ?? [];
  const recordPointAudioOptions = recordSession
    ? recordSession.audioTakes.filter((take) => take.associatedPointId === recordPoint?.id)
    : [];
  const selectedPublishPhoto = recordPointPhotoOptions.find((photo) => photo.id === publishPhotoId) ?? null;
  const selectedPublishAudioTake =
    recordPointAudioOptions.find((take) => take.id === publishAudioTakeId) ?? null;
  const latestActivePoints = sortedActiveSessionPoints.slice(0, HOME_RECORD_PREVIEW_LIMIT);
  const hasMoreActivePoints = sortedActiveSessionPoints.length > HOME_RECORD_PREVIEW_LIMIT;
  const homeRecentRecordsDescription =
    latestActivePoints.length === 0
      ? 'Sin actividad reciente'
      : hasMoreActivePoints
        ? `${latestActivePoints.length} de ${sortedActiveSessionPoints.length} visibles`
        : `${latestActivePoints.length} visibles ahora`;
  const homeSessionSummaryItems = activeSession
    ? [
        {
          label: 'Registros',
          value: activeSession.points.length,
          detail: latestActivePoints.length > 0 ? `${latestActivePoints.length} visibles ahora` : 'Sin actividad reciente',
        },
        {
          label: 'Fotos',
          value: activeSessionPhotoCount,
          detail: activeSessionPhotoCount > 0 ? 'Asociadas a registros' : 'Sin fotos',
        },
        {
          label: 'Tomas H6',
          value: activeSession.audioTakes.length,
          detail: activeSession.audioTakes.length > 0 ? 'Importadas en salida' : 'Sin tomas',
        },
        {
          label: 'Pendientes',
          value: totalOperationalPendingCount,
          detail: homeOperationalPendingDetail,
        },
      ]
    : [];
  const hasRecentWork = recentSessions.length > 0;
  const hasRecentMedia = recentMediaLibraryItems.length > 0;
  const hasMoreRecentPhotos = recentPhotoLibraryItems.length > HOME_MEDIA_PREVIEW_LIMIT;
  const hasMoreRecentAudio = recentAudioLibraryItems.length > HOME_AUDIO_PREVIEW_LIMIT;
  const homeMediaPreviewSummary =
    homeMediaFilter === 'all'
      ? 'Vista previa rápida. La exploración completa vive en la biblioteca.'
      : homeMediaFilter === 'photos'
        ? hasMoreRecentPhotos
          ? `Mostrando ${recentPhotoLibrary.length} de ${recentPhotoLibraryItems.length} fotos recientes.`
          : `${recentPhotoLibrary.length} fotos recientes.`
        : hasMoreRecentAudio
          ? `Mostrando ${recentAudioLibrary.length} de ${recentAudioLibraryItems.length} tomas H6 recientes.`
          : `${recentAudioLibrary.length} tomas H6 recientes.`;
  const homeMediaEmptyMessage =
    homeMediaFilter === 'all'
      ? 'Todavía no hay fotos ni tomas H6 recientes para revisar en el resumen.'
      : homeMediaFilter === 'photos'
        ? 'No hay fotos recientes para revisar en el resumen.'
        : 'No hay tomas H6 recientes para revisar en el resumen.';
  const viewportMode = getViewportMode(viewportWidth);
  const isMobileViewport = viewportMode === 'mobile';
  const isCompactHomeLayout = viewportWidth < 980;
  const isCompactSessionLayout = viewportWidth < 980;
  const isCompactCaptureLayout = viewportWidth < 1120;
  const isCompactArchiveLayout = viewportWidth < 1120;
  const homeWorkPreviewGroups = isCompactHomeLayout ? recentNamedProjectGroups.slice(0, 3) : recentNamedProjectGroups;
  const homeWorkPreviewSessions = isCompactHomeLayout ? recentSessions.slice(0, 4) : recentSessions;
  const effectiveHomeSecondaryTab =
    homeSecondaryTab === 'media' && !hasRecentMedia
      ? 'work'
      : homeSecondaryTab === 'work' && !hasRecentWork && hasRecentMedia
        ? 'media'
        : homeSecondaryTab;
  const homeSecondaryActionLabel =
    effectiveHomeSecondaryTab === 'work'
      ? hasRecentWork
        ? 'Ver salidas'
        : undefined
      : hasRecentMedia
        ? 'Ver biblioteca'
        : undefined;
  const homeSecondaryAction = () => {
    if (effectiveHomeSecondaryTab === 'work') {
      setView('session');
      return;
    }

    openMediaArchiveFromHome();
  };
  const renderHomeWorkPreview = (compact = false) =>
    hasRecentWork ? (
      <div className={`dashboard-browser-grid ${compact ? 'dashboard-browser-grid--stacked' : ''}`.trim()}>
        <section
          className="dashboard-subsection"
          aria-labelledby="home-project-groups-title"
          aria-describedby="home-project-groups-description"
        >
          <SectionHeader
            titleId="home-project-groups-title"
            descriptionId="home-project-groups-description"
            title="Trabajos recientes"
            description={
              homeWorkPreviewGroups.length > 0
                ? compact
                  ? `${homeWorkPreviewGroups.length} trabajos visibles ahora.`
                  : `${homeWorkPreviewGroups.length} trabajos visibles ahora en el resumen.`
                : 'Aún no hay trabajos con nombre visibles en el resumen.'
            }
            titleAs="h3"
            compact
          />
          {homeWorkPreviewGroups.length > 0 ? (
            <StructuredList>
              {homeWorkPreviewGroups.map((group) => (
                <li key={group.key}>
                  <ListRow
                    onClick={() => openProjectArchiveFromHome(group.key)}
                    eyebrow={group.activeSessionCount > 0 ? 'Con salida activa' : 'Trabajo'}
                    title={group.name}
                    meta={
                      group.activeSessionCount > 0
                        ? `${group.activeSessionCount} salida${group.activeSessionCount === 1 ? '' : 's'} activa${group.activeSessionCount === 1 ? '' : 's'} ahora.`
                        : 'Sin actividad abierta ahora.'
                    }
                    stats={[
                      `${group.sessionCount} salidas`,
                      `${group.pointCount} registros`,
                      `${group.audioTakeCount} H6`,
                    ]}
                    actionLabel="Abrir proyecto"
                  />
                </li>
              ))}
            </StructuredList>
          ) : (
            <EmptyState
              eyebrow="Trabajos"
              title="Todavía no hay trabajos"
              description="Tus salidas pueden existir sin trabajo. El primer trabajo aparecerá cuando crees o edites una salida con nombre de trabajo."
              icon={<FileSpreadsheet className="h-5 w-5" />}
              action={
                <Button variant="ghost" onClick={() => setView('session')}>
                  Ir a salidas
                </Button>
              }
              compact
            />
          )}
        </section>

        <section
          className="dashboard-subsection"
          aria-labelledby="home-recent-sessions-title"
          aria-describedby="home-recent-sessions-description"
        >
          <SectionHeader
            titleId="home-recent-sessions-title"
            descriptionId="home-recent-sessions-description"
            title="Salidas recientes"
            description={`${homeWorkPreviewSessions.length} salidas recientes con acceso directo.`}
            titleAs="h3"
            compact
          />
          <StructuredList>
            {homeWorkPreviewSessions.map((session) => (
              <li key={session.id}>
                <ListRow
                  onClick={() => openSessionArchiveFromHome(session.id)}
                  eyebrow={session.status === 'active' ? 'Salida activa' : 'Salida cerrada'}
                  title={session.name}
                  meta={`${resolveProjectName(session.projectName)} · ${session.region || 'sin zona definida'}`}
                  stats={[`${session.points.length} registros`, `${session.audioTakes.length} H6`]}
                  actionLabel="Ver salida"
                />
              </li>
            ))}
          </StructuredList>
        </section>
      </div>
    ) : (
      <EmptyState
        eyebrow="Trabajo"
        title="Todavía no hay trabajo reciente"
        description="Cuando guardes la primera salida, esta zona mostrará trabajos, salidas y accesos directos para retomarlos sin buscar."
        icon={<History className="h-5 w-5" />}
        action={
          <Button variant="secondary" onClick={() => setView('session')}>
            Preparar primera salida
          </Button>
        }
        compact={compact}
      />
    );
  const renderHomeMediaPreview = (compact = false) =>
    hasRecentMedia ? (
      <div className={`home-media-panel ${compact ? 'home-media-panel--compact' : ''}`.trim()}>
        <div className="home-media-panel__controls">
          <SegmentedControl
            label="Filtrar media reciente"
            value={homeMediaFilter}
            items={HOME_MEDIA_FILTERS.map((filterOption) => ({
              value: filterOption.id,
              label: filterOption.label,
              count:
                filterOption.id === 'all'
                  ? recentMediaLibraryItems.length
                  : filterOption.id === 'photos'
                    ? recentPhotoLibraryItems.length
                    : recentAudioLibraryItems.length,
            }))}
            onChange={setHomeMediaFilter}
            panelIdBase="home-media-filter"
            size="sm"
          />
          <p className="module-copy text-sm home-media-panel__summary">{homeMediaPreviewSummary}</p>
        </div>

        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`home-media-${homeMediaFilter}`}
            id={`home-media-filter-panel-${homeMediaFilter}`}
            role="tabpanel"
            aria-labelledby={`home-media-filter-tab-${homeMediaFilter}`}
            className="content-swap-panel content-swap-panel--local"
            {...contentSwapMotion}
          >
            {homeMediaFilter === 'all' ? (
              recentMediaLibraryItems.length > 0 ? (
                <div className="home-media-overview">
                  <section className="home-media-overview__section" aria-labelledby="home-media-overview-photos-title">
                    <div className="home-media-overview__header">
                      <p id="home-media-overview-photos-title" className="home-media-overview__title">
                        Últimas fotos
                      </p>
                      <span className="home-media-overview__count">
                        {recentPhotoLibraryItems.length}
                      </span>
                    </div>

                    {recentOverviewPhotos.length > 0 ? (
                      <StructuredList>
                        {recentOverviewPhotos.map((photo) => (
                          <li key={photo.id}>
                            <ListRow
                              dense
                              onClick={() => openRecordView(photo.sessionId, photo.pointId)}
                              aria-label={`Ver registro de ${photo.pointName}`}
                              leadingVisual={
                                <span className="home-media-preview-card__visual home-media-preview-card__visual--compact">
                                  <img src={photo.previewUrl} alt="" className="home-media-preview-card__thumb" />
                                </span>
                              }
                              eyebrow="Foto"
                              title={photo.pointName}
                              meta={`${photo.sessionName} · ${formatDateTime(photo.createdAt, "d MMM · HH:mm")}`}
                            />
                          </li>
                        ))}
                      </StructuredList>
                    ) : (
                      <p className="module-copy text-sm">Sin fotos recientes.</p>
                    )}
                  </section>

                  <section className="home-media-overview__section" aria-labelledby="home-media-overview-audio-title">
                    <div className="home-media-overview__header">
                      <p id="home-media-overview-audio-title" className="home-media-overview__title">
                        Últimas tomas H6
                      </p>
                      <span className="home-media-overview__count">
                        {recentAudioLibraryItems.length}
                      </span>
                    </div>

                    {recentOverviewAudio.length > 0 ? (
                      <StructuredList>
                        {recentOverviewAudio.map((take) => (
                          <li key={take.id}>
                            <ListRow
                              dense
                              onClick={() =>
                                take.associatedPointId
                                  ? openRecordView(take.sessionId, take.associatedPointId)
                                  : openSessionMediaArchiveFromHome(take.sessionId)
                              }
                              aria-label={
                                take.associatedPointId
                                  ? `Abrir registro asociado a ${take.fileName}`
                                  : `Abrir biblioteca de la salida para ${take.fileName}`
                              }
                              leadingVisual={
                                <span className="home-media-preview-card__visual home-media-preview-card__visual--audio">
                                  <span className="home-media-preview-card__icon home-media-preview-card__icon--compact">
                                    <AudioWaveform className="h-4 w-4" />
                                  </span>
                                </span>
                              }
                              eyebrow="Toma H6"
                              title={take.fileName}
                              meta={
                                take.pointName
                                  ? `${take.pointName} · ${formatDateTime(take.inferredRecordedAt, "d MMM · HH:mm")}`
                                  : `${take.projectName} · sin punto asociado · ${formatDateTime(take.inferredRecordedAt, "d MMM · HH:mm")}`
                              }
                            />
                          </li>
                        ))}
                      </StructuredList>
                    ) : (
                      <p className="module-copy text-sm">Sin tomas recientes.</p>
                    )}
                  </section>
                </div>
              ) : (
                <p className="module-copy text-sm">{homeMediaEmptyMessage}</p>
              )
            ) : homeMediaFilter === 'photos' ? (
              recentPhotoLibrary.length > 0 ? (
                <ul className="home-media-grid">
                  {recentPhotoLibrary.map((photo) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        onClick={() => openRecordView(photo.sessionId, photo.pointId)}
                        aria-label={`Ver registro de ${photo.pointName}`}
                        className="media-thumb-card media-thumb-card--preview"
                      >
                        <img src={photo.previewUrl} alt={photo.pointName} className="media-thumb-card__image" />
                        <span className="media-thumb-card__caption">
                          <strong>{photo.pointName}</strong>
                          <small>
                            {photo.sessionName} · {formatDateTime(photo.createdAt, "d MMM · HH:mm")}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="module-copy text-sm">{homeMediaEmptyMessage}</p>
              )
            ) : recentAudioLibrary.length > 0 ? (
              <StructuredList>
                {recentAudioLibrary.map((take) => (
                  <li key={take.id}>
                    <ListRow
                      dense
                      onClick={() =>
                        take.associatedPointId
                          ? openRecordView(take.sessionId, take.associatedPointId)
                          : openSessionMediaArchiveFromHome(take.sessionId)
                      }
                      aria-label={
                        take.associatedPointId
                          ? `Abrir registro asociado a ${take.fileName}`
                          : `Abrir biblioteca de la salida para ${take.fileName}`
                      }
                      leadingVisual={
                        <span className="home-media-preview-card__visual home-media-preview-card__visual--audio">
                          <span className="home-media-preview-card__icon home-media-preview-card__icon--compact">
                            <AudioWaveform className="h-4 w-4" />
                          </span>
                        </span>
                      }
                      eyebrow="Toma H6"
                      title={take.fileName}
                      meta={
                        take.pointName
                          ? `${take.pointName} · ${formatDateTime(take.inferredRecordedAt, "d MMM · HH:mm")}`
                          : `${take.projectName} · sin punto asociado · ${formatDateTime(take.inferredRecordedAt, "d MMM · HH:mm")}`
                      }
                      actionLabel={take.associatedPointId ? 'Abrir registro' : 'Abrir biblioteca'}
                    />
                  </li>
                ))}
              </StructuredList>
            ) : (
              <p className="module-copy text-sm">{homeMediaEmptyMessage}</p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    ) : (
      <EmptyState
        eyebrow="Media"
        title="Todavía no hay media reciente"
        description={
          activeSession
            ? 'Las fotos y tomas H6 aparecerán aquí en cuanto guardes el primer registro o importes audio a la salida activa.'
            : 'Las fotos y tomas H6 aparecerán aquí cuando empieces una salida y registres el primer punto.'
        }
        icon={<ImagePlus className="h-5 w-5" />}
        action={
          <Button variant="secondary" onClick={() => setView(activeSession ? 'point' : 'session')}>
            {activeSession ? 'Ir a captura' : 'Preparar salida'}
          </Button>
        }
        compact={compact}
      />
    );
  const greetingLabel = getGreetingLabel(now);
  const homeLauncherTitle = activeSession ? 'Continuar salida' : 'Preparar salida';
  const homeLauncherCopy = activeSession
    ? `${activeSession.name} sigue abierta. Registra el siguiente punto y deja el archivo para cuando realmente lo necesites.`
    : 'Empieza creando o retomando una salida. Todo lo demás queda fuera del camino hasta que haga falta.';
  const homePrimaryActionLabel = activeSession ? 'Registrar punto' : 'Preparar salida';
  const homeSessionActionLabel = activeSession ? 'Abrir salida' : 'Ver salidas';
  const homeArchiveActionLabel = 'Abrir archivo';
  const latestRecordLabel = recordPoint ? recordPoint.placeName : 'Sin ficha final todavía';
  const latestRecordSummary = recordPoint
    ? `${formatDateTime(recordPoint.createdAt, "d MMM yyyy · HH:mm")} · ${resolveProjectName(recordSession?.projectName ?? '')}`
    : 'El archivo final aparecerá en cuanto guardes el primer punto.';
  const homeOperationalFacts = [
    {
      id: 'gps',
      label: 'GPS',
      value: currentGps ? gpsAccuracyLabel : 'pendiente',
    },
    {
      id: 'place',
      label: 'Lugar',
      value: detectedPlace?.placeName || activeSession?.region || 'sin contexto',
    },
    {
      id: 'sync',
      label: 'Sync',
      value: syncPendingCount === 0 ? 'activo' : `${syncPendingCount} pendientes`,
    },
    {
      id: 'records',
      label: 'Registros',
      value: activeSession ? String(activeSession.points.length) : '0',
    },
  ] as const;
  const homeOperationalContext = activeSession
    ? [activeSessionProjectName, activeSession.region || null, activeSessionStartedLabel ? `Desde ${activeSessionStartedLabel}` : null]
        .filter(Boolean)
        .join(' · ')
    : 'Sin salida activa';
  const homeGpsValue = currentGps ? gpsAccuracyLabel : 'Sin señal';
  const homeGpsCopy = currentGps ? `${gpsLabel} · ${gpsStatusLabel}` : 'Activa el GPS para situar la salida.';
  const homePlaceValue = detectedPlace ? 'Lugar detectado' : currentGps ? 'Buscando lugar' : 'Esperando GPS';
  const homePlaceCopy = detectedPlace?.placeName || 'El lugar aparecerá cuando haya fijación GPS y red.';
  const homeSyncValue = syncPendingCount === 0 ? 'Sincronizado' : `${syncPendingCount} pendientes`;
  const homeReviewValue = pendingEnrichmentCount === 0 ? 'Revisión al día' : `${pendingEnrichmentCount} pendientes`;
  const homeStatusItems = [
    {
      id: 'gps',
      label: 'GPS',
      value: homeGpsValue,
      detail: homeGpsCopy,
    },
    {
      id: 'place',
      label: 'Lugar',
      value: homePlaceValue,
      detail: homePlaceCopy,
    },
    {
      id: 'sync',
      label: 'Sincronización',
      value: homeSyncValue,
      detail: syncPendingSummary,
    },
    {
      id: 'review',
      label: 'Revisión',
      value: homeReviewValue,
      detail: metadataReviewSummary,
    },
  ] as const;
  const homeQuickReadItems = [
    {
      id: 'now',
      label: 'Ahora',
      value: activeSession ? activeSession.name : 'Preparar salida',
      detail: activeSession
        ? `${activeSession.points.length} registro${activeSession.points.length === 1 ? '' : 's'} en curso`
        : 'Define trabajo, zona y equipo antes de salir.',
    },
    {
      id: 'next',
      label: 'Siguiente paso',
      value: activeSession ? 'Registrar punto' : 'Abrir salidas',
      detail: activeSession
        ? 'La captura queda lista para GPS, fotos y notas.'
        : 'La captura se activa cuando abras o crees una salida.',
    },
    {
      id: 'archive',
      label: 'Archivo',
      value: recordPoint ? latestRecordLabel : 'Sin último registro',
      detail: recordPoint ? latestRecordSummary : 'El archivo aparecerá tras guardar el primer punto.',
    },
  ] as const;
  const storageSummary =
    storageMode === 'ready'
      ? 'Archivo local disponible'
      : storageMode === 'loading'
        ? 'Preparando almacenamiento'
        : 'Sólo memoria';
  const isSunMode = displayMode === 'sun';
  const currentViewLabel =
    view === 'home' ? 'Inicio' : view === 'session' ? 'Salidas' : view === 'point' ? 'Captura' : 'Archivo';
  const currentViewTitle =
    view === 'home'
      ? 'Qué necesita la jornada'
      : view === 'session'
        ? 'Preparar y retomar salidas'
        : view === 'point'
          ? activeSession
            ? 'Registrar punto en campo'
            : 'Prepara una salida antes de registrar'
          : 'Archivo, media y exportación';
  const currentViewDescription =
    view === 'home'
      ? 'Desde aquí ves qué salida sigue abierta, qué falta por registrar y cómo llegar al archivo sin navegar a ciegas.'
      : view === 'session'
        ? 'Crea una salida, retoma trabajo reciente y busca registros sin mezclar captura y archivo.'
        : view === 'point'
          ? 'La captura queda centrada en registrar rápido: ubicación, escucha, fotos y notas en una sola pantalla.'
          : 'El archivo deja visibles registros, fotos, audio H6 y exportación sin esconder acciones ni mezclar edición.';
  const sessionDraftProjectHint =
    sessionDraft.projectName.trim() || preferredProjectName || latestKnownProjectName || 'Sin trabajo reciente';
  const sessionDraftRegionHint =
    sessionDraft.region.trim() || (currentGps ? homePlaceValue : 'Define la zona al abrir la salida');
  const sessionDraftRouteValue =
    sessionDraft.routeDestinationLabel.trim() ||
    (sessionDraft.routeUrl.trim() ? 'Ruta enlazada' : 'Sin ruta programada');
  const sessionDraftArrivalValue = sessionDraft.armCaptureOnArrival
    ? sessionDraftRouteCoordinates
      ? `Radio ${sessionDraftRouteRadius} m`
      : 'Faltan coordenadas'
    : 'Activación manual';
  const sessionDraftSupportItems = [
    { id: 'project', label: 'Trabajo sugerido', value: sessionDraftProjectHint },
    { id: 'territory', label: 'Territorio', value: sessionDraftRegionHint },
    { id: 'equipment', label: 'Equipo', value: sessionDraft.equipmentPreset.trim() || 'Zoom H6 · XY' },
    { id: 'route', label: 'Ruta', value: sessionDraftRouteValue },
    { id: 'arrival', label: 'Llegada', value: sessionDraftArrivalValue },
  ] as const;
  const sessionDraftSupportCopy = sessionDraft.armCaptureOnArrival
    ? sessionDraftRouteCoordinates
      ? `La captura se podrá armar al entrar dentro de ${sessionDraftRouteRadius} m del destino.`
      : 'Añade coordenadas de destino para que la activación por llegada funcione.'
    : currentGps
      ? 'La posición actual ya está lista para completar contexto en cuanto abras la salida.'
      : 'Puedes dejar la salida preparada ahora y resolver ubicación o clima más tarde desde captura.';
  const sessionDraftRouteHint = sessionDraftRouteCoordinates
    ? `Destino listo en ${sessionDraftRouteCoordinates.lat.toFixed(6)}, ${sessionDraftRouteCoordinates.lon.toFixed(6)}.`
    : sessionDraftRouteHasShortMapsUrl
      ? 'El enlace corto abrirá Maps, pero para detectar la llegada conviene añadir latitud y longitud.'
      : sessionDraft.routeUrl.trim()
        ? 'Si el enlace trae coordenadas, la app las detectará al guardar aunque no rellenes latitud y longitud.'
        : 'Puedes pegar una ruta de Google Maps y definir un punto de llegada para dejar la captura lista al llegar.';
  const activeRouteArrivalValue =
    !activeRoutePlan
      ? null
      : activeRoutePlan.arrivalDetectedAt
        ? 'Llegada detectada'
        : activeRoutePlan.activateCaptureOnArrival
          ? activeRouteDestination
            ? isWithinActiveRouteArrivalRadius
              ? 'Dentro del radio'
              : activeRouteDistanceMeters != null
                ? `A ${formatDistanceLabel(activeRouteDistanceMeters)}`
                : 'Esperando GPS'
            : 'Faltan coordenadas'
          : activeRouteDestination
            ? 'Ruta guardada'
            : 'Sin punto de llegada';
  const activeRouteArrivalDetail =
    !activeRoutePlan
      ? null
      : activeRoutePlan.arrivalDetectedAt
        ? `La llegada quedó marcada el ${formatDateTime(activeRoutePlan.arrivalDetectedAt, "d MMM · HH:mm")}.`
        : activeRoutePlan.activateCaptureOnArrival
          ? activeRouteDestination
            ? activeRouteDistanceMeters != null
              ? `Radio armado en ${activeRoutePlan.arrivalRadiusMeters} m.`
              : 'Activa el GPS para medir la distancia restante.'
            : 'Añade coordenadas al destino para activar automáticamente.'
          : 'La ruta sólo se abre en Maps; la captura se activa manualmente.';
  const surfaceEnterMotion = getSurfaceEnterMotion(prefersReducedMotion);
  const viewTransitionMotion = getViewTransitionMotion(prefersReducedMotion);
  const contentSwapMotion = getContentSwapMotion(prefersReducedMotion);
  const operationalStatusMeta =
    statusTone === 'success'
      ? {
          eyebrow: 'Acción completada',
          className: 'status-banner--success',
          icon: CheckCircle2,
        }
      : statusTone === 'warning'
        ? {
            eyebrow: 'Atención operativa',
            className: 'status-banner--info status-banner--warning-soft',
            icon: TriangleAlert,
          }
        : {
            eyebrow: 'Estado operativo',
            className: 'status-banner--info',
            icon: Info,
          };
  const OperationalStatusIcon = operationalStatusMeta.icon;
  const syncingCloudSessionName =
    isSyncingCloudSessionId != null
      ? sessions.find((session) => session.id === isSyncingCloudSessionId)?.name ?? 'la salida seleccionada'
      : null;
  const syncingCatalogSessionName =
    isSyncingCatalogSessionId != null
      ? sessions.find((session) => session.id === isSyncingCatalogSessionId)?.name ?? 'la salida seleccionada'
      : null;
  const importingSessionName =
    isImportingSessionId != null
      ? sessions.find((session) => session.id === isImportingSessionId)?.name ?? 'la salida seleccionada'
      : null;
  const exportingSessionName =
    isExportingSessionId != null
      ? sessions.find((session) => session.id === isExportingSessionId)?.name ?? 'la salida seleccionada'
      : null;
  const activeBusyMessage =
    storageMode === 'loading'
      ? 'Preparando almacenamiento local.'
      : isQuickCapturing
        ? 'Guardando un registro rápido.'
        : soundscapeStatus === 'listening'
          ? 'Analizando el ambiente sonoro.'
          : locationStatus === 'loading'
            ? 'Actualizando el lugar detectado.'
            : weatherStatus === 'loading'
              ? 'Actualizando el clima automático.'
              : isPublishingSelection
                ? 'Publicando la selección web.'
                : isUpdatingProjectKey != null
                  ? 'Actualizando el trabajo seleccionado.'
                  : importingSessionName
                    ? `Importando audio H6 en ${importingSessionName}.`
                    : syncingCloudSessionName
                      ? `Respaldando ${syncingCloudSessionName} en la nube.`
                      : syncingCatalogSessionName
                        ? `Sincronizando ${syncingCatalogSessionName} con el catálogo remoto.`
                        : exportingSessionName
                          ? `Exportando ${exportingSessionName}.`
                          : isSyncingPendingMetadata
                            ? 'Sincronizando metadatos pendientes.'
                            : null;
  const shellSupportText = activeSession
    ? `Siguiente paso: registrar en ${activeSession.name}`
    : 'Siguiente paso: preparar una salida';
  const captureEntryLabel = activeSession ? 'Ir a captura' : 'Preparar salida';
  const navigationItems: NavigationItem[] = [
    {
      view: 'home',
      label: 'Inicio',
      description: 'Estado y siguiente paso',
      icon: House,
      onClick: () => setView('home'),
    },
    {
      view: 'session',
      label: 'Salidas',
      description: 'Preparar y retomar',
      icon: MapPinned,
      onClick: () => setView('session'),
    },
    {
      view: 'point',
      label: 'Captura',
      description: activeSession ? 'GPS, fotos y notas' : 'Necesita una salida',
      icon: Mic,
      onClick: () => setView(activeSession ? 'point' : 'session'),
    },
    {
      view: 'export',
      label: 'Archivo',
      description: 'Registros, media y ZIP',
      icon: History,
      onClick: () => setView('export'),
    },
  ];
  const homeWorkflowCards = [
    {
      eyebrow: 'Paso 1',
      title: activeSession ? 'Retomar salida' : 'Preparar salida',
      description: 'Abre el contexto de trabajo antes de entrar en captura.',
      status: activeSession ? `${activeSession.points.length} registros en ${activeSession.name}` : `${projectCount} trabajos visibles`,
      cta: activeSession ? 'Abrir salidas' : 'Preparar salida',
      icon: MapPinned,
      featured: !activeSession,
      onClick: () => setView('session'),
    },
    {
      eyebrow: 'Paso 2',
      title: activeSession ? 'Registrar punto' : 'Activar captura',
      description: 'GPS, clima, fotos, notas e IA sin salir del flujo de campo.',
      status: activeSession ? `${gpsStatusLabel} · ${activeSession.name}` : 'Necesita una salida activa',
      cta: captureEntryLabel,
      icon: Mic,
      featured: Boolean(activeSession),
      onClick: () => setView(activeSession ? 'point' : 'session'),
    },
    {
      eyebrow: 'Paso 3',
      title: 'Revisar archivo',
      description: 'Registros, galería, tomas H6 y exportación en una vista clara.',
      status: recordSession ? `${recordSession.name} · ${recordSession.audioTakes.length} tomas H6` : `${totalPhotoCount} fotos · ${totalAudioTakeCount} tomas`,
      cta: 'Abrir archivo',
      icon: History,
      featured: view === 'export',
      onClick: () => setView('export'),
    },
  ];
  const isCatalogApiUnavailable = catalogApiStatus === 'unavailable';
  const showSidebar = true;
  const showMobileDock = isMobileViewport;
  const shouldShowOperationalBanner = view !== 'home';
  const shouldShowStatusStack =
    shouldShowOperationalBanner ||
    !isOnline ||
    isCatalogApiUnavailable ||
    storageMode === 'memory-only' ||
    Boolean(appError);
  const currentLocationLabel = currentGps ? 'Ubicación actual' : 'Sin ubicación activa';
  const captureStatusSummaryItems = [
    {
      label: 'Hora',
      value: captureTimeLabel,
      detail: captureDateLabel,
    },
    {
      label: 'GPS',
      value: currentGps ? gpsAccuracyLabel : gpsStatusLabel,
      detail: currentGps ? gpsLabel : 'Activa el GPS para fijar el punto',
    },
    {
      label: 'Lugar',
      value: pointDraft.placeName.trim() || detectedPlace?.placeName || locationStatusLabel,
      detail: pointDraft.placeName.trim() ? 'Definido en borrador' : locationStatusLabel,
    },
    {
      label: 'Clima',
      value: weatherSnapshot?.summary || weatherStatusLabel,
      detail: weatherStatus === 'ready' ? 'Sincronizado' : weatherMessage,
    },
  ];
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

  function renderActiveRoutePlanCard(mode: 'home' | 'session') {
    if (!activeRoutePlan || !activeRouteArrivalValue || !activeRouteArrivalDetail) {
      return null;
    }

    const showCaptureAction = Boolean(activeRouteDestination || activeRoutePlan.destinationLabel.trim());
    const captureActionLabel =
      activeRoutePlan.arrivalDetectedAt || isWithinActiveRouteArrivalRadius
        ? 'Activar captura'
        : 'Preparar captura';

    return (
      <aside className={`session-draft-context route-plan-card route-plan-card--${mode}`} aria-label="Ruta activa">
        <p className="eyebrow">{mode === 'home' ? 'Ruta armada' : 'Ruta activa'}</p>
        <h4 className="session-draft-context__title">{activeRouteDestinationLabel}</h4>
        <ul className="session-draft-context__facts">
          <li className="session-draft-context__fact">
            <span className="session-draft-context__label">Llegada</span>
            <strong className="session-draft-context__value">{activeRouteArrivalValue}</strong>
          </li>
          <li className="session-draft-context__fact">
            <span className="session-draft-context__label">Radio</span>
            <strong className="session-draft-context__value">{activeRoutePlan.arrivalRadiusMeters} m</strong>
          </li>
          <li className="session-draft-context__fact">
            <span className="session-draft-context__label">Navegación</span>
            <strong className="session-draft-context__value">
              {activeRoutePlan.navigationUrl ? 'Lista para abrir' : 'Sin enlace guardado'}
            </strong>
          </li>
        </ul>
        <p className="module-copy text-sm">{activeRouteArrivalDetail}</p>
        <div className="action-row action-row--compact">
          {activeRoutePlan.navigationUrl ? (
            <button
              type="button"
              onClick={() => openNavigationRoute(activeRoutePlan)}
              className="ui-button ui-button-secondary"
            >
              <CarFront className="h-4 w-4" />
              Abrir ruta
            </button>
          ) : null}
          {showCaptureAction ? (
            <button
              type="button"
              onClick={() => prepareCaptureForRoutePlan(activeRoutePlan)}
              className="ui-button ui-button-primary"
            >
              <Mic className="h-4 w-4" />
              {captureActionLabel}
            </button>
          ) : null}
        </div>
      </aside>
    );
  }

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
    const sessionPhotoCount = session.points.reduce((count, point) => count + point.photos.length, 0);
    const sessionLinkedAudioCount = session.audioTakes.filter((take) => take.associatedPointId).length;
    const sessionUnlinkedAudioCount = session.audioTakes.length - sessionLinkedAudioCount;
    const sessionLatestSpilloverPointAt = findLatestSpilloverPointCreatedAt(session);
    const sessionLatestSpilloverPointCount = sessionLatestSpilloverPointAt
      ? session.points.filter((point) => isSameLocalCalendarDay(point.createdAt, sessionLatestSpilloverPointAt)).length
      : 0;
    const sessionCloudStatusLabel =
      session.cloudSyncStatus === 'synced'
        ? 'Respaldo al día'
        : session.cloudSyncStatus === 'syncing'
          ? 'Respaldando ahora'
          : session.cloudSyncStatus === 'error'
            ? 'Error de respaldo'
            : session.cloudSyncStatus === 'pending'
              ? 'Pendiente de respaldo'
              : 'Solo local';
    const sessionCatalogStatusLabel =
      session.catalogSyncStatus === 'synced'
        ? 'Catálogo al día'
        : session.catalogSyncStatus === 'syncing'
          ? 'Catalogando ahora'
          : session.catalogSyncStatus === 'error'
            ? 'Error de catálogo'
            : session.catalogSyncStatus === 'pending'
              ? 'Pendiente de catálogo'
              : 'Sin catálogo';
    const sessionSummaryItems = [
      { label: 'Registros', value: session.points.length, detail: 'Guardados' },
      { label: 'Fotos', value: sessionPhotoCount, detail: 'Visibles' },
      {
        label: 'Tomas H6',
        value: session.audioTakes.length,
        detail: sessionUnlinkedAudioCount > 0 ? `${sessionUnlinkedAudioCount} sin punto` : 'Todas asociadas',
      },
      { label: 'Asociadas', value: sessionLinkedAudioCount, detail: 'Con punto' },
    ];

    return (
      <div key={session.id} className="panel archive-session-card">
        <div className="archive-session-card__header">
          <div className="archive-session-card__copy">
            <div className="archive-session-card__chips">
              <span
                className={`telemetry-chip ${
                  session.status === 'active'
                    ? 'border-[color:var(--line-strong)] text-[color:var(--ink)]'
                    : 'border-[color:var(--signal-strong)] text-[color:var(--signal-strong)]'
                }`}
              >
                {session.status === 'active' ? 'Activa' : 'Cerrada'}
              </span>
              <span className="telemetry-chip">{sessionCloudStatusLabel}</span>
              <span className="telemetry-chip">{sessionCatalogStatusLabel}</span>
            </div>
            <p className="display-heading text-3xl text-[color:var(--ink)]">{session.name}</p>
            <ul className="archive-session-card__context" aria-label="Contexto de la salida">
              <li>
                <span className="telemetry-chip">{formatDateTime(session.startedAt, "d MMM yyyy · HH:mm")}</span>
              </li>
              <li>
                <span className="telemetry-chip">{resolveProjectName(session.projectName)}</span>
              </li>
              <li>
                <span className="telemetry-chip">{session.region || 'sin zona'}</span>
              </li>
              {session.equipmentPreset ? (
                <li>
                  <span className="telemetry-chip">{session.equipmentPreset}</span>
                </li>
              ) : null}
            </ul>
          </div>

          <div className="archive-session-card__actions">
            <button
              type="button"
              onClick={() => void syncSessionToCloudBackup(session.id)}
              disabled={!isOnline || isSyncingCloudSessionId === session.id}
              aria-busy={isSyncingCloudSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isSyncingCloudSessionId === session.id ? 'Respaldando' : 'Respaldar nube'}
            </button>
            <button
              type="button"
              onClick={() => void syncSessionToCatalogStore(session.id)}
              disabled={!isOnline || isCatalogApiUnavailable || isSyncingCatalogSessionId === session.id}
              aria-busy={isSyncingCatalogSessionId === session.id}
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
              type="button"
              onClick={() => openZoomImportPicker(session.id)}
              disabled={isImportingSessionId === session.id}
              aria-busy={isImportingSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isImportingSessionId === session.id ? 'Importando Zoom H6' : 'Importar Zoom H6'}
            </button>
            <button
              type="button"
              onClick={() => void exportSession(session)}
              disabled={isExportingSessionId === session.id}
              aria-busy={isExportingSessionId === session.id}
              className="ui-button ui-button-primary disabled:cursor-wait disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {isExportingSessionId === session.id ? 'Exportando' : 'Exportar salida'}
            </button>
            {sessionLatestSpilloverPointAt ? (
              <button
                type="button"
                onClick={() => void splitSessionRecordsFromLatestSpilloverDay(session.id)}
                disabled={isSplittingSessionId === session.id}
                aria-busy={isSplittingSessionId === session.id}
                className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
              >
                <RefreshCw className="h-4 w-4" />
                {isSplittingSessionId === session.id
                  ? 'Separando'
                  : `Separar ${formatDateTime(sessionLatestSpilloverPointAt, "d MMM")}`}
              </button>
            ) : null}
            <IconButton label="Eliminar salida" onClick={() => void removeSession(session.id)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <SummaryStrip
          compact
          className="archive-session-card__summary"
          ariaLabel={`Resumen de ${session.name}`}
          items={sessionSummaryItems}
        />

        <ul className="archive-session-card__status-list" aria-label="Estado de sincronización de la salida">
          {sessionLatestSpilloverPointAt ? (
            <li className="archive-session-card__status-item">
              <span className="archive-session-card__status-label">Mezcla de días</span>
              <span className="archive-session-card__status-value">
                {`${sessionLatestSpilloverPointCount} registro${sessionLatestSpilloverPointCount === 1 ? '' : 's'} del ${formatDateTime(sessionLatestSpilloverPointAt, "d MMM yyyy")}. Puedes separarlos en una salida nueva.`}
              </span>
            </li>
          ) : null}
          <li className="archive-session-card__status-item">
            <span className="archive-session-card__status-label">Nube</span>
            <span className="archive-session-card__status-value">
              {session.cloudSyncedAt
                ? `Último respaldo ${formatDateTime(session.cloudSyncedAt, "d MMM yyyy · HH:mm")}`
                : sessionCloudStatusLabel}
              {session.cloudError ? ` · ${session.cloudError}` : ''}
            </span>
          </li>
          <li className="archive-session-card__status-item">
            <span className="archive-session-card__status-label">Catálogo</span>
            <span className="archive-session-card__status-value">
              {session.catalogSyncedAt
                ? `Último catálogo ${formatDateTime(session.catalogSyncedAt, "d MMM yyyy · HH:mm")}`
                : sessionCatalogStatusLabel}
              {session.catalogError ? ` · ${session.catalogError}` : ''}
            </span>
          </li>
        </ul>

        {session.audioTakes.length > 0 ? (
          <section className="archive-audio-index" aria-labelledby={`archive-audio-index-${session.id}`}>
            <SectionHeader
              titleId={`archive-audio-index-${session.id}`}
              title="Índice de tomas H6"
              description={`${sessionLinkedAudioCount} asociadas · ${sessionUnlinkedAudioCount} sin punto`}
              titleAs="h4"
              compact
            />

            <ul className="archive-audio-index__list">
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
                  <li key={take.id}>
                    <details className="manual-details archive-audio-take">
                      <summary className="manual-details__summary archive-audio-take__summary">
                        <div className="archive-audio-take__main">
                          <div className="archive-audio-take__heading">
                            <div className="archive-audio-take__copy">
                              <p className="eyebrow">Toma H6 · {matchLabel}</p>
                              <p className="archive-audio-take__title">{take.fileName}</p>
                            </div>
                            <span className="telemetry-chip archive-audio-take__point">
                              {linkedPoint ? linkedPoint.placeName : 'Sin punto asociado'}
                            </span>
                          </div>

                          <ul className="archive-audio-take__facts" aria-label={`Resumen de ${take.fileName}`}>
                            <li className="archive-audio-take__fact">
                              {formatDateTime(take.inferredRecordedAt, "d MMM yyyy · HH:mm:ss")}
                            </li>
                            <li className="archive-audio-take__fact">{formatFileSize(take.sizeBytes)}</li>
                            <li className="archive-audio-take__fact">{formatTakeTechnicalSummary(take)}</li>
                            {take.inputSetup ? (
                              <li className="archive-audio-take__fact">{take.inputSetup}</li>
                            ) : null}
                          </ul>
                        </div>

                        <div className="archive-audio-take__side">
                          <span className="manual-details__hint">Editar</span>
                        </div>
                      </summary>

                      <div className="manual-details__body archive-audio-take__body grid gap-4">
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
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  function renderSessionBrowserPanel() {
    return (
      <Card variant="preview" tone="mint" className="dashboard-browser-panel dashboard-support-panel">
        <div className="panel-heading panel-heading--compact">
          <p className="eyebrow">Visibles</p>
          <h3 className="display-heading text-2xl">Trabajos y salidas</h3>
          <p className="module-copy text-sm">Acceso directo a lo ya creado y a la salida activa.</p>
        </div>

        <div className="dashboard-browser-grid dashboard-browser-grid--stacked">
          <section className="dashboard-subsection" aria-labelledby="session-browser-projects-title">
            <SectionHeader
              titleId="session-browser-projects-title"
              title="Trabajos"
              titleAs="h4"
              compact
            />
            {recentProjectGroups.length > 0 ? (
              <StructuredList>
                {recentProjectGroups.map((group) => (
                  <li key={group.key}>
                    <ListRow
                      dense
                      onClick={() => focusArchiveProject(group.key)}
                      eyebrow={group.activeSessionCount > 0 ? 'Trabajo activo' : 'Trabajo'}
                      title={group.name}
                      meta={`${group.sessionCount} salidas · ${group.pointCount} registros · ${group.audioTakeCount} H6${
                        group.activeSessionCount > 0
                          ? ` · ${group.activeSessionCount} activa${group.activeSessionCount === 1 ? '' : 's'}`
                          : ''
                      }`}
                      actionLabel="Abrir trabajo"
                    />
                  </li>
                ))}
              </StructuredList>
            ) : (
              <p className="module-copy text-sm">Todavía no hay trabajos archivados.</p>
            )}
          </section>

          <section className="dashboard-subsection" aria-labelledby="session-browser-sessions-title">
            <SectionHeader
              titleId="session-browser-sessions-title"
              title="Salidas"
              titleAs="h4"
              compact
            />
            {sessions.length > 0 ? (
              <StructuredList>
                {sessions.slice(0, 6).map((session) => (
                  <li key={session.id}>
                    <ListRow
                      dense
                      onClick={() => openSessionWorkspace(session.id)}
                      eyebrow={session.status === 'active' ? 'Activa' : 'Cerrada'}
                      title={session.name}
                      meta={`${resolveProjectName(session.projectName)} · ${session.points.length} registros · ${session.audioTakes.length} H6`}
                      actionLabel={session.status === 'active' ? 'Abrir salida' : 'Ver salida'}
                    />
                  </li>
                ))}
              </StructuredList>
            ) : (
              <p className="module-copy text-sm">No hay salidas creadas todavía.</p>
            )}
          </section>
        </div>
      </Card>
    );
  }

  function renderSessionSearchPanel() {
    return (
      <Card variant="preview" tone="clay" className="dashboard-search-panel dashboard-support-panel">
        <div className="panel-heading panel-heading--compact">
          <p className="eyebrow">Buscar registros</p>
          <h3 className="display-heading text-2xl">Lugar, trabajo o referencia H6</h3>
          <p className="module-copy text-sm">Busca por lugar, trabajo o referencia H6.</p>
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

        <div className="dashboard-search-results">
          {recentRecords.length > 0 ? (
            <StructuredList>
              {recentRecords.map((record) => {
                const badge = resolveSoundscapeBadge(record.point);
                const BadgeIcon = badge.icon;

                return (
                  <li key={`${record.sessionId}:${record.point.id}`}>
                    <ListRow
                      dense
                      onClick={() => openRecordView(record.sessionId, record.point.id)}
                      leadingVisual={<BadgeIcon className="h-4 w-4" />}
                      title={record.point.placeName}
                      meta={`${formatDateTime(record.point.createdAt, "d MMM yyyy · HH:mm")} · ${record.projectName}`}
                      stats={[record.point.soundscapeClassification?.summary || badge.label]}
                    />
                  </li>
                );
              })}
            </StructuredList>
          ) : (
            <p className="module-copy text-sm">
              No hay coincidencias para la búsqueda actual.
            </p>
          )}
        </div>
      </Card>
    );
  }

  function renderSessionMapPanel() {
    return (
      <Card variant="preview" tone="sky" className="dashboard-map-panel dashboard-support-panel">
        <div className="panel-heading panel-heading--compact">
          <p className="eyebrow">Mapa</p>
          <h3 className="display-heading text-2xl">Actividad global</h3>
          <p className="module-copy text-sm">Mapa de salidas y registros.</p>
        </div>

        <p className="dashboard-support-summary">
          {activityClusters.length} zonas · {currentLocationLabel}
        </p>

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
      </Card>
    );
  }

  function renderSessionInsightsPanel() {
    return (
      <Card
        variant="preview"
        emphasis="passive"
        tone="amber"
        className="dashboard-insights-panel dashboard-support-panel dashboard-support-panel--passive"
      >
        <div className="panel-heading panel-heading--compact">
          <p className="eyebrow">Resumen</p>
          <h3 className="display-heading text-2xl">Volumen y pendientes</h3>
          <p className="module-copy text-sm">Resumen del archivo y la sincronización.</p>
        </div>

        <SummaryStrip
          compact
          className="dashboard-insights-summary-strip"
          ariaLabel="Resumen general del archivo"
          items={[
            { label: 'Trabajos', value: projectCount },
            { label: 'Salidas', value: sessions.length },
            { label: 'Fotos', value: totalPhotoCount },
            { label: 'Tomas H6', value: totalAudioTakeCount },
          ]}
        />

        <section className="dashboard-insights-section" aria-labelledby="dashboard-insights-pending-title">
          <SectionHeader
            titleId="dashboard-insights-pending-title"
            title="Pendientes"
            titleAs="h4"
            compact
          />
          <StructuredList>
            <li>
              <ListRow
                dense
                title="Pendiente nube"
                meta="Salidas sin respaldo completo."
                stats={[`${pendingCloudSessionCount}`]}
              />
            </li>
            <li>
              <ListRow
                dense
                title="Pendiente catálogo"
                meta="Salidas aún no visibles en otros dispositivos."
                stats={[`${pendingCatalogSessionCount}`]}
              />
            </li>
            <li>
              <ListRow
                dense
                title="Metadatos"
                meta="Puntos pendientes de clima o lugar."
                stats={[`${pendingEnrichmentCount}`]}
              />
            </li>
            <li>
              <ListRow
                dense
                title="Tomas por asociar"
                meta="Audios H6 todavía sin punto asignado."
                stats={[`${unassignedAudioTakeCount}`]}
              />
            </li>
          </StructuredList>
        </section>

        {recentInsightProjectGroups.length > 0 ? (
          <section className="dashboard-insights-section" aria-labelledby="dashboard-insights-projects-title">
            <SectionHeader
              titleId="dashboard-insights-projects-title"
              title="Trabajos recientes"
              titleAs="h4"
              compact
              actionLabel="Abrir archivo"
              onAction={() => setView('export')}
            />
            <StructuredList>
              {recentInsightProjectGroups.map((group) => (
                <li key={group.key}>
                  <ListRow
                    dense
                    onClick={() => focusArchiveProject(group.key)}
                    title={group.name}
                    meta={`${group.sessionCount} salidas · última salida ${formatDateTime(group.latestStartedAt, "d MMM")}`}
                    stats={[`${group.pointCount} registros`, `${group.audioTakeCount} H6`]}
                    actionLabel="Abrir"
                  />
                </li>
              ))}
            </StructuredList>
          </section>
        ) : (
          <p className="module-copy text-sm">
            Todavía no hay histórico suficiente.
          </p>
        )}
      </Card>
    );
  }

  function renderSessionSupportWorkspace() {
    return (
      <section
        className="dashboard-secondary-workspace dashboard-secondary-workspace--focused"
        aria-labelledby="session-secondary-workspace-title"
      >
        <SectionHeader
          eyebrow="Apoyo"
          titleId="session-secondary-workspace-title"
          title="Apoyo operativo"
          description="Salidas, búsqueda, mapa y estado en una sola banda compacta."
          actionLabel={sessionSupportTab === 'insights' ? 'Abrir archivo' : undefined}
          onAction={sessionSupportTab === 'insights' ? () => setView('export') : undefined}
          compact
        />

        <SegmentedControl
          label="Cambiar área secundaria de salidas"
          value={sessionSupportTab}
          items={[
            { value: 'browser', label: 'Salidas' },
            { value: 'search', label: 'Buscar' },
            { value: 'map', label: 'Mapa' },
            { value: 'insights', label: 'Estado' },
          ]}
          onChange={setSessionSupportTab}
          panelIdBase="session-support"
          size="sm"
          fill={isCompactSessionLayout}
        />

        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`session-support-${sessionSupportTab}`}
            id={`session-support-panel-${sessionSupportTab}`}
            role="tabpanel"
            aria-labelledby={`session-support-tab-${sessionSupportTab}`}
            className="content-swap-panel content-swap-panel--workspace"
            {...contentSwapMotion}
          >
            {sessionSupportTab === 'browser'
              ? renderSessionBrowserPanel()
              : sessionSupportTab === 'search'
                ? renderSessionSearchPanel()
                : sessionSupportTab === 'map'
                  ? renderSessionMapPanel()
                  : renderSessionInsightsPanel()}
          </motion.div>
        </AnimatePresence>
      </section>
    );
  }

  function renderCaptureListenPanel() {
    return (
      <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle listen-panel panel-tone panel-tone--amber">
        <div className="panel-heading">
          <p className="eyebrow">Sección IA</p>
          <h3 className="display-heading text-3xl">Detectar Elementos Del Ambiente</h3>
          <p className="module-copy text-sm">
            Escucha 15 segundos con el micro del dispositivo para estimar pájaros, personas hablando, música, pasos, río, mar, lluvia o tráfico. No guarda el audio y la detección es local y aproximada.
          </p>
        </div>

        <div
          className="classification-card"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-busy={soundscapeStatus === 'listening'}
        >
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
            aria-busy={soundscapeStatus === 'listening'}
            className="ui-button ui-button-secondary"
          >
            <Sparkles className="h-4 w-4" />
            {soundscapeStatus === 'listening' ? 'Analizando...' : 'Volver a detectar'}
          </button>
        </div>
      </div>
    );
  }

  function renderCapturePhotosPanel() {
    return (
      <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle photos-panel panel-tone panel-tone--clay">
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
                  <IconButton label={`Quitar ${photo.fileName}`} onClick={() => removeDraftPhoto(photo.id)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderCaptureExplorePanel() {
    return (
      <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle log-map-panel panel-tone panel-tone--sky">
        <div className="panel-heading">
          <p className="eyebrow">Exploración</p>
          <h3 className="display-heading text-3xl">Mapa y registros previos</h3>
        </div>

        <SegmentedControl
          label="Cambiar vista de exploración"
          value={captureWorkspace}
          items={[
            { value: 'map', label: 'Mapa' },
            { value: 'points', label: 'Lista' },
          ]}
          onChange={setCaptureWorkspace}
          panelIdBase="capture-workspace"
          size="sm"
        />

        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`capture-workspace-${captureWorkspace}`}
            id={`capture-workspace-panel-${captureWorkspace}`}
            role="tabpanel"
            aria-labelledby={`capture-workspace-tab-${captureWorkspace}`}
            className="content-swap-panel content-swap-panel--local"
            {...contentSwapMotion}
          >
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
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  function renderCaptureRecordPreviewPanel() {
    return (
      <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle record-preview-card panel-tone panel-tone--amber">
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
    );
  }

  function renderArchiveBrowserPanel() {
    return (
      <div className="panel surface-level--panel surface-emphasis--panel surface-border--default archive-browser-panel panel-tone panel-tone--mint">
        <div className="panel-heading panel-heading--compact archive-browser-panel__header">
          <p className="eyebrow">Archivo</p>
          <h3 className="display-heading text-3xl">Archivo y salidas</h3>
        </div>

        <p className="archive-browser-panel__selection">
          {currentArchiveProject
            ? `Filtrando por ${currentArchiveProject.name}`
            : 'Mostrando todas las salidas visibles'}
        </p>

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

        <SummaryStrip
          compact
          className="archive-browser-summary"
          ariaLabel="Resumen del archivo filtrado"
          items={archiveBrowserSummaryItems}
        />

        {currentArchiveProject ? (
          canManageSelectedProject ? (
            <details
              className="manual-details archive-project-admin"
              aria-busy={isUpdatingProjectKey === currentArchiveProject.key}
            >
              <summary className="manual-details__summary">
                <div>
                  <p className="eyebrow">Gestionar trabajo</p>
                  <p className="module-copy text-sm">Renombra o limpia la etiqueta del trabajo seleccionado.</p>
                </div>
                <span className="manual-details__hint">Abrir</span>
              </summary>

              <div className="manual-details__body archive-project-admin__body">
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
                    aria-busy={isUpdatingProjectKey === currentArchiveProject.key}
                    className="ui-button ui-button-secondary"
                  >
                    {isUpdatingProjectKey === currentArchiveProject.key ? 'Guardando...' : 'Renombrar trabajo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearProject(currentArchiveProject.key)}
                    disabled={isUpdatingProjectKey === currentArchiveProject.key}
                    aria-busy={isUpdatingProjectKey === currentArchiveProject.key}
                    className="ui-button ui-button-danger"
                  >
                    {isUpdatingProjectKey === currentArchiveProject.key ? 'Actualizando...' : 'Quitar trabajo'}
                  </button>
                </div>
              </div>
            </details>
          ) : (
            <p className="module-copy text-sm archive-browser-note">
              <strong>Sin trabajo</strong> agrupa salidas sin etiqueta.
            </p>
          )
        ) : null}

        <section className="archive-session-browser" aria-labelledby="archive-session-browser-title">
          <SectionHeader
            titleId="archive-session-browser-title"
            title={currentArchiveProject ? 'Salidas del trabajo' : 'Salidas visibles'}
            description={`${visibleArchiveSessions.length} ${visibleArchiveSessions.length === 1 ? 'salida' : 'salidas'} en el filtro actual.`}
            titleAs="h4"
            compact
          />
          {visibleArchiveSessions.length > 0 ? (
            <StructuredList className="archive-session-list">
              {visibleArchiveSessions.map((session) => (
                <li key={session.id}>
                  <ListRow
                    dense
                    onClick={() => {
                      focusArchiveSession(session.id);
                      setIsArchiveBrowserOpen(false);
                    }}
                    className={`archive-session-row ${recordSession?.id === session.id ? 'is-active' : ''}`}
                    eyebrow={session.status === 'active' ? 'Activa ahora' : 'Salida cerrada'}
                    title={session.name}
                    meta={
                      currentArchiveProject
                        ? `${session.region || 'sin zona'} · ${formatDateTime(session.startedAt, "d MMM · HH:mm")}`
                        : `${resolveProjectName(session.projectName)} · ${formatDateTime(session.startedAt, "d MMM · HH:mm")}`
                    }
                    stats={[`${session.points.length} registros`, `${session.audioTakes.length} H6`]}
                    actionLabel={recordSession?.id === session.id ? 'Abierta' : 'Abrir'}
                  />
                </li>
              ))}
            </StructuredList>
          ) : (
            <p className="module-copy text-sm">
              No hay salidas en el filtro actual.
            </p>
          )}
        </section>
      </div>
    );
  }

  function renderArchiveWorkspaceStack() {
    return (
      <div className="archive-detail-stack">
        <div className="panel surface-level--panel surface-emphasis--panel surface-border--default archive-workspace-panel panel-tone panel-tone--sky">
          <div className="archive-workspace-panel__header">
            <div className="archive-workspace-panel__copy">
              <p className="eyebrow">Espacio de trabajo</p>
              <h3 className="display-heading text-3xl">{recordSession?.name ?? 'Sin salida seleccionada'}</h3>
            </div>

            <div className="archive-workspace-panel__controls">
              {isCompactArchiveLayout ? (
                <div className="archive-workspace-panel__primary-actions">
                  <button
                    ref={archiveDrawerTriggerRef}
                    type="button"
                    onClick={() => setIsArchiveBrowserOpen(true)}
                    className="ui-button ui-button-secondary"
                  >
                    <History className="h-4 w-4" />
                    Cambiar salida
                  </button>
                </div>
              ) : null}

              {recordSession ? (
                <ul className="archive-workspace-panel__stats" aria-label="Resumen de la salida abierta">
                  <li>
                    <span className="telemetry-chip">{resolveProjectName(recordSession.projectName)}</span>
                  </li>
                  <li>
                    <span className="telemetry-chip">
                      {recordSession.status === 'active' ? 'Activa ahora' : 'Salida cerrada'}
                    </span>
                  </li>
                  <li>
                    <span className="telemetry-chip">{recordSessionPoints.length} registros</span>
                  </li>
                  <li>
                    <span className="telemetry-chip">{recordSessionAudioLibrary.length} tomas H6</span>
                  </li>
                </ul>
              ) : null}

              <SegmentedControl
                label="Cambiar área del espacio de trabajo"
                value={archiveWorkspace}
                items={[
                  { value: 'session', label: 'Salida' },
                  { value: 'media', label: 'Biblioteca' },
                  { value: 'record', label: 'Registro', disabled: !recordPoint },
                ]}
                onChange={setArchiveWorkspace}
                panelIdBase="archive-workspace"
                size="sm"
                fill={isCompactArchiveLayout}
                className="archive-workspace-switch"
              />
            </div>
          </div>
        </div>

        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`archive-workspace-${archiveWorkspace}`}
            id={`archive-workspace-panel-${archiveWorkspace}`}
            role="tabpanel"
            aria-labelledby={`archive-workspace-tab-${archiveWorkspace}`}
            className="content-swap-panel content-swap-panel--workspace"
            {...contentSwapMotion}
          >
            {archiveWorkspace === 'session'
              ? renderArchiveSessionWorkspace()
              : archiveWorkspace === 'media'
                ? renderArchiveMediaWorkspace()
                : renderArchiveRecordWorkspace()}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  function renderArchiveSessionWorkspace() {
    if (!recordSession) {
      return null;
    }

    const recordSessionSummaryItems = [
      { label: 'Registros', value: recordSessionPoints.length, detail: 'Visibles' },
      { label: 'Fotos', value: recordSessionPhotoLibrary.length, detail: 'En biblioteca' },
      { label: 'Tomas H6', value: recordSessionAudioLibrary.length, detail: 'Importadas' },
      {
        label: 'Estado',
        value: recordSession.status === 'active' ? 'Activa' : 'Cerrada',
        detail: recordSession.region || 'Sin zona',
      },
    ];

    return (
      <div className="archive-session-workspace">
        <div className="panel surface-level--panel surface-emphasis--panel surface-border--default archive-records-panel panel-tone panel-tone--sky">
          <div className="panel-heading">
            <p className="eyebrow">Salida abierta</p>
            <h3 className="display-heading text-3xl">Registros de {recordSession.name}</h3>
            <ul className="record-header-card__context" aria-label="Contexto de la salida visible">
              <li>
                <span className="telemetry-chip">{resolveProjectName(recordSession.projectName)}</span>
              </li>
              <li>
                <span className="telemetry-chip">{recordSession.region || 'Sin zona'}</span>
              </li>
              <li>
                <span className="telemetry-chip">{formatDateTime(recordSession.startedAt, "d MMM yyyy · HH:mm")}</span>
              </li>
            </ul>
          </div>

          <SummaryStrip
            compact
            className="archive-records-panel__summary"
            ariaLabel={`Resumen de ${recordSession.name}`}
            items={recordSessionSummaryItems}
          />

          {recordSessionPoints.length > 0 ? (
            <StructuredList className="archive-point-list" aria-label={`Registros de ${recordSession.name}`}>
              {recordSessionPoints.map((point) => (
                <li key={point.id}>
                  <ListRow
                    onClick={() => openRecordView(recordSession.id, point.id)}
                    leadingVisual={<MapPin className="h-4 w-4" />}
                    eyebrow={formatDateTime(point.createdAt, "d MMM · HH:mm:ss")}
                    title={point.placeName}
                    meta={
                      [
                        point.soundscapeClassification?.summary || null,
                        point.observedWeather || null,
                        point.microphoneSetup || null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Sin clasificación, clima ni setup'
                    }
                    stats={[
                      `${point.photos.length} fotos`,
                      `${recordSession.audioTakes.filter((take) => take.associatedPointId === point.id).length} H6`,
                      point.zoomTakeReference || 'Sin ID H6',
                    ]}
                    actionLabel={point.id === recordPoint?.id ? 'Ficha abierta' : 'Abrir ficha'}
                    dense
                    aria-current={point.id === recordPoint?.id ? 'true' : undefined}
                    className={`archive-point-row ${point.id === recordPoint?.id ? 'is-active' : ''}`}
                  />
                </li>
              ))}
            </StructuredList>
          ) : (
            <p className="module-copy text-sm">Esta salida todavía no tiene registros guardados.</p>
          )}
          <div className="archive-session-workspace__footer">
            {recordPoint ? (
              <button
                type="button"
                onClick={() => setArchiveWorkspace('record')}
                className="ui-button ui-button-primary"
              >
                Abrir ficha del registro
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setArchiveWorkspace('media')}
              className="ui-button ui-button-secondary"
            >
              Ver biblioteca
            </button>
          </div>
        </div>

        <details className="manual-details archive-session-workspace__details">
          <summary className="manual-details__summary">
            <div>
              <p className="eyebrow">Gestión de salida</p>
              <p className="module-copy text-sm">
                Sincronización, exportación y edición de tomas H6 sólo cuando realmente haga falta.
              </p>
            </div>
            <span className="manual-details__hint">Abrir</span>
          </summary>

          <div className="manual-details__body archive-session-workspace__details-body">
            {renderArchiveSessionCard(recordSession)}
          </div>
        </details>
      </div>
    );
  }

  function renderArchiveMediaWorkspace() {
    if (!recordSession) {
      return null;
    }

    return (
      <div className="archive-media-workspace">
        <div className="panel surface-level--panel surface-emphasis--panel surface-border--default archive-media-panel panel-tone panel-tone--amber">
          <div className="panel-heading">
            <p className="eyebrow">Fotos y audio</p>
            <h3 className="display-heading text-3xl">Biblioteca visible de la salida</h3>
            <p className="module-copy text-sm">
              Recorre imágenes y tomas H6 sin abrir todavía la ficha completa del registro.
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
          <div className="archive-media-workspace__footer">
            {recordPoint ? (
              <button
                type="button"
                onClick={() => setArchiveWorkspace('record')}
                className="ui-button ui-button-primary"
              >
                Abrir ficha del registro
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setArchiveWorkspace('session')}
              className="ui-button ui-button-secondary"
            >
              Volver a salida
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderArchiveRecordWorkspace() {
    if (!recordSession) {
      return null;
    }

    if (!recordPoint) {
      return (
        <div className="panel empty-state-card">
          <p className="display-heading text-3xl">Selecciona un registro</p>
          <p className="module-copy text-sm">
            Abre un registro desde la salida o desde la biblioteca para ver su ficha completa, publicarlo o exportarlo.
          </p>
          <div className="action-row">
            <button type="button" onClick={() => setArchiveWorkspace('session')} className="ui-button ui-button-primary">
              Ir a la salida
            </button>
            <button type="button" onClick={() => setArchiveWorkspace('media')} className="ui-button ui-button-secondary">
              Abrir biblioteca
            </button>
          </div>
        </div>
      );
    }

    const recordTagGroups = [
      {
        id: 'soundscape',
        label: 'Etiquetas IA',
        tags: recordPoint.soundscapeClassification?.tags ?? [],
      },
      {
        id: 'manual',
        label: 'Etiquetas manuales',
        tags: recordPoint.tags,
      },
    ].filter((group) => group.tags.length > 0);
    const recordHeaderSummaryItems = [
      {
        label: 'ID H6',
        value: recordPoint.zoomTakeReference || 'Sin ID',
        detail: 'Referencia asociada',
      },
      {
        label: 'Fotos',
        value: recordPoint.photos.length,
        detail: 'Asociadas al punto',
      },
      {
        label: 'Audio',
        value: recordPointAudioOptions.length,
        detail: recordPointAudioOptions.length ? 'Tomas asociadas' : 'Sin toma asociada',
      },
      {
        label: 'Salida',
        value: recordSession.status === 'active' ? 'Activa' : 'Cerrada',
        detail: recordSession.region || 'Sin zona',
      },
    ];
    const recordDefinitionItems = [
      {
        term: 'GPS',
        value: recordPoint.gps.accuracy ? `${Math.round(recordPoint.gps.accuracy)} m` : 'n/d',
        detail: `${recordPoint.gps.lat.toFixed(6)}, ${recordPoint.gps.lon.toFixed(6)}`,
      },
      {
        term: 'Clima',
        value: recordPoint.observedWeather || 'Sin dato',
        detail: recordPoint.automaticWeather?.details || 'Sin detalle automático',
      },
      {
        term: 'IA sonora',
        value: recordPoint.soundscapeClassification?.summary || 'Sin clasificar',
        detail: recordPoint.soundscapeClassification?.details || 'No se ejecutó clasificación pasiva.',
      },
      {
        term: 'Lugar resuelto',
        value: recordPoint.detectedPlace?.placeName || recordPoint.placeName,
        detail: recordPoint.detectedPlace?.context || 'Sin contexto adicional',
      },
      {
        term: 'Micros / setup',
        value: recordPoint.microphoneSetup || 'Sin setup',
        detail: `Referencia H6: ${recordPoint.zoomTakeReference || 'Sin ID'}`,
      },
      {
        term: 'Trabajo',
        value: resolveProjectName(recordSession.projectName),
        detail: recordSession.region || 'Sin región',
      },
    ];

    return (
      <>
        <div className="panel surface-level--panel surface-emphasis--panel surface-border--default record-header-card panel-tone panel-tone--sky">
          <div className="panel-heading">
            <p className="eyebrow">Registro seleccionado</p>
            <h3 className="display-heading text-4xl">{recordPoint.placeName}</h3>
            <ul className="record-header-card__context" aria-label="Contexto del registro">
              <li>
                <span className="telemetry-chip">{recordSession.name}</span>
              </li>
              <li>
                <span className="telemetry-chip">{resolveProjectName(recordSession.projectName)}</span>
              </li>
              <li>
                <span className="telemetry-chip">{formatDateTime(recordPoint.createdAt, "d MMM yyyy · HH:mm:ss")}</span>
              </li>
              {recordPoint.soundscapeClassification?.summary ? (
                <li>
                  <span className="telemetry-chip">{recordPoint.soundscapeClassification.summary}</span>
                </li>
              ) : null}
            </ul>
          </div>

          <SummaryStrip
            compact
            className="record-header-card__summary"
            ariaLabel="Resumen del registro seleccionado"
            items={recordHeaderSummaryItems}
          />

          <div className="action-row action-row--compact record-header-card__actions">
            <button
              type="button"
              onClick={() => void exportSelectedRecordCsv()}
              className="ui-button ui-button-primary"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Exportar CSV
            </button>
            <button
              type="button"
              onClick={() => void exportSelectedRecordKml()}
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

        <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle record-gallery-card panel-tone panel-tone--clay">
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

        <div
          className="panel surface-level--panel surface-emphasis--panel surface-border--default panel-tone panel-tone--amber"
          aria-busy={isPublishingSelection}
        >
          <div className="panel-heading">
            <p className="eyebrow">Selección web</p>
            <h3 className="display-heading text-3xl">Imagen + audio publicables</h3>
            <p className="module-copy text-sm">
              La publicación sube la imagen y la toma H6 elegidas, guarda una selección remota y te deja URLs directas para consumir desde tu web.
            </p>
          </div>

          {recordPointPhotoOptions.length === 0 ? (
            <p className="module-copy text-sm">Este punto no tiene imágenes para publicar.</p>
          ) : recordPointAudioOptions.length === 0 ? (
            <p className="module-copy text-sm">
              Este punto todavía no tiene ninguna toma H6 asociada. Asígnala primero en el índice de tomas.
            </p>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                  <span>Imagen</span>
                  <select
                    value={publishPhotoId}
                    onChange={(event) => setPublishPhotoId(event.target.value)}
                    className="field-input"
                  >
                    {recordPointPhotoOptions.map((photo) => (
                      <option key={photo.id} value={photo.id}>
                        {photo.fileName}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                  <span>Audio</span>
                  <select
                    value={publishAudioTakeId}
                    onChange={(event) => setPublishAudioTakeId(event.target.value)}
                    className="field-input"
                  >
                    {recordPointAudioOptions.map((take) => (
                      <option key={take.id} value={take.id}>
                        {take.fileName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedPublishPhoto?.previewUrl ? (
                <img
                  src={selectedPublishPhoto.previewUrl}
                  alt={selectedPublishPhoto.fileName}
                  className="record-gallery-grid__image"
                />
              ) : null}

              <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                <span>Caption</span>
                <textarea
                  value={publishCaption}
                  onChange={(event) => setPublishCaption(event.target.value)}
                  rows={4}
                  className="field-input min-h-28"
                  placeholder="Texto breve para tu web"
                />
              </label>

              <div className="action-row">
                <button
                  type="button"
                  onClick={() => void publishCurrentSelection()}
                  disabled={isPublishingSelection}
                  aria-busy={isPublishingSelection}
                  className="ui-button ui-button-primary"
                >
                  <Globe className="h-4 w-4" />
                  {isPublishingSelection ? 'Publicando...' : 'Publicar selección'}
                </button>
              </div>

              {publishedSelectionsForPoint.length > 0 ? (
                <div className="grid gap-3">
                  {publishedSelectionsForPoint.slice(0, 3).map((selection) => (
                    <div key={selection.id} className="soft-card">
                      <p className="eyebrow">Publicado {formatDateTime(selection.publishedAt, "d MMM yyyy · HH:mm")}</p>
                      <p className="module-copy text-sm">{selection.caption}</p>
                      <div className="action-row action-row--compact mt-3">
                        <a href={selection.imageUrl} target="_blank" rel="noreferrer" className="ui-button ui-button-secondary">
                          Abrir imagen
                        </a>
                        <a href={selection.audioUrl} target="_blank" rel="noreferrer" className="ui-button ui-button-secondary">
                          Abrir audio
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="panel surface-level--panel surface-emphasis--panel surface-border--default record-metadata-card panel-tone panel-tone--mint">
          <div className="panel-heading">
            <p className="eyebrow">Ficha del registro</p>
            <h3 className="display-heading text-3xl">GPS, clima, notas y etiquetas</h3>
          </div>

          <dl className="record-definition-grid">
            {recordDefinitionItems.map((item) => (
              <div key={item.term} className="record-definition-group">
                <dt>{item.term}</dt>
                <dd className="record-definition-group__value">{item.value}</dd>
                <dd className="record-definition-group__detail">{item.detail}</dd>
              </div>
            ))}
          </dl>

          {recordTagGroups.length > 0 ? (
            <div className="record-tag-groups">
              {recordTagGroups.map((group) => (
                <section key={group.id} className="record-tag-group" aria-label={group.label}>
                  <p className="record-tag-group__label">{group.label}</p>
                  <div className="tag-strip">
                    {group.tags.map((tag) => (
                      <span key={tag} className="tag-pill">
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}

          {recordPoint.notes ? (
            <div className="record-note-block">
              <p className="eyebrow">Notas</p>
              <p className="module-copy text-sm">{recordPoint.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="panel surface-level--panel surface-emphasis--preview surface-border--subtle record-map-card panel-tone panel-tone--sky">
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
      </>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="field-shell fieldnotes-shell">
      <a
        href="#fieldnotes-main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          mainContentRef.current?.focus();
        }}
      >
        Saltar al contenido principal
      </a>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {activeBusyMessage}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusNote}
      </div>
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
        <ShellHeader
          currentViewLabel={currentViewLabel}
          supportText={shellSupportText}
          isSunMode={isSunMode}
          onToggleDisplayMode={() => setDisplayMode(isSunMode ? 'night' : 'sun')}
          isDrawerOpen={isNavDrawerOpen}
          onOpenDrawer={() => setIsNavDrawerOpen(true)}
          menuButtonRef={drawerMenuButtonRef}
        />

        <div
          className={`fieldnotes-tablet-drawer__backdrop ${isNavDrawerOpen ? 'is-open' : ''}`}
          aria-hidden="true"
          onClick={() => setIsNavDrawerOpen(false)}
        />

        <aside
          ref={drawerPanelRef}
          id="fieldnotes-tablet-drawer"
          className={`fieldnotes-tablet-drawer ${isNavDrawerOpen ? 'is-open' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tablet-drawer-nav-title"
          aria-describedby="tablet-drawer-description"
          aria-hidden={!isNavDrawerOpen}
        >
          <p id="tablet-drawer-description" className="sr-only">
            Navegación principal para tablet.
          </p>
          <div className="fieldnotes-tablet-drawer__header">
            <p className="eyebrow">Navegación</p>
            <button
              ref={drawerCloseButtonRef}
              type="button"
              className="icon-button fieldnotes-tablet-drawer__close"
              aria-label="Cerrar navegación"
              onClick={() => setIsNavDrawerOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="fieldnotes-tablet-drawer__content">
            <AppNavigationPanels
              titleId="tablet-drawer-nav-title"
              activeView={view}
              navigationItems={navigationItems}
              onNavigate={() => setIsNavDrawerOpen(false)}
            />
          </div>
        </aside>

        {view === 'export' && isCompactArchiveLayout ? (
          <>
            <div
              className={`archive-browser-drawer__backdrop ${isArchiveBrowserOpen ? 'is-open' : ''}`}
              aria-hidden="true"
              onClick={() => setIsArchiveBrowserOpen(false)}
            />

            <aside
              ref={archiveDrawerPanelRef}
              id="archive-browser-drawer"
              className={`archive-browser-drawer ${isArchiveBrowserOpen ? 'is-open' : ''}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-browser-drawer-title"
              aria-describedby="archive-browser-drawer-description"
              aria-hidden={!isArchiveBrowserOpen}
            >
              <p id="archive-browser-drawer-description" className="sr-only">
                Selector compacto de proyectos y salidas.
              </p>
              <div className="archive-browser-drawer__header">
                <p id="archive-browser-drawer-title" className="eyebrow">Archivo</p>
                <button
                  ref={archiveDrawerCloseButtonRef}
                  type="button"
                  className="icon-button"
                  aria-label="Cerrar archivo"
                  onClick={() => setIsArchiveBrowserOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="archive-browser-drawer__content">
                {renderArchiveBrowserPanel()}
              </div>
            </aside>
          </>
        ) : null}

        <div className="fieldnotes-shell-body">
          {showSidebar ? (
            <aside className="fieldnotes-sidebar" aria-label="Panel lateral">
              <AppNavigationPanels
                titleId="desktop-sidebar-nav-title"
                activeView={view}
                navigationItems={navigationItems}
              />
            </aside>
          ) : null}

          <div className="fieldnotes-workspace">
          <div className="fieldnotes-contextbar">
          {view === 'home' ? (
            <Card
              as={motion.header}
              key="home-topbar"
              variant="hero"
              tone="sky"
              className="home-topbar"
              aria-labelledby="dashboard-home-title"
              aria-describedby="dashboard-home-description"
              {...surfaceEnterMotion}
            >
              <div className="home-topbar__masthead">
                <div className="home-topbar__brand">
                  <p className="eyebrow">{greetingLabel} · trabajo de campo</p>
                  <h1 id="dashboard-home-title" className="display-heading home-topbar__title">{homeLauncherTitle}</h1>
                  <p id="dashboard-home-description" className="module-copy text-sm md:text-base">
                    {homeLauncherCopy}
                  </p>
                  <p className="home-topbar__context-line">{homeOperationalContext}</p>
                </div>

                <div className="home-topbar__controls">
                  <ul className="status-inline-group" aria-label="Estado rápido del resumen">
                    <li>
                      <Badge variant={isOnline ? 'default' : 'offline'}>
                        {isOnline ? 'En línea' : 'Offline'}
                      </Badge>
                    </li>
                    <li>
                      <Badge variant="muted">{storageSummary}</Badge>
                    </li>
                    <li>
                      <Badge variant="muted">{activeSession ? 'Salida activa' : 'Sin salida activa'}</Badge>
                    </li>
                  </ul>
                  <div className="utility-inline-group">
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
              </div>

              <ul className="home-operational-facts" aria-label="Estado inmediato de la jornada">
                {homeOperationalFacts.map((fact) => (
                  <li key={fact.id} className="home-operational-fact">
                    <span className="home-operational-fact__label">{fact.label}</span>
                    <strong className="home-operational-fact__value">{fact.value}</strong>
                  </li>
                ))}
              </ul>

              <div className="home-topbar__actions" role="group" aria-label="Acciones principales del inicio">
                <Button
                  variant="primary"
                  onClick={() => setView(activeSession ? 'point' : 'session')}
                  className="home-topbar__primary-action"
                  leadingIcon={<Mic className="h-4 w-4" />}
                >
                  {homePrimaryActionLabel}
                </Button>
                <div className="home-topbar__support-actions">
                  <Button
                    variant="secondary"
                    onClick={() => activeSession ? openSessionWorkspace(activeSession.id) : setView('session')}
                    leadingIcon={<MapPinned className="h-4 w-4" />}
                  >
                    {homeSessionActionLabel}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setView('export')}
                    leadingIcon={<History className="h-4 w-4" />}
                  >
                    {homeArchiveActionLabel}
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card
              as={motion.header}
              key={`section-${view}`}
              variant="panel"
              className="section-header"
              {...surfaceEnterMotion}
            >
              <div className="section-header__copy">
                <p className="eyebrow">{currentViewLabel}</p>
                <h1 className="display-heading text-3xl md:text-5xl">{currentViewTitle}</h1>
                <p className="module-copy text-sm md:text-base">{currentViewDescription}</p>
              </div>

              <div className="section-header__rail">
                <ul className="section-header__meta" aria-label="Estado de la vista actual">
                  <li>
                    <Badge variant={isOnline ? 'default' : 'offline'}>
                      {isOnline ? 'En línea' : 'Offline'}
                    </Badge>
                  </li>
                  <li>
                    <Badge variant="muted">{storageSummary}</Badge>
                  </li>
                </ul>
                <div className="section-header__utility">
                  <Button variant="ghost" onClick={() => setView('home')} leadingIcon={<House className="h-4 w-4" />}>
                    Inicio
                  </Button>
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
            </Card>
          )}
          </div>

          <main
            ref={mainContentRef}
            id="fieldnotes-main-content"
            className="fieldnotes-main"
            aria-label="Contenido principal"
            tabIndex={-1}
          >

          {shouldShowStatusStack ? (
            <section className="status-stack" aria-label="Avisos operativos">
              {shouldShowOperationalBanner ? (
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={`${statusTone}:${statusNote}`}
                    className="status-stack__item"
                    {...contentSwapMotion}
                  >
                    <Card variant="state" className={`status-banner ${operationalStatusMeta.className}`}>
                      <div className="status-banner__header">
                        <span className="status-banner__icon" aria-hidden="true">
                          <OperationalStatusIcon className="h-4 w-4" />
                        </span>
                        <div className="status-banner__copy">
                          <p className="eyebrow">{operationalStatusMeta.eyebrow}</p>
                          <p className="module-copy text-sm">{statusNote}</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                </AnimatePresence>
              ) : null}
              {!isOnline ? (
                <Card variant="state" border="strong" className="status-banner status-banner--warning">
                  <p className="eyebrow">Conectividad</p>
                  <p className="module-copy text-sm">
                    Estás sin red. GPS, notas, fotos y guardado siguen activos; clima y lugar se completarán cuando vuelva la conexión.
                  </p>
                </Card>
              ) : null}
              {isCatalogApiUnavailable ? (
                <Card variant="state" border="strong" className="status-banner status-banner--warning">
                  <p className="eyebrow">Catálogo remoto</p>
                  <p className="module-copy text-sm">
                    Las rutas `/api/catalog` no están disponibles aquí. El guardado local y las exportaciones siguen funcionando, pero la sincronización remota queda desactivada.
                  </p>
                </Card>
              ) : null}
              {storageMode === 'memory-only' ? (
                <Card variant="state" border="strong" className="status-banner status-banner--warning">
                  <p className="eyebrow">Almacenamiento</p>
                  <p className="module-copy text-sm">
                    No hay acceso al archivo local. La salida funciona, pero conviene exportar o reiniciar el almacenamiento antes de cerrar la app.
                  </p>
                </Card>
              ) : null}
              {appError ? (
                <ErrorState
                  compact
                  eyebrow="Aviso"
                  title="No pude completar la acción"
                  description={appError}
                />
              ) : null}
            </section>
          ) : null}

          <AnimatePresence mode="wait">
            {view === 'home' ? (
              <motion.section
                key="home"
                className="layout-home layout-home--focused"
                {...viewTransitionMotion}
              >
                <Card
                  as="section"
                  variant="panel"
                  tone="sky"
                  border="strong"
                  className="home-session-overview"
                  aria-labelledby="home-session-overview-title"
                  aria-describedby={activeSession ? 'home-recent-records-description' : 'home-session-overview-description'}
                >
                  <SectionHeader
                    eyebrow={activeSession ? 'Captura en curso' : 'Siguiente paso'}
                    titleId="home-session-overview-title"
                    descriptionId={activeSession ? 'home-recent-records-description' : 'home-session-overview-description'}
                    title={activeSession ? 'Últimos registros' : 'No hay una salida activa'}
                    description={
                      activeSession
                        ? homeRecentRecordsDescription
                        : 'Crea o retoma una salida antes de capturar. El historial y la media viven en sus propias vistas.'
                    }
                    actionLabel={activeSession ? 'Ir a captura' : undefined}
                    onAction={activeSession ? () => setView('point') : undefined}
                  />

                  {activeSession ? (
                    <>
                      <div className="home-session-overview__summaryline" aria-label="Resumen compacto de la salida actual">
                        {homeSessionSummaryItems.map((item) => (
                          <div key={item.label} className="home-session-overview__summarystat">
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>

                      {renderActiveRoutePlanCard('home')}

                      {latestActivePoints.length > 0 ? (
                        <section
                          className="home-session-overview__records"
                          aria-labelledby="home-recent-records-title"
                          aria-describedby="home-recent-records-description"
                        >
                          <p id="home-recent-records-title" className="sr-only">Últimos registros</p>
                          <StructuredList>
                            {latestActivePoints.map((point) => {
                              const hasLinkedAudio =
                                activeSession.audioTakes.some((take) => take.associatedPointId === point.id) ?? false;

                              return (
                                <li key={point.id}>
                                  <ListRow
                                    dense
                                    onClick={() => openRecordView(activeSession.id, point.id)}
                                    title={point.placeName}
                                    meta={
                                      <>
                                        {formatDateTime(point.createdAt, "d MMM · HH:mm")} ·{' '}
                                        {point.soundscapeClassification?.summary || point.observedWeather || 'Sin resumen'}
                                      </>
                                    }
                                    stats={[
                                      `${point.photos.length} foto${point.photos.length === 1 ? '' : 's'}`,
                                      hasLinkedAudio ? 'H6 asociado' : 'Sin H6',
                                    ]}
                                    actionLabel="Abrir"
                                  />
                                </li>
                              );
                            })}
                          </StructuredList>
                        </section>
                      ) : (
                        <EmptyState
                          eyebrow="Salida"
                          title="La salida está lista, pero aún no hay registros"
                          description="Entra en captura y guarda el primer punto. Después podrás revisar el material desde archivo."
                          icon={<Mic className="h-5 w-5" />}
                          action={
                            <Button variant="secondary" onClick={() => setView('point')}>
                              Ir a captura
                            </Button>
                          }
                          compact
                        />
                      )}

                      <div className="home-session-overview__footer">
                        <Button
                          variant="secondary"
                          onClick={() => setView('point')}
                          leadingIcon={<Mic className="h-4 w-4" />}
                        >
                          Registrar punto
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setView('export')}
                          leadingIcon={<History className="h-4 w-4" />}
                        >
                          Abrir archivo
                        </Button>
                      </div>
                    </>
                  ) : (
                    <EmptyState
                      eyebrow="Salida"
                      title="Prepara una salida antes de capturar"
                      description="Cuando abras una salida, esta vista se quedará sólo con el contexto operativo y los últimos registros."
                      icon={<MapPinned className="h-5 w-5" />}
                      action={
                        <Button variant="secondary" onClick={() => setView('session')}>
                          Preparar salida
                        </Button>
                      }
                    />
                  )}
                </Card>
              </motion.section>
            ) : null}

            {view === 'session' ? (
              <motion.section
                key="panel"
                className="layout-dashboard layout-dashboard--focused"
                {...viewTransitionMotion}
              >
                <Card variant="hero" tone="sky" className="dashboard-session-panel">
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
                        Define la salida y deja el contexto listo antes de empezar.
                      </p>
                    )}
                  </div>

                  {activeSession ? (
                    <>
                      {activeSessionDateWarning ? (
                        <div className="capture-alert capture-alert--warning mb-4">
                          <TriangleAlert className="h-4 w-4" />
                          <div>{activeSessionDateWarning}</div>
                        </div>
                      ) : null}

                      <SummaryStrip
                        compact
                        className="dashboard-session-summary-strip"
                        ariaLabel="Resumen de la salida activa"
                        items={[
                          {
                            label: 'Registros',
                            value: activeSession.points.length,
                          },
                          {
                            label: 'Fotos',
                            value: activeSessionPhotoCount,
                          },
                          {
                            label: 'Tomas H6',
                            value: activeSession.audioTakes.length,
                          },
                          {
                            label: 'Pendientes',
                            value: totalOperationalPendingCount,
                            detail: operationalPendingSummary,
                          },
                        ]}
                      />

                      {renderActiveRoutePlanCard('session')}

                      <div className="dashboard-session-panel__actions">
                        <div className="action-row dashboard-session-panel__actions-main">
                          <button type="button" onClick={() => setView('point')} className="ui-button ui-button-primary">
                            <Mic className="h-4 w-4" />
                            Ir a captura
                          </button>
                          <button
                            type="button"
                            onClick={() => openZoomImportPicker(activeSession.id)}
                            className="ui-button ui-button-secondary"
                          >
                            <AudioWaveform className="h-4 w-4" />
                            Importar Zoom H6
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
                          {activeSessionLatestSpilloverPointAt ? (
                            <button
                              type="button"
                              onClick={() => void splitSessionRecordsFromLatestSpilloverDay(activeSession.id)}
                              disabled={isSplittingSessionId === activeSession.id}
                              aria-busy={isSplittingSessionId === activeSession.id}
                              className="ui-button ui-button-secondary"
                            >
                              <RefreshCw className="h-4 w-4" />
                              {isSplittingSessionId === activeSession.id
                                ? 'Separando...'
                                : `Separar ${formatDateTime(activeSessionLatestSpilloverPointAt, "d MMM")}`}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void closeActiveSessionAndPrepareNext()}
                            className="ui-button ui-button-secondary"
                          >
                            <RefreshCw className="h-4 w-4" />
                            Cerrar y nueva salida
                          </button>
                        </div>
                        <div className="action-row action-row--compact dashboard-session-panel__actions-danger">
                          <button type="button" onClick={() => void closeActiveSession()} className="ui-button ui-button-danger">
                            Cerrar salida
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="session-draft-shell">
                        <div className="session-draft-main">
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
                              <span className="text-xs text-[color:var(--muted)]">
                                La app recuerda el último trabajo usado y lo propone en las siguientes salidas.
                              </span>
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
                          <section className="session-draft-route" aria-labelledby="session-draft-route-title">
                            <div className="session-draft-route__header">
                              <p className="eyebrow">Ruta opcional</p>
                              <h4 id="session-draft-route-title" className="session-draft-context__title">
                                Programa la llegada antes de salir
                              </h4>
                              <p className="module-copy text-sm">
                                Pega tu enlace de Maps y define el punto de llegada para que la captura quede lista al entrar en la zona.
                              </p>
                            </div>

                            <label className="grid gap-2 text-sm panel-primary-label">
                              <span>Enlace de navegación</span>
                              <input
                                value={sessionDraft.routeUrl}
                                onChange={(event) =>
                                  setSessionDraft((previous) => ({ ...previous, routeUrl: event.target.value }))
                                }
                                className="field-input"
                                placeholder="https://maps.app.goo.gl/..."
                                inputMode="url"
                              />
                            </label>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="grid gap-2 text-sm panel-primary-label">
                                <span>Nombre del destino</span>
                                <input
                                  value={sessionDraft.routeDestinationLabel}
                                  onChange={(event) =>
                                    setSessionDraft((previous) => ({
                                      ...previous,
                                      routeDestinationLabel: event.target.value,
                                    }))
                                  }
                                  className="field-input"
                                  placeholder="Miradoiro de Mesa de Montes"
                                />
                              </label>
                              <label className="grid gap-2 text-sm panel-primary-label">
                                <span>Radio de llegada (m)</span>
                                <input
                                  value={sessionDraft.routeArrivalRadiusMeters}
                                  onChange={(event) =>
                                    setSessionDraft((previous) => ({
                                      ...previous,
                                      routeArrivalRadiusMeters: event.target.value,
                                    }))
                                  }
                                  className="field-input"
                                  placeholder={String(DEFAULT_ROUTE_ARRIVAL_RADIUS_METERS)}
                                  inputMode="numeric"
                                />
                              </label>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="grid gap-2 text-sm panel-primary-label">
                                <span>Latitud destino</span>
                                <input
                                  value={sessionDraft.routeLatitude}
                                  onChange={(event) =>
                                    setSessionDraft((previous) => ({ ...previous, routeLatitude: event.target.value }))
                                  }
                                  className="field-input"
                                  placeholder="42.284685"
                                  inputMode="decimal"
                                />
                              </label>
                              <label className="grid gap-2 text-sm panel-primary-label">
                                <span>Longitud destino</span>
                                <input
                                  value={sessionDraft.routeLongitude}
                                  onChange={(event) =>
                                    setSessionDraft((previous) => ({ ...previous, routeLongitude: event.target.value }))
                                  }
                                  className="field-input"
                                  placeholder="-8.791661"
                                  inputMode="decimal"
                                />
                              </label>
                            </div>

                            <div className="action-row action-row--compact">
                              <button
                                type="button"
                                onClick={() => void applyCurrentGpsToRouteDestination()}
                                className="ui-button ui-button-secondary"
                              >
                                <LocateFixed className="h-4 w-4" />
                                Usar GPS actual
                              </button>
                            </div>

                            <label className="session-draft-toggle">
                              <input
                                type="checkbox"
                                checked={sessionDraft.armCaptureOnArrival}
                                onChange={(event) =>
                                  setSessionDraft((previous) => ({
                                    ...previous,
                                    armCaptureOnArrival: event.target.checked,
                                  }))
                                }
                              />
                              <span className="session-draft-toggle__label">Armar captura al llegar</span>
                              <small className="session-draft-toggle__copy">
                                Si el GPS entra en el radio, la app marcará la llegada y dejará la captura lista para activarla.
                              </small>
                            </label>

                            <p className="module-copy text-sm">{sessionDraftRouteHint}</p>
                          </section>
                        </div>

                        <aside className="session-draft-context" aria-label="Contexto rápido antes de salir">
                          <p className="eyebrow">Antes de salir</p>
                          <h4 className="session-draft-context__title">La app ya te deja esto orientado</h4>
                          <ul className="session-draft-context__facts">
                            {sessionDraftSupportItems.map((item) => (
                              <li key={item.id} className="session-draft-context__fact">
                                <span className="session-draft-context__label">{item.label}</span>
                                <strong className="session-draft-context__value">{item.value}</strong>
                              </li>
                            ))}
                          </ul>
                          <p className="module-copy text-sm">{sessionDraftSupportCopy}</p>
                        </aside>
                      </div>

                      <div className="action-row session-draft-actions">
                        <button type="button" onClick={createSession} className="ui-button ui-button-primary">
                          Iniciar salida
                        </button>
                      </div>
                    </>
                  )}
                </Card>

                {renderSessionSupportWorkspace()}
              </motion.section>
            ) : null}

            {view === 'point' ? (
              <motion.section
                key="log"
                className="layout-log"
                {...viewTransitionMotion}
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
                    <div
                      className="panel surface-level--panel surface-emphasis--hero surface-border--strong panel-primary log-summary-card panel-tone panel-tone--sky"
                      aria-busy={
                        isQuickCapturing ||
                        soundscapeStatus === 'listening' ||
                        locationStatus === 'loading' ||
                        weatherStatus === 'loading'
                      }
                    >
                      <div className="panel-heading panel-heading--inverse">
                        <p className="eyebrow eyebrow-inverse">Registro activo</p>
                        <h3 className="display-heading text-3xl panel-primary-title">{activeSessionProjectName}</h3>
                        <ul className="capture-context-chips" aria-label="Contexto del registro activo">
                          <li>
                            <span className="telemetry-chip">{activeSession.name}</span>
                          </li>
                          <li>
                            <span className="telemetry-chip">{activeSession.region || 'zona sin definir'}</span>
                          </li>
                          <li>
                            <span className={`telemetry-chip ${isOnline ? '' : 'telemetry-chip--offline'}`}>
                              {isOnline ? 'En línea' : 'Offline'}
                            </span>
                          </li>
                        </ul>
                      </div>

                      {activeSessionDateWarning ? (
                        <div className="capture-status-stack" aria-label="Avisos de antigüedad de la salida">
                          <div className="capture-alert capture-alert--warning">
                            <TriangleAlert className="h-4 w-4" />
                            <div>{activeSessionDateWarning}</div>
                          </div>
                        </div>
                      ) : null}

                      {!isOnline || storageMode === 'memory-only' ? (
                        <div className="capture-status-stack" aria-label="Avisos del registro activo">
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
                        </div>
                      ) : null}

                      <SummaryStrip
                        compact
                        className="capture-status-summary"
                        ariaLabel="Estado automático de captura"
                        items={captureStatusSummaryItems}
                      />

                      <div className="capture-readiness-strip" aria-label="Preparación del registro">
                        <div className="capture-readiness-strip__header">
                          <p className="eyebrow eyebrow-inverse">Preparación rápida</p>
                          <span className="capture-readiness-strip__count">{captureReadinessLabel}</span>
                        </div>
                        <ul className="capture-readiness-strip__list">
                          {captureReadinessItems.map((item) => (
                            <li key={item.label}>
                              <span className={`capture-readiness-pill ${item.ready ? 'is-ready' : ''}`}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="capture-quick-tools" role="group" aria-label="Acciones rápidas del registro">
                        <button
                          type="button"
                          onClick={() => void addQuickPointToSession()}
                          className="ui-button ui-button-primary"
                          disabled={isQuickCapturing}
                          aria-busy={isQuickCapturing}
                        >
                          <Mic className="h-4 w-4" />
                          {isQuickCapturing ? 'Guardando...' : 'Guardar registro rápido'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void listenAndClassifySoundscape()}
                          disabled={soundscapeStatus === 'listening'}
                          aria-busy={soundscapeStatus === 'listening'}
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

                      <div className="capture-maintenance-tools" aria-label="Acciones de mantenimiento del contexto">
                        <p className="capture-toolbar-label">Actualización manual</p>
                        <div className="action-row action-row--compact capture-maintenance-tools__actions">
                          <button type="button" onClick={() => void activateGpsAndApplyToDraft()} className="ui-button ui-button-ghost">
                            <LocateFixed className="h-4 w-4" />
                            Activar GPS
                          </button>
                          <button
                            type="button"
                            onClick={refreshDetectedPlace}
                            disabled={!canRefreshDetectedPlace}
                            aria-busy={locationStatus === 'loading'}
                            className="ui-button ui-button-ghost"
                          >
                            <MapPin className="h-4 w-4" />
                            Releer ubicación
                          </button>
                          <button
                            type="button"
                            onClick={refreshAutomaticWeather}
                            disabled={!canRefreshWeather || weatherStatus === 'loading'}
                            aria-busy={weatherStatus === 'loading'}
                            className="ui-button ui-button-ghost"
                          >
                            <CloudRain className={`h-4 w-4 ${weatherStatus === 'loading' ? 'busy-spin' : ''}`} />
                            Actualizar clima
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="panel surface-level--panel surface-emphasis--panel surface-border--default log-form-card panel-tone panel-tone--mint">
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

                    {isCompactCaptureLayout ? (
                      <section className="capture-secondary-workspace" aria-labelledby="capture-secondary-workspace-title">
                        <SectionHeader
                          eyebrow="Herramientas"
                          titleId="capture-secondary-workspace-title"
                          title="IA, fotos y exploración"
                          description="En compacto, las herramientas secundarias se alternan en una sola superficie para que la captura siga sintiéndose rápida."
                        />

                        <SegmentedControl
                          label="Cambiar herramienta secundaria de captura"
                          value={captureSupportTab}
                          items={[
                            { value: 'map', label: 'Mapa' },
                            { value: 'photos', label: 'Fotos', count: draftPhotos.length },
                            { value: 'ai', label: 'IA' },
                            { value: 'record', label: 'Último' },
                          ]}
                          onChange={setCaptureSupportTab}
                          panelIdBase="capture-support"
                          size="sm"
                          fill
                        />

                        <AnimatePresence initial={false} mode="wait">
                          <motion.div
                            key={`capture-support-${captureSupportTab}`}
                            id={`capture-support-panel-${captureSupportTab}`}
                            role="tabpanel"
                            aria-labelledby={`capture-support-tab-${captureSupportTab}`}
                            className="content-swap-panel content-swap-panel--workspace"
                            {...contentSwapMotion}
                          >
                            {captureSupportTab === 'map'
                              ? renderCaptureExplorePanel()
                              : captureSupportTab === 'photos'
                                ? renderCapturePhotosPanel()
                                : captureSupportTab === 'ai'
                                  ? renderCaptureListenPanel()
                                  : renderCaptureRecordPreviewPanel()}
                          </motion.div>
                        </AnimatePresence>
                      </section>
                    ) : (
                      <>
                        {renderCaptureListenPanel()}
                        {renderCapturePhotosPanel()}
                        {renderCaptureExplorePanel()}
                        {renderCaptureRecordPreviewPanel()}
                      </>
                    )}
                  </>
                )}
              </motion.section>
            ) : null}

            {view === 'export' ? (
              <motion.section
                key="record"
                className="layout-record"
                {...viewTransitionMotion}
              >
                {!recordSession ? (
                  <div className="panel empty-state-card">
                    <p className="display-heading text-3xl">Todavía no hay salidas archivadas</p>
                    <p className="module-copy text-sm">
                      Abre una salida desde el navegador lateral para entrar en su espacio de trabajo y revisar registros, biblioteca o ficha completa.
                    </p>
                    {isCompactArchiveLayout && sessions.length > 0 ? (
                      <div className="action-row">
                        <button
                          ref={archiveDrawerTriggerRef}
                          type="button"
                          onClick={() => setIsArchiveBrowserOpen(true)}
                          className="ui-button ui-button-primary"
                        >
                          <History className="h-4 w-4" />
                          Abrir archivo
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <>
                    {!isCompactArchiveLayout ? renderArchiveBrowserPanel() : null}
                    {renderArchiveWorkspaceStack()}
                  </>
                )}
              </motion.section>
            ) : null}
          </AnimatePresence>
          </main>
        </div>
        </div>

        {showMobileDock ? (
          <nav className="menu-shell mobile-dock" aria-label="Navegación principal móvil">
            <ul className="mobile-dock__list">
              {navigationItems.map((item) => (
                <li
                  key={item.view}
                  className={`mobile-dock__item ${item.view === 'point' ? 'mobile-dock__item--capture' : ''}`}
                >
                  <ViewButton
                    active={view === item.view}
                    label={item.label}
                    description={item.description}
                    icon={item.icon}
                    compact
                    priority={item.view === 'point'}
                    onClick={item.onClick}
                  />
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>

      </div>
    </MotionConfig>
  );
}
