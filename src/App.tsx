import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CloudSun,
  Download,
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
import type {
  AutomaticWeatherSummary,
  DetectedPlaceSummary,
  FieldSession,
  GpsCoordinates,
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

function formatDateTime(value: Date | string, pattern: string) {
  return format(typeof value === 'string' ? new Date(value) : value, pattern, { locale: es });
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

function hydrateSession(session: FieldSession): UiFieldSession {
  return {
    ...session,
    points: session.points.map((point) => ({
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
  const [now, setNow] = useState(() => Date.now());
  const [storageMode, setStorageMode] = useState<'loading' | 'ready' | 'memory-only'>('loading');
  const [statusNote, setStatusNote] = useState('Inicia una sesión y ve registrando puntos con GPS, clima, notas y fotos.');
  const [appError, setAppError] = useState<string | null>(null);
  const [isExportingSessionId, setIsExportingSessionId] = useState<string | null>(null);
  const [isQuickCapturing, setIsQuickCapturing] = useState(false);

  const currentGpsRef = useRef<GpsCoordinates | null>(null);
  const sessionsRef = useRef<UiFieldSession[]>([]);
  const draftPhotosRef = useRef<DraftPhoto[]>([]);
  const locationAbortRef = useRef<AbortController | null>(null);
  const lastLocationKeyRef = useRef<string | null>(null);
  const lastAutomaticPlaceValueRef = useRef<string>('');
  const weatherAbortRef = useRef<AbortController | null>(null);
  const lastWeatherKeyRef = useRef<string | null>(null);
  const lastAutomaticWeatherValueRef = useRef<string>('');

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const selectedPoint =
    activeSession?.points.find((point) => point.id === selectedPointId) ?? activeSession?.points[0] ?? null;
  const activeSessionMapPoints = activeSession ? buildSessionMapPoints(activeSession.points) : [];
  const draftPointCoordinates = resolvePointCoordinates(pointDraft, currentGps);
  const draftPointLabel = pointDraft.placeName.trim() || detectedPlace?.placeName || 'Punto preparado';

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    draftPhotosRef.current = draftPhotos;
  }, [draftPhotos]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timerId);
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

    const timerId = window.setTimeout(() => {
      void refreshDetectedPlaceForCoordinates(coordinates);
    }, 700);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [pointDraft.coordinateSource, pointDraft.latitude, pointDraft.longitude, currentGps?.lat, currentGps?.lon]);

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

    const timerId = window.setTimeout(() => {
      void refreshWeatherForCoordinates(coordinates);
    }, 550);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [pointDraft.coordinateSource, pointDraft.latitude, pointDraft.longitude, currentGps?.lat, currentGps?.lon]);

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

  async function persistSession(nextSession: UiFieldSession) {
    replaceSessionInState(nextSession);

    if (storageMode === 'memory-only') {
      return;
    }

    try {
      await saveFieldSession(dehydrateSession(nextSession));
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

    const nextSession: UiFieldSession = {
      ...activeSession,
      points: [point, ...activeSession.points],
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

      const nextSession: UiFieldSession = {
        ...activeSession,
        points: [point, ...activeSession.points],
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
  const activeSessionMeta = activeSession
    ? `${activeSession.projectName || 'sin proyecto'} · ${activeSession.region || 'sin zona'}`
    : 'Crea una sesión para empezar a registrar puntos.';
  const livePlaceLabel = detectedPlace?.placeName || 'Lugar pendiente';
  const liveClimateLabel = weatherSnapshot?.summary || 'Clima pendiente';
  const storageSummary =
    storageMode === 'ready'
      ? 'Archivo local disponible'
      : storageMode === 'loading'
        ? 'Preparando almacenamiento'
        : 'Sólo memoria';

  return (
    <div className="field-shell min-h-screen px-4 py-6 pb-32 md:px-8 md:py-8 md:pb-36">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel hero-shell flex flex-col gap-6 p-5 md:p-6"
        >
          <div className="header-grid gap-6">
            <div className="header-main flex flex-wrap items-start justify-between gap-5">
              <div className="space-y-3">
                <p className="eyebrow">SOUNDSCAPE RECORDER</p>
                <h1 className="display-heading header-title text-4xl md:text-5xl">
                  {activeSession ? activeSession.name : 'Preparar nueva sesión'}
                </h1>
                <p className="module-copy max-w-3xl text-sm">{activeSessionMeta}</p>
                <div className="header-geometry" aria-hidden="true">
                  <span className="header-geometry__circle" />
                  <span className="header-geometry__square" />
                  <span className="header-geometry__triangle" />
                </div>
              </div>

              <div className="header-clock">
                <p className="eyebrow">Hora actual</p>
                <p className="digital-clock mt-2">{captureTimeLabel}</p>
                <p className="module-copy mt-2 text-sm">{captureDateLabel}</p>
              </div>
            </div>

            <div className="summary-grid">
              <div className="summary-card">
                <p className="eyebrow">Sesión activa</p>
                <p className="summary-value">{activeSession ? activeSession.name : 'Sin sesión'}</p>
                <p className="module-copy text-sm">
                  {activeSession ? `${activeSession.points.length} puntos registrados` : 'Inicia una sesión para activar el flujo de campo.'}
                </p>
              </div>
              <div className="summary-card">
                <p className="eyebrow">Contexto</p>
                <p className="summary-value">{livePlaceLabel}</p>
                <p className="module-copy text-sm">{liveClimateLabel}</p>
              </div>
              <div className="summary-card">
                <p className="eyebrow">Archivo</p>
                <p className="summary-value">{storageSummary}</p>
                <p className="module-copy text-sm">{gpsStatusLabel}</p>
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
          <ViewButton active={view === 'session'} label="SESIÓN" icon={MapPin} onClick={() => setView('session')} />
          <ViewButton active={view === 'point'} label="PUNTO" icon={Camera} onClick={() => setView('point')} />
          <ViewButton active={view === 'export'} label="ARCHIVO" icon={Download} onClick={() => setView('export')} />
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
              {activeSession ? (
                <>
                  <div className="panel p-6 md:p-8">
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="eyebrow text-[color:var(--signal-strong)]">Sesión activa</p>
                        <h2 className="display-heading mt-2 text-3xl text-[color:var(--ink)]">
                          {activeSession.name}
                        </h2>
                      </div>
                      <button
                        onClick={() => void closeActiveSession()}
                        className="ui-button ui-button-danger"
                      >
                        Cerrar sesión
                      </button>
                    </div>

                    <div className="grid gap-4">
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
                  </div>

                  <div className="grid gap-6">
                    <div className="panel p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <p className="eyebrow text-[color:var(--signal-strong)]">Mapa de sesión</p>
                          <p className="mt-2 text-sm text-[color:var(--muted)]">
                            Cada punto documentado queda geolocalizado para revisión posterior.
                          </p>
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
                      />
                    </div>

                    <div className="panel p-6">
                      <p className="eyebrow text-[color:var(--signal-strong)]">Punto seleccionado</p>
                      {selectedPoint ? (
                        <div className="mt-4 space-y-4">
                          <div>
                            <p className="display-heading text-3xl text-[color:var(--ink)]">{selectedPoint.placeName}</p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">
                              {formatDateTime(selectedPoint.createdAt, "d MMM yyyy · HH:mm:ss")}
                            </p>
                          </div>
                          {selectedPoint.photos[0] ? (
                            <img
                              src={selectedPoint.photos[0].previewUrl}
                              alt={`Foto de ${selectedPoint.placeName}`}
                              className="h-56 w-full border border-[color:var(--line)] object-cover"
                            />
                          ) : null}
                          <div className="grid gap-3">
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
                          <button
                            onClick={() => void removePointFromActiveSession(selectedPoint.id)}
                            className="ui-button ui-button-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                            Eliminar punto
                          </button>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">
                          Ve a la pestaña `Punto` y registra el primero para poblar esta sesión.
                        </p>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="panel p-6 md:p-8">
                    <div className="mb-6">
                      <p className="eyebrow text-[color:var(--signal-strong)]">Nueva sesión</p>
                      <h2 className="display-heading mt-2 text-3xl text-[color:var(--ink)]">
                        Inicia una jornada de campo
                      </h2>
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

                    <button
                      onClick={createSession}
                      className="ui-button ui-button-primary mt-6"
                    >
                      Iniciar sesión
                    </button>
                  </div>

                  <div className="panel p-6">
                    <p className="eyebrow text-[color:var(--signal-strong)]">Qué guarda cada sesión</p>
                    <div className="mt-4 space-y-4 text-sm leading-7 text-[color:var(--muted)]">
                      <p>Fecha y hora exactas del trabajo de campo.</p>
                      <p>Localización GPS de cada punto y clima automático por coordenadas.</p>
                      <p>Fotos, tags, características del lugar y referencia de toma para asociarla luego a tu Zoom H6.</p>
                    </div>
                  </div>
                </>
              )}
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
                  <p className="display-heading text-3xl text-[color:var(--ink)]">No hay una sesión activa</p>
                  <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                    Inicia primero una sesión para empezar a registrar puntos de escucha y referencias para tu Zoom H6.
                  </p>
                </div>
              ) : (
                <>
                  <div className="panel point-panel p-6 md:p-8">
                    <div className="point-panel__header flex flex-wrap items-start justify-between gap-5">
                      <div className="space-y-3">
                        <p className="eyebrow">Sesión activa</p>
                        <h2 className="display-heading text-3xl text-[color:var(--ink)]">{activeSession.name}</h2>
                        <p className="module-copy text-sm">{activeSessionMeta}</p>
                      </div>
                      <div className="point-panel__time">
                        <p className="eyebrow">Hora de referencia</p>
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
                      <p className="eyebrow text-[color:var(--signal-strong)]">Sesión en curso</p>
                      <div className="mt-4 space-y-4">
                        <p className="display-heading text-3xl text-[color:var(--ink)]">{activeSession.name}</p>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">Fecha</p>
                            <p className="mt-2 text-sm text-[color:var(--ink)]">{captureDateLabel}</p>
                          </div>
                          <div className="soft-card">
                            <p className="eyebrow text-[color:var(--muted)]">GPS</p>
                            <p className="telemetry-text mt-2 text-sm text-[color:var(--ink)]">{gpsLabel}</p>
                            <p className="mt-2 text-sm text-[color:var(--muted)]">{gpsAccuracyLabel}</p>
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
                    </div>

                    <div className="grid gap-5">
                      {activeSession.points.length === 0 ? (
                        <div className="panel px-6 py-12 text-center">
                          <p className="display-heading text-3xl text-[color:var(--ink)]">Todavía no hay puntos</p>
                          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                            Guarda el primer punto para empezar a construir el registro profesional de la sesión.
                          </p>
                        </div>
                      ) : (
                        activeSession.points.map((point) => (
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
                              active={point.id === selectedPointId}
                              onSelect={() => setSelectedPointId(point.id)}
                            />
                          </React.Fragment>
                        ))
                      )}
                    </div>
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
                  <p className="eyebrow text-[color:var(--signal-strong)]">Exportación profesional</p>
                  <h2 className="display-heading mt-2 text-3xl text-[color:var(--ink)]">
                    Sesiones listas para llevar al estudio
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
              </div>

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
                  {sessions.map((session) => (
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
                          </div>
                          <p className="display-heading text-3xl text-[color:var(--ink)]">{session.name}</p>
                          <p className="text-sm text-[color:var(--muted)]">
                            {formatDateTime(session.startedAt, "d MMM yyyy · HH:mm")} · {session.projectName || 'sin proyecto'} ·{' '}
                            {session.region || 'sin zona'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
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

                      <div className="grid gap-4 md:grid-cols-3">
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
                          <p className="eyebrow text-[color:var(--muted)]">Equipo</p>
                          <p className="mt-2 text-sm text-[color:var(--ink)]">{session.equipmentPreset}</p>
                        </div>
                      </div>

                      <p className="text-sm leading-7 text-[color:var(--muted)]">
                        El paquete ZIP contiene `session.json` y una carpeta por punto con su `point.json`, las fotos asociadas y todas las referencias necesarias para casar después cada toma con tu Zoom H6.
                      </p>
                    </div>
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
