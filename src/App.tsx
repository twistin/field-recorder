import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CloudSun,
  Download,
  House,
  Upload,
  History,
  MapPin,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { v4 as uuidv4 } from 'uuid';

import { SessionMap } from './components/SessionMap';
import { SessionPointCard } from './components/SessionPointCard';
import {
  deleteFieldSession,
  listFieldSessions,
  saveFieldSession,
} from './lib/fieldSessionsDb';
import { exportFieldSessionPackage } from './lib/exportFieldSession';
import { reverseGeocodePlace } from './lib/locationLookup';
import { fetchAutomaticWeather } from './lib/weather';
import {
  autoMatchAudioTake,
  buildImportedAudioTakes,
  mergeSessionAudioTakes,
  reconcileSessionAudioTakes,
} from './lib/zoomImport';
import { syncSessionToCloud } from './lib/cloudSync';
import { syncSessionToCatalog } from './lib/catalogSync';
import type {
  AutomaticWeatherSummary,
  DetectedPlaceSummary,
  FieldSession,
  GpsCoordinates,
  SessionAudioTake,
  SessionPhoto,
  SessionPoint,
} from './types/fieldSessions';

type View = 'session' | 'point' | 'export';

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
  previewUrl: string;
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

function formatDateTime(value: Date | string, pattern: string) {
  return format(typeof value === 'string' ? new Date(value) : value, pattern, { locale: es });
}

function resolveProjectName(projectName: string): string {
  return projectName.trim() || 'Sin proyecto';
}

function buildProjectKey(projectName: string): string {
  return resolveProjectName(projectName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'sin-proyecto';
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
    audioTakes: (session.audioTakes ?? []).map(normalizeAudioTake),
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

function hydrateSession(session: FieldSession): UiFieldSession {
  const normalizedSession = normalizeFieldSession(session);
  return {
    ...normalizedSession,
    points: normalizedSession.points.map((point) => ({
      ...point,
      photos: point.photos.map((photo) => ({
        ...photo,
        previewUrl: URL.createObjectURL(photo.blob),
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
      URL.revokeObjectURL(photo.previewUrl);
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
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`dock-button ${active ? 'is-active' : ''}`}
    >
      <span className="dock-button__icon">
        <Icon className="h-4 w-4" />
      </span>
      <span className="dock-button__label">{label}</span>
    </button>
  );
}

export default function App() {
  const [view, setView] = useState<View>('session');
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(buildSessionDraft());
  const [pointDraft, setPointDraft] = useState<PointDraft>(buildPointDraft());
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([]);
  const [sessions, setSessions] = useState<UiFieldSession[]>([]);
  const [selectedArchiveProjectKey, setSelectedArchiveProjectKey] = useState<'all' | string>('all');
  const [captureWorkspace, setCaptureWorkspace] = useState<'map' | 'points'>('map');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
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
  const [statusNote, setStatusNote] = useState('Inicia una sesión y ve registrando puntos con GPS, clima, notas y fotos.');
  const [appError, setAppError] = useState<string | null>(null);
  const [isExportingSessionId, setIsExportingSessionId] = useState<string | null>(null);
  const [isQuickCapturing, setIsQuickCapturing] = useState(false);
  const [isImportingSessionId, setIsImportingSessionId] = useState<string | null>(null);
  const [isSyncingPendingMetadata, setIsSyncingPendingMetadata] = useState(false);
  const [isSyncingCloudSessionId, setIsSyncingCloudSessionId] = useState<string | null>(null);
  const [isSyncingCatalogSessionId, setIsSyncingCatalogSessionId] = useState<string | null>(null);
  const [zoomImportTargetSessionId, setZoomImportTargetSessionId] = useState<string | null>(null);

  const currentGpsRef = useRef<GpsCoordinates | null>(null);
  const sessionsRef = useRef<UiFieldSession[]>([]);
  const draftPhotosRef = useRef<DraftPhoto[]>([]);
  const zoomImportInputRef = useRef<HTMLInputElement | null>(null);
  const isSyncingPendingMetadataRef = useRef(false);
  const isSyncingCloudSessionIdRef = useRef<string | null>(null);
  const isSyncingCatalogSessionIdRef = useRef<string | null>(null);
  const locationAbortRef = useRef<AbortController | null>(null);
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
    if (selectedArchiveProjectKey === 'all') {
      return;
    }

    if (!archiveProjectGroups.some((group) => group.key === selectedArchiveProjectKey)) {
      setSelectedArchiveProjectKey('all');
    }
  }, [archiveProjectGroups, selectedArchiveProjectKey]);

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
        setActiveSessionId(activeStoredSession?.id ?? hydrated[0]?.id ?? null);
        setStorageMode('ready');
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Loading sessions failed:', error);
        setStorageMode('memory-only');
        setStatusNote('No se pudo abrir el archivo local. La sesión actual quedará sólo en memoria.');
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
      setStatusNote('Falló la escritura local. La sesión seguirá en memoria hasta recargar.');
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

  function buildPointFromDraft(
    createdAt: string,
    coordinates: GpsCoordinates,
    options?: {
      automaticWeather?: AutomaticWeatherSummary | null;
      detectedPlace?: DetectedPlaceSummary | null;
      photos?: UiSessionPhoto[];
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
      tags: normalizeTags(pointDraft.tagsText),
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
    setStatusNote('Sesión iniciada. Empieza a registrar puntos de escucha.');
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
    setStatusNote(`Sesión "${nextSession.name}" cerrada y lista para exportación.`);
    setView('export');
  }

  async function addPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una sesión activa antes de registrar puntos.');
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
    });
    const nextPoints = [point, ...activeSession.points];

    const nextSession: UiFieldSession = {
      ...activeSession,
      points: nextPoints,
      audioTakes: reconcileSessionAudioTakes(nextPoints, activeSession.audioTakes),
    };

    await persistSession(nextSession);
    setSelectedPointId(point.id);
    setAppError(null);
    setStatusNote(`Punto "${point.placeName}" guardado dentro de la sesión.`);
    resetPointDraft(activeSession.equipmentPreset);
  }

  async function addQuickPointToSession() {
    if (!activeSession || activeSession.status !== 'active') {
      setAppError('Necesitas una sesión activa antes de registrar un punto rápido.');
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
      });
      const nextPoints = [point, ...activeSession.points];

      const nextSession: UiFieldSession = {
        ...activeSession,
        points: nextPoints,
        audioTakes: reconcileSessionAudioTakes(nextPoints, activeSession.audioTakes),
      };

      await persistSession(nextSession);
      setSelectedPointId(point.id);
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
    setStatusNote('Punto eliminado de la sesión activa.');
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

    if (storageMode === 'ready') {
      try {
        await deleteFieldSession(sessionId);
      } catch (error) {
        console.error('Deleting session failed:', error);
        setAppError('La sesión desapareció de la vista, pero no se pudo borrar del archivo.');
      }
    }
  }

  async function exportSession(session: UiFieldSession) {
    setIsExportingSessionId(session.id);
    setAppError(null);

    try {
      await exportFieldSessionPackage(dehydrateSession(session));
      setStatusNote(`Sesión "${session.name}" exportada.`);
    } catch (error) {
      console.error('Export session failed:', error);
      setAppError('No se pudo exportar la sesión.');
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
      setAppError('Necesitas conexión para respaldar la sesión en Vercel Blob.');
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
      setStatusNote(`Sesión "${nextUiSession.name}" respaldada en la nube.`);
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

    if (!isOnline) {
      setAppError('Necesitas conexión para sincronizar la sesión con el catálogo remoto.');
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
      const nextUiSession: UiFieldSession = {
        ...syncingSession,
        catalogSyncStatus: 'synced',
        catalogSyncedAt: catalogResult.syncedAt,
        catalogError: null,
      };
      await persistSession(nextUiSession, { markCloudPending: false, markCatalogPending: false });
      setStatusNote(`Sesión "${nextUiSession.name}" sincronizada con el catálogo remoto.`);
    } catch (error) {
      console.error('Catalog sync failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo sincronizar el catálogo remoto.';
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
      setStatusNote('No hay sesiones pendientes de respaldo.');
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
      setStatusNote('No hay sesiones pendientes de catálogo remoto.');
      return;
    }

    for (const session of pendingSessions) {
      await syncSessionToCatalogStore(session.id);
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
          `Sincronizados ${updatedPoints} puntos pendientes en ${updatedSessions} sesión${updatedSessions === 1 ? '' : 'es'}.`,
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
    await updateSessionAudioTake(sessionId, takeId, (take, session) =>
      autoMatchAudioTake(
        {
          ...take,
          matchedBy: 'unmatched',
          associatedPointId: null,
          matchedPointDeltaMinutes: null,
        },
        session.points,
      ),
    );
  }

  function openZoomImportPicker(sessionId: string) {
    setZoomImportTargetSessionId(sessionId);
    zoomImportInputRef.current?.click();
  }

  async function handleZoomImportInput(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []) as File[];
    const sessionId = zoomImportTargetSessionId;
    event.target.value = '';

    if (!sessionId || files.length === 0) {
      setZoomImportTargetSessionId(null);
      return;
    }

    const session = sessionsRef.current.find((entry) => entry.id === sessionId);
    if (!session) {
      setZoomImportTargetSessionId(null);
      setAppError('No encontré la sesión destino para importar las tomas.');
      return;
    }

    setIsImportingSessionId(sessionId);
    setAppError(null);

    try {
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
      setStatusNote(
        `Importadas ${importedTakes.length} tomas de Zoom H6. ${linkedCount} asociadas, ${unmatchedCount} pendientes.`,
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
  const activeSessionMeta = activeSession
    ? `${activeSession.projectName || 'sin proyecto'} · ${activeSession.region || 'sin zona'}`
    : 'Crea una sesión para empezar a registrar puntos.';
  const activeSessionProjectName = activeSession ? resolveProjectName(activeSession.projectName) : 'Sin proyecto';
  const activeSessionPhotoCount = activeSession
    ? activeSession.points.reduce((count, point) => count + point.photos.length, 0)
    : 0;
  const recentProjectGroups = archiveProjectGroups.slice(0, 4);
  const latestActivePoints = sortedActiveSessionPoints.slice(0, 4);
  const livePlaceLabel = detectedPlace?.placeName || 'Lugar pendiente';
  const liveClimateLabel = weatherSnapshot?.summary || 'Clima pendiente';
  const storageSummary =
    storageMode === 'ready'
      ? 'Archivo local disponible'
      : storageMode === 'loading'
        ? 'Preparando almacenamiento'
        : 'Sólo memoria';
  const currentViewLabel = view === 'session' ? 'Inicio' : view === 'point' ? 'Captura' : 'Proyectos';
  const currentViewTitle =
    view === 'session'
      ? activeSession
        ? 'Jornada preparada para salir al campo'
        : 'Prepara una jornada nueva'
      : view === 'point'
        ? activeSession
          ? 'Registrar puntos de escucha'
          : 'Activa una sesión antes de capturar'
        : 'Proyectos guardados y archivo de estudio';
  const currentViewDescription =
    view === 'session'
      ? activeSession
        ? 'Desde aquí decides el proyecto activo, revisas el estado general y entras al flujo de captura sin perderte.'
        : 'Crea una sesión, define proyecto y zona, y deja listo el trabajo antes de salir.'
      : view === 'point'
        ? 'Pantalla operativa para marcar puntos, adjuntar fotos, revisar el mapa y seguir la jornada en tiempo real.'
        : 'Consulta proyectos, sesiones, importaciones Zoom H6, respaldos y paquetes listos para el estudio.';

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
    if (!isOnline || storageMode !== 'ready' || autoSyncCatalogSessionCount === 0) {
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
  }, [autoSyncCatalogSessionCount, isOnline, storageMode, syncedCloudSessionCount]);

  function renderArchiveSessionCard(session: UiFieldSession) {
    return (
      <div key={session.id} className="panel flex flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
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

          <div className="flex items-center gap-2">
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
              disabled={!isOnline || isSyncingCatalogSessionId === session.id}
              className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {isSyncingCatalogSessionId === session.id ? 'Catalogando' : 'Sincronizar catálogo'}
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
              {isExportingSessionId === session.id ? 'Exportando' : 'Exportar sesión'}
            </button>
            <button
              onClick={() => void removeSession(session.id)}
              className="icon-button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-5">
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
                {session.audioTakes.filter((take) => !take.associatedPointId).length} pendientes
              </p>
            </div>

            <div className="grid gap-3">
              {session.audioTakes.map((take) => {
                const linkedPoint = session.points.find((point) => point.id === take.associatedPointId) ?? null;
                const matchLabel =
                  take.matchedBy === 'reference'
                    ? 'Referencia'
                    : take.matchedBy === 'time'
                      ? 'Tiempo'
                      : take.matchedBy === 'manual'
                        ? 'Manual'
                        : 'Pendiente';

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
                                  : take.matchedBy === 'manual'
                                    ? 'asignación manual'
                                    : `a ${take.matchedPointDeltaMinutes ?? '?'} min del punto`
                              }`
                            : 'Sin asociación todavía'}
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
    <div className="field-shell min-h-screen px-4 py-6 pb-32 md:px-8 md:py-8 md:pb-36">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-6">
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

        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel flex flex-col gap-5 p-5 md:p-6"
        >
          <div className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-3">
              <p className="eyebrow">SOUNDSCAPE RECORDER · {currentViewLabel}</p>
              <h1 className="display-heading max-w-4xl text-4xl md:text-5xl">{currentViewTitle}</h1>
              <p className="module-copy max-w-3xl text-sm">{currentViewDescription}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="soft-card">
                <p className="eyebrow">Hora</p>
                <p className="summary-value">{captureTimeLabel}</p>
                <p className="module-copy text-sm">{captureDateLabel}</p>
              </div>
              <div className="soft-card">
                <p className="eyebrow">Sesión</p>
                <p className="summary-value">{activeSession ? 'Activa' : 'Sin abrir'}</p>
                <p className="module-copy text-sm">
                  {activeSession ? activeSession.name : 'Prepara una jornada en Inicio.'}
                </p>
              </div>
              <div className="soft-card">
                <p className="eyebrow">GPS</p>
                <p className="summary-value">{currentGps ? gpsAccuracyLabel : 'Sin señal'}</p>
                <p className="module-copy text-sm">{gpsLabel}</p>
              </div>
            </div>
          </div>

          <div className="status-strip text-sm leading-6 text-[color:var(--muted)]">
            {statusNote}
          </div>

          {appError ? (
            <div className="error-strip text-sm text-[color:var(--accent)]">
              {appError}
            </div>
          ) : null}
        </motion.header>

        <nav className="menu-shell bottom-dock fixed bottom-4 left-1/2 z-20 flex w-[calc(100%-2rem)] max-w-[430px] -translate-x-1/2 items-center gap-2 px-2 py-2 md:w-auto md:max-w-none">
          <ViewButton active={view === 'session'} label="INICIO" icon={House} onClick={() => setView('session')} />
          <ViewButton active={view === 'point'} label="CAPTURA" icon={Camera} onClick={() => setView('point')} />
          <ViewButton active={view === 'export'} label="PROYECTOS" icon={History} onClick={() => setView('export')} />
        </nav>

        <AnimatePresence mode="wait">
          {view === 'session' ? (
            <motion.section
              key="session"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]"
            >
              <div className="grid gap-6">
                <div className="panel p-6 md:p-8">
                  {activeSession ? (
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <p className="eyebrow text-[color:var(--signal-strong)]">Inicio</p>
                        <h2 className="display-heading text-3xl text-[color:var(--ink)]">Continuar jornada</h2>
                        <p className="text-sm leading-7 text-[color:var(--muted)]">
                          Todo lo importante de la salida actual está aquí. Desde este panel entras a capturar puntos o saltas al archivo del proyecto.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="soft-card">
                          <p className="eyebrow text-[color:var(--muted)]">Sesión activa</p>
                          <p className="summary-value">{activeSession.name}</p>
                          <p className="module-copy text-sm">{formatDateTime(activeSession.startedAt, "d MMM yyyy · HH:mm")}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow text-[color:var(--muted)]">Proyecto</p>
                          <p className="summary-value">{activeSessionProjectName}</p>
                          <p className="module-copy text-sm">{activeSession.region || 'Zona sin definir'}</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow text-[color:var(--muted)]">Registro actual</p>
                          <p className="summary-value">{activeSession.points.length} puntos</p>
                          <p className="module-copy text-sm">{activeSessionPhotoCount} fotos · {activeSession.audioTakes.length} tomas H6</p>
                        </div>
                        <div className="soft-card">
                          <p className="eyebrow text-[color:var(--muted)]">Estado de respaldo</p>
                          <p className="summary-value">{storageSummary}</p>
                          <p className="module-copy text-sm">
                            {pendingCloudSessionCount > 0 || pendingCatalogSessionCount > 0
                              ? 'Hay sincronizaciones pendientes.'
                              : 'Sincronización al día.'}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button onClick={() => setView('point')} className="ui-button ui-button-primary">
                          <Camera className="h-4 w-4" />
                          Ir a captura
                        </button>
                        <button onClick={() => setView('export')} className="ui-button ui-button-secondary">
                          <History className="h-4 w-4" />
                          Ver proyectos
                        </button>
                        <button onClick={() => void closeActiveSession()} className="ui-button ui-button-danger">
                          Cerrar sesión
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <p className="eyebrow text-[color:var(--signal-strong)]">Inicio</p>
                        <h2 className="display-heading text-3xl text-[color:var(--ink)]">Crear una nueva jornada</h2>
                        <p className="text-sm leading-7 text-[color:var(--muted)]">
                          Define primero el proyecto, la zona y el equipo. Después entrarás en una pantalla de captura mucho más limpia.
                        </p>
                      </div>

                      <div className="grid gap-4">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Nombre de la sesión</span>
                          <input
                            value={sessionDraft.name}
                            onChange={(event) => setSessionDraft((previous) => ({ ...previous, name: event.target.value }))}
                            className="field-input"
                          />
                        </label>
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Proyecto</span>
                            <input
                              value={sessionDraft.projectName}
                              onChange={(event) => setSessionDraft((previous) => ({ ...previous, projectName: event.target.value }))}
                              className="field-input"
                              placeholder="Paisajes sonoros Sierra Norte"
                              list="project-name-options"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Zona / región</span>
                            <input
                              value={sessionDraft.region}
                              onChange={(event) => setSessionDraft((previous) => ({ ...previous, region: event.target.value }))}
                              className="field-input"
                              placeholder="Serranía de Cuenca"
                            />
                          </label>
                        </div>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Preset de equipo</span>
                          <input
                            value={sessionDraft.equipmentPreset}
                            onChange={(event) => setSessionDraft((previous) => ({ ...previous, equipmentPreset: event.target.value }))}
                            className="field-input"
                            placeholder="Zoom H6 · XY"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Notas</span>
                          <textarea
                            value={sessionDraft.notes}
                            onChange={(event) => setSessionDraft((previous) => ({ ...previous, notes: event.target.value }))}
                            rows={5}
                            className="field-input min-h-32"
                            placeholder="Objetivo de la salida, ruta, permisos, clima esperado..."
                          />
                        </label>
                      </div>

                      <button onClick={createSession} className="ui-button ui-button-primary">
                        Iniciar sesión
                      </button>
                    </div>
                  )}
                </div>

                {activeSession ? (
                  <details className="manual-details">
                    <summary className="manual-details__summary">
                      <div>
                        <p className="eyebrow">Ajustes de sesión</p>
                        <p className="summary-value">Editar nombre, proyecto, zona y notas</p>
                      </div>
                      <span className="manual-details__hint">Abrir</span>
                    </summary>

                    <div className="manual-details__body mt-6 grid gap-4">
                      <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                        <span>Nombre de la sesión</span>
                        <input
                          value={activeSession.name}
                          onChange={(event) => updateActiveSessionField('name', event.target.value)}
                          className="field-input"
                        />
                      </label>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Proyecto</span>
                          <input
                            value={activeSession.projectName}
                            onChange={(event) => updateActiveSessionField('projectName', event.target.value)}
                            className="field-input"
                            placeholder="Archivo de paisajes de Gredos"
                            list="project-name-options"
                          />
                        </label>
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Zona / región</span>
                          <input
                            value={activeSession.region}
                            onChange={(event) => updateActiveSessionField('region', event.target.value)}
                            className="field-input"
                            placeholder="Cuenca alta del Tajo"
                          />
                        </label>
                      </div>
                      <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                        <span>Preset de equipo</span>
                        <input
                          value={activeSession.equipmentPreset}
                          onChange={(event) => updateActiveSessionField('equipmentPreset', event.target.value)}
                          className="field-input"
                          placeholder="Zoom H6 · XY"
                        />
                      </label>
                      <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                        <span>Notas de sesión</span>
                        <textarea
                          value={activeSession.notes}
                          onChange={(event) => updateActiveSessionField('notes', event.target.value)}
                          rows={5}
                          className="field-input min-h-32"
                          placeholder="Objetivo general de la salida, condiciones generales, logística..."
                        />
                      </label>
                    </div>
                  </details>
                ) : (
                  <div className="panel p-6">
                    <p className="eyebrow text-[color:var(--signal-strong)]">Qué resuelve esta app</p>
                    <div className="mt-4 space-y-4 text-sm leading-7 text-[color:var(--muted)]">
                      <p>Abres una jornada, marcas puntos en el terreno y cada localización queda unida a GPS, fecha, clima, fotos y notas.</p>
                      <p>Después importas las tomas de la Zoom H6, las asocias a los puntos y exportas el proyecto limpio para estudio.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-6">
                <div className="panel p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="eyebrow text-[color:var(--signal-strong)]">
                        {activeSession ? 'Estado de la jornada' : 'Flujo recomendado'}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        {activeSession
                          ? 'Antes de salir, comprueba que el GPS, el clima y el lugar detectado están listos.'
                          : 'Empieza creando una jornada y después entra en Captura para registrar puntos.'}
                      </p>
                    </div>
                    {activeSession ? (
                      <button onClick={() => setView('point')} className="ui-button ui-button-secondary">
                        Abrir captura
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="soft-card">
                      <p className="eyebrow text-[color:var(--muted)]">GPS</p>
                      <p className="summary-value">{gpsStatusLabel}</p>
                      <p className="module-copy text-sm">{gpsLabel}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow text-[color:var(--muted)]">Lugar</p>
                      <p className="summary-value">{livePlaceLabel}</p>
                      <p className="module-copy text-sm">{locationMessage || locationStatusLabel}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow text-[color:var(--muted)]">Clima</p>
                      <p className="summary-value">{liveClimateLabel}</p>
                      <p className="module-copy text-sm">{weatherSnapshot?.details || weatherStatusLabel}</p>
                    </div>
                    <div className="soft-card">
                      <p className="eyebrow text-[color:var(--muted)]">Archivo</p>
                      <p className="summary-value">{storageSummary}</p>
                      <p className="module-copy text-sm">{fileStatusLabel}</p>
                    </div>
                  </div>
                </div>

                <div className="panel p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="eyebrow text-[color:var(--signal-strong)]">
                        {activeSession ? 'Últimos puntos de la jornada' : 'Proyectos recientes'}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        {activeSession
                          ? 'Accede rápido a las localizaciones ya marcadas y vuelve a una de ellas si necesitas revisar datos.'
                          : 'Tus proyectos archivados aparecen agrupados para que el histórico no se convierta en una lista inmanejable.'}
                      </p>
                    </div>
                    <button onClick={() => setView('export')} className="ui-button ui-button-secondary">
                      Abrir proyectos
                    </button>
                  </div>

                  {activeSession ? (
                    latestActivePoints.length > 0 ? (
                      <div className="grid gap-3">
                        {latestActivePoints.map((point) => (
                          <button
                            key={point.id}
                            onClick={() => {
                              setSelectedPointId(point.id);
                              setView('point');
                            }}
                            className="soft-card text-left"
                          >
                            <p className="text-sm text-[color:var(--ink)]">{point.placeName}</p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {formatDateTime(point.createdAt, "d MMM yyyy · HH:mm:ss")}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {point.observedWeather || 'Clima sin anotar'} · {point.zoomTakeReference || 'Sin referencia Zoom'}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm leading-7 text-[color:var(--muted)]">
                        Todavía no has marcado ningún punto en esta jornada. Entra en Captura y registra la primera localización.
                      </p>
                    )
                  ) : recentProjectGroups.length > 0 ? (
                    <div className="grid gap-3">
                      {recentProjectGroups.map((group) => (
                        <button
                          key={group.key}
                          onClick={() => {
                            setSelectedArchiveProjectKey(group.key);
                            setView('export');
                          }}
                          className="soft-card text-left"
                        >
                          <p className="text-sm text-[color:var(--ink)]">{group.name}</p>
                          <p className="mt-2 text-sm text-[color:var(--muted)]">
                            {group.sessionCount} sesiones · {group.pointCount} puntos · {group.audioTakeCount} tomas H6
                          </p>
                          <p className="mt-2 text-sm text-[color:var(--muted)]">
                            Última salida: {formatDateTime(group.latestStartedAt, "d MMM yyyy · HH:mm")}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm leading-7 text-[color:var(--muted)]">
                      Aún no hay proyectos archivados. Cuando cierres las primeras jornadas aparecerán aquí de forma agrupada.
                    </p>
                  )}
                </div>
              </div>
            </motion.section>
          ) : null}

          {view === 'point' ? (
            <motion.section
              key="point"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]"
            >
              {!activeSession ? (
                <div className="panel px-6 py-16 text-center xl:col-span-2">
                  <p className="display-heading text-3xl text-[color:var(--ink)]">No hay una jornada activa</p>
                  <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                    Ve a `Inicio`, crea una sesión y luego vuelve aquí para registrar puntos de escucha y referencias para tu Zoom H6.
                  </p>
                  <div className="mt-6">
                    <button onClick={() => setView('session')} className="ui-button ui-button-primary">
                      Ir a inicio
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="panel point-panel p-6 md:p-8">
                    <div className="point-panel__header flex flex-wrap items-start justify-between gap-5">
                      <div className="space-y-3">
                        <p className="eyebrow">Captura</p>
                        <h2 className="display-heading text-3xl text-[color:var(--ink)]">Registrar punto en {activeSessionProjectName}</h2>
                        <p className="module-copy text-sm">{activeSession.name} · {activeSession.region || 'zona sin definir'}</p>
                      </div>
                      <div className="point-panel__time">
                        <p className="eyebrow">Jornada activa</p>
                        <p className="digital-clock point-time mt-2">{captureTimeLabel}</p>
                        <p className="module-copy mt-2 text-sm">{captureDateLabel}</p>
                      </div>
                    </div>

                    <div className="primary-action-panel mt-8">
                      <div className="space-y-3">
                        <p className="eyebrow">Acción principal</p>
                        <p className="display-heading text-3xl text-[color:var(--ink)]">Marcar punto ahora</p>
                        <p className="module-copy text-sm">
                          Crea un punto con GPS, lugar detectado, clima, fecha y hora. Si ya has preparado fotos o notas, también viajarán con él.
                        </p>
                      </div>

                      <button
                        onClick={() => void addQuickPointToSession()}
                        disabled={isQuickCapturing}
                        className="capture-main-button mt-6 disabled:cursor-wait disabled:opacity-65"
                      >
                        <span>{isQuickCapturing ? 'Creando punto...' : 'Marcar punto'}</span>
                        <span className="primary-recorder-action__meta">GPS · lugar · clima · hora</span>
                      </button>
                    </div>

                    <div className="context-panel mt-8">
                      <div className="context-panel__intro">
                        <p className="eyebrow">Contexto inmediato</p>
                        <p className="module-copy text-sm">
                          Esta es la información que acompañará al siguiente punto si lo registras ahora.
                        </p>
                      </div>

                      <div className="context-grid mt-5">
                        <div className="context-item">
                          <p className="eyebrow">Lugar</p>
                          <p className="summary-value">{detectedPlace?.placeName || 'Lugar pendiente'}</p>
                          <p className="module-copy text-sm">
                            {detectedPlace?.context || locationMessage || locationStatusLabel}
                          </p>
                        </div>
                        <div className="context-item">
                          <p className="eyebrow">GPS</p>
                          <p className="telemetry-value">{gpsLabel}</p>
                          <p className="module-copy text-sm">{gpsAccuracyLabel} · {gpsMessage}</p>
                        </div>
                        <div className="context-item">
                          <p className="eyebrow">Clima</p>
                          <p className="summary-value">{weatherSnapshot?.summary || 'Clima pendiente'}</p>
                          <p className="module-copy text-sm">
                            {weatherSnapshot ? weatherSnapshot.details : weatherMessage || weatherStatusLabel}
                          </p>
                        </div>
                        <div className="context-item">
                          <p className="eyebrow">Modo</p>
                          <p className="summary-value">
                            {pointDraft.coordinateSource === 'auto' ? 'GPS en directo' : 'Coordenadas manuales'}
                          </p>
                          <p className="module-copy text-sm">
                            {pointDraft.coordinateSource === 'auto'
                              ? 'La posición seguirá tu GPS.'
                              : 'Usando coordenadas escritas a mano.'}
                          </p>
                        </div>
                      </div>

                      <div className="context-actions mt-6">
                        <button
                          onClick={() => void activateGpsAndApplyToDraft()}
                          className="ui-button ui-button-secondary"
                        >
                          <MapPin className="h-4 w-4" />
                          {currentGpsRef.current ? 'Usar GPS actual' : 'Activar GPS'}
                        </button>
                        <button
                          onClick={refreshDetectedPlace}
                          disabled={locationStatus === 'loading'}
                          className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
                        >
                          <RefreshCw className={`h-4 w-4 ${locationStatus === 'loading' ? 'animate-spin' : ''}`} />
                          Actualizar lugar
                        </button>
                        <button
                          onClick={refreshAutomaticWeather}
                          disabled={weatherStatus === 'loading'}
                          className="ui-button ui-button-secondary disabled:cursor-wait disabled:opacity-60"
                        >
                          <RefreshCw className={`h-4 w-4 ${weatherStatus === 'loading' ? 'animate-spin' : ''}`} />
                          Actualizar clima
                        </button>
                        {detectedPlace &&
                        detectedPlace.placeName.trim() &&
                        pointDraft.placeName.trim() !== detectedPlace.placeName.trim() ? (
                          <button onClick={applyDetectedPlaceToDraft} className="ui-button ui-button-primary">
                            Usar lugar detectado
                          </button>
                        ) : null}
                        {weatherSnapshot && pointDraft.observedWeather.trim() !== weatherSnapshot.summary ? (
                          <button onClick={applyAutomaticWeatherToDraft} className="ui-button ui-button-primary">
                            Usar clima automático
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <details className="manual-details mt-8">
                      <summary className="manual-details__summary">
                        <div>
                          <p className="eyebrow">Edición manual</p>
                          <p className="summary-value">Completar o corregir el punto antes de guardarlo</p>
                        </div>
                        <span className="manual-details__hint">Abrir</span>
                      </summary>

                      <div className="manual-details__body mt-6 grid gap-5">
                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Nombre exacto del lugar</span>
                          <input
                            value={pointDraft.placeName}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, placeName: event.target.value }))}
                            className="field-input"
                            placeholder="Arroyo del molino, margen norte"
                          />
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Hábitat / tipo de entorno</span>
                            <input
                              value={pointDraft.habitat}
                              onChange={(event) => setPointDraft((previous) => ({ ...previous, habitat: event.target.value }))}
                              className="field-input"
                              placeholder="Ribera, bosque, urbano, costa..."
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Referencia Zoom H6</span>
                            <input
                              value={pointDraft.zoomTakeReference}
                              onChange={(event) => setPointDraft((previous) => ({ ...previous, zoomTakeReference: event.target.value }))}
                              className="field-input"
                              placeholder="H6-032 / SD1-TK12"
                            />
                          </label>
                        </div>

                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Características del lugar</span>
                          <textarea
                            value={pointDraft.characteristics}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, characteristics: event.target.value }))}
                            rows={4}
                            className="field-input min-h-28"
                            placeholder="Distancia a la fuente, relieve, viento, barreras, presencia humana, agua, reverberación..."
                          />
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
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
                              placeholder="40.123456"
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
                              placeholder="-3.123456"
                            />
                          </label>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Clima observado</span>
                            <input
                              value={pointDraft.observedWeather}
                              onChange={(event) => setPointDraft((previous) => ({ ...previous, observedWeather: event.target.value }))}
                              className="field-input"
                              placeholder="Cubierto, 12 ºC, viento flojo"
                            />
                          </label>
                          <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                            <span>Setup / micros</span>
                            <input
                              value={pointDraft.microphoneSetup}
                              onChange={(event) => setPointDraft((previous) => ({ ...previous, microphoneSetup: event.target.value }))}
                              className="field-input"
                              placeholder="Zoom H6 · XY 90º"
                            />
                          </label>
                        </div>

                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Tags</span>
                          <input
                            value={pointDraft.tagsText}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, tagsText: event.target.value }))}
                            className="field-input"
                            placeholder="agua, aves, madrugada, viento"
                          />
                        </label>

                        <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                          <span>Notas</span>
                          <textarea
                            value={pointDraft.notes}
                            onChange={(event) => setPointDraft((previous) => ({ ...previous, notes: event.target.value }))}
                            rows={4}
                            className="field-input min-h-28"
                            placeholder="Incidencias, accesibilidad, observaciones para el estudio..."
                          />
                        </label>

                        <div className="panel p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="eyebrow text-[color:var(--muted)]">Fotos del punto</p>
                              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                                Puedes añadir varias imágenes del lugar para documentarlo bien y exportarlas después.
                              </p>
                            </div>
                          </div>

                          <label className="upload-zone flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 px-5 py-6 text-center">
                            <Camera className="h-8 w-8 text-[color:var(--signal-strong)]" />
                            <div>
                              <p className="display-heading text-2xl text-[color:var(--ink)]">Añadir fotos</p>
                              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                                El material gráfico viajará dentro del paquete profesional de la sesión.
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
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              {draftPhotos.map((photo) => (
                                <div key={photo.id} className="soft-card">
                                  <img
                                    src={photo.previewUrl}
                                    alt={photo.fileName}
                                    className="h-36 w-full border border-[color:var(--line)] object-cover"
                                  />
                                  <div className="mt-3 flex items-center justify-between gap-3">
                                    <p className="text-sm text-[color:var(--ink)]">{photo.fileName}</p>
                                    <button
                                      onClick={() => removeDraftPhoto(photo.id)}
                                      className="icon-button"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <button
                          onClick={() => void addPointToSession()}
                          className="ui-button ui-button-secondary w-full"
                        >
                          Guardar punto manual
                        </button>
                      </div>
                    </details>
                  </div>

                  <div className="grid gap-6">
                    <div className="panel p-6">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="eyebrow text-[color:var(--signal-strong)]">Navegación de captura</p>
                          <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                            Alterna entre el mapa y la lista de puntos sin cargar toda la información a la vez.
                          </p>
                        </div>
                        <div className="segment-switch">
                          <button
                            onClick={() => setCaptureWorkspace('map')}
                            className={`segment-switch__button ${captureWorkspace === 'map' ? 'is-active' : ''}`}
                          >
                            Mapa
                          </button>
                          <button
                            onClick={() => setCaptureWorkspace('points')}
                            className={`segment-switch__button ${captureWorkspace === 'points' ? 'is-active' : ''}`}
                          >
                            Puntos
                          </button>
                        </div>
                      </div>

                      {captureWorkspace === 'map' ? (
                        <div className="mt-4 space-y-4">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="soft-card">
                              <p className="eyebrow text-[color:var(--muted)]">Fecha</p>
                              <p className="mt-2 text-sm text-[color:var(--ink)]">{captureDateLabel}</p>
                            </div>
                            <div className="soft-card">
                              <p className="eyebrow text-[color:var(--muted)]">Puntos</p>
                              <p className="mt-2 text-sm text-[color:var(--ink)]">{activeSession.points.length}</p>
                            </div>
                          </div>
                          <SessionMap
                            points={activeSessionMapPoints}
                            selectedPointId={selectedPointId}
                            onSelectPoint={setSelectedPointId}
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
                        </div>
                      ) : activeSession.points.length === 0 ? (
                        <div className="px-1 py-8 text-center">
                          <p className="display-heading text-3xl text-[color:var(--ink)]">Todavía no hay puntos</p>
                          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                            Guarda el primer punto para empezar a construir el registro profesional de la sesión.
                          </p>
                        </div>
                      ) : (
                        <div className="grid gap-5">
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
                                    photoPreviewUrl: point.photos[0]?.previewUrl,
                                  }}
                                  active={point.id === selectedPoint?.id}
                                  onSelect={() => setSelectedPointId(point.id)}
                                />
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {selectedPoint ? (
                      <div className="panel p-6">
                        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="eyebrow text-[color:var(--signal-strong)]">Punto seleccionado</p>
                            <p className="display-heading mt-2 text-3xl text-[color:var(--ink)]">{selectedPoint.placeName}</p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {formatDateTime(selectedPoint.createdAt, "d MMM yyyy · HH:mm:ss")}
                            </p>
                          </div>
                          <button
                            onClick={() => void removePointFromActiveSession(selectedPoint.id)}
                            className="ui-button ui-button-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar punto
                          </button>
                        </div>

                        {selectedPoint.photos[0] ? (
                          <img
                            src={selectedPoint.photos[0].previewUrl}
                            alt={`Foto de ${selectedPoint.placeName}`}
                            className="mb-4 h-56 w-full border border-[color:var(--line)] object-cover"
                          />
                        ) : null}

                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Lugar detectado</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">
                              {selectedPoint.detectedPlace?.displayName || selectedPoint.placeName}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {selectedPoint.detectedPlace?.context || 'Sin contexto de geocodificación inversa'}
                            </p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Coordenadas</p>
                            <p className="telemetry-text mt-2 text-sm text-[color:var(--ink)]">
                              {selectedPoint.gps.lat.toFixed(6)}, {selectedPoint.gps.lon.toFixed(6)}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {selectedPoint.gps.accuracy ? `${Math.round(selectedPoint.gps.accuracy)} m de precisión` : 'Sin precisión disponible'}
                            </p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Clima</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">
                              {selectedPoint.observedWeather || 'Sin clima indicado'}
                            </p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Referencia Zoom</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">
                              {selectedPoint.zoomTakeReference || 'Sin referencia'}
                            </p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {selectedPoint.microphoneSetup || 'Sin configuración'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="panel px-6 py-10 text-center">
                        <p className="display-heading text-3xl text-[color:var(--ink)]">Sin punto seleccionado</p>
                        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                          Marca un punto nuevo o selecciónalo en el mapa o en la lista para revisar su ficha.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.section>
          ) : null}

          {view === 'export' ? (
            <motion.section
              key="export"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              className="space-y-5"
            >
              <div className="panel flex flex-wrap items-end justify-between gap-4 p-6">
                <div>
                  <p className="eyebrow text-[color:var(--signal-strong)]">Proyectos guardados</p>
                  <h2 className="display-heading mt-2 text-3xl text-[color:var(--ink)]">
                    Archivo estructurado para revisar y exportar
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="telemetry-chip">{isOnline ? 'Online' : 'Offline'}</span>
                  <button
                    onClick={() => void syncPendingMetadataQueue({ force: true })}
                    disabled={!isOnline || isSyncingPendingMetadata}
                    className="ui-button ui-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className={`h-4 w-4 ${isSyncingPendingMetadata ? 'animate-spin' : ''}`} />
                    {isSyncingPendingMetadata ? 'Sincronizando pendientes' : 'Sincronizar pendientes'}
                  </button>
                  <button
                    onClick={() => void syncPendingCloudSessions()}
                    disabled={!isOnline || pendingCloudSessionCount === 0 || Boolean(isSyncingCloudSessionId)}
                    className="ui-button ui-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {isSyncingCloudSessionId ? 'Respaldando nube' : 'Respaldar pendientes'}
                  </button>
                  <button
                    onClick={() => void syncPendingCatalogSessions()}
                    disabled={!isOnline || pendingCatalogSessionCount === 0 || Boolean(isSyncingCatalogSessionId)}
                    className="ui-button ui-button-secondary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload className="h-4 w-4" />
                    {isSyncingCatalogSessionId ? 'Sincronizando catálogo' : 'Catálogo pendientes'}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Proyectos</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{projectCount}</p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Sesiones</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{sessions.length}</p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Puntos totales</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">
                      {sessions.reduce((count, session) => count + session.points.length, 0)}
                    </p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Tomas H6</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">
                      {sessions.reduce((count, session) => count + session.audioTakes.length, 0)}
                    </p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Pendientes offline</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{pendingEnrichmentCount}</p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Respaldadas</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{syncedCloudSessionCount}</p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Pendientes nube</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">{pendingCloudSessionCount}</p>
                  </div>
                  <div className="soft-card">
                    <p className="eyebrow text-[color:var(--muted)]">Catálogo remoto</p>
                    <p className="mt-2 text-sm text-[color:var(--ink)]">
                      {syncedCatalogSessionCount} OK · {pendingCatalogSessionCount} pendientes
                    </p>
                  </div>
                </div>
              </div>

              {archiveProjectGroups.length > 1 ? (
                <div className="panel flex flex-col gap-4 p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="eyebrow text-[color:var(--signal-strong)]">Filtro de proyecto</p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        Cada proyecto agrupa sus propias salidas de campo, puntos, fotos y tomas asociadas.
                      </p>
                    </div>
                    <p className="text-sm text-[color:var(--muted)]">{projectCount} proyectos archivados</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setSelectedArchiveProjectKey('all')}
                      className={`ui-button ${
                        selectedArchiveProjectKey === 'all' ? 'ui-button-primary' : 'ui-button-secondary'
                      }`}
                    >
                      Todos ({sessions.length})
                    </button>
                    {archiveProjectGroups.map((group) => (
                      <button
                        key={group.key}
                        onClick={() => setSelectedArchiveProjectKey(group.key)}
                        className={`ui-button ${
                          selectedArchiveProjectKey === group.key ? 'ui-button-primary' : 'ui-button-secondary'
                        }`}
                      >
                        {group.name} ({group.sessionCount})
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {sessions.length === 0 ? (
                <div className="panel px-6 py-16 text-center">
                  <History className="mx-auto h-12 w-12 text-[color:var(--muted)]/50" />
                  <p className="display-heading mt-4 text-3xl text-[color:var(--ink)]">Aún no hay sesiones</p>
                  <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                    Inicia una jornada de campo, registra puntos y aquí podrás exportar cada sesión en un paquete estructurado.
                  </p>
                </div>
              ) : (
                <div className="grid gap-5">
                  {visibleArchiveProjectGroups.map((group) => (
                    <section key={group.key} className="grid gap-4">
                      <div className="panel flex flex-wrap items-start justify-between gap-4 p-5">
                        <div className="space-y-2">
                          <p className="eyebrow text-[color:var(--signal-strong)]">Proyecto</p>
                          <h3 className="display-heading text-3xl text-[color:var(--ink)]">{group.name}</h3>
                          <p className="text-sm text-[color:var(--muted)]">
                            Última salida: {formatDateTime(group.latestStartedAt, "d MMM yyyy · HH:mm")}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Sesiones</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{group.sessionCount}</p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Puntos</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{group.pointCount}</p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Fotos</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{group.photoCount}</p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Tomas H6</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{group.audioTakeCount}</p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Sesiones activas</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{group.activeSessionCount}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-5">
                        {group.sessions.map((session) => renderArchiveSessionCard(session))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
