import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Play,
  Square,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';

import {
  deleteStoredRecording,
  listStoredRecordings,
  RecordingMetadata,
  saveStoredRecording,
  StoredRecording,
  updateStoredRecordingMetadata,
  updateStoredRecordingVisual,
} from './lib/recordingsDb';

type View = 'capture' | 'library';
type CaptureMode = 'idle' | 'manual' | 'walk';

interface Coordinates {
  lat: number;
  lon: number;
  accuracy: number | null;
}

interface CaptureDraft {
  placeName: string;
  environmentType: string;
  weather: string;
  equipment: string;
  description: string;
  tagsText: string;
  latitude: string;
  longitude: string;
}

interface UiRecording extends Omit<
  StoredRecording,
  'placeName' | 'environmentType' | 'weather' | 'equipment' | 'description' | 'title' | 'tags' | 'notes'
>, RecordingMetadata {
  audioUrl: string;
}

const CAPTURE_SLICE_MS = 30_000;
const FALLBACK_GPS: Coordinates = { lat: 0, lon: 0, accuracy: null };

function buildSuggestedPlaceName(createdAt: string, mode: Exclude<CaptureMode, 'idle'>): string {
  return `${mode === 'walk' ? 'Ruta' : 'Punto'} · ${format(new Date(createdAt), 'MMM d · HH:mm')}`;
}

function emptyCaptureDraft(): CaptureDraft {
  return {
    placeName: '',
    environmentType: '',
    weather: '',
    equipment: '',
    description: '',
    tagsText: '',
    latitude: '',
    longitude: '',
  };
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

function areTagsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((tag, index) => tag === right[index]);
}

function slugifyForFile(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'field-take';
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

function dataUrlToParts(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function parseCoordinate(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function chooseAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') {
    return undefined;
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  if (mimeType.includes('mp4')) {
    return 'm4a';
  }

  return 'webm';
}

function hydrateRecording(recording: StoredRecording): UiRecording {
  const createdAt = recording.createdAt;
  const mode = recording.mode;

  return {
    ...recording,
    placeName:
      recording.placeName?.trim() ||
      recording.title?.trim() ||
      buildSuggestedPlaceName(createdAt, mode),
    environmentType: recording.environmentType?.trim() || '',
    weather: recording.weather?.trim() || '',
    equipment: recording.equipment?.trim() || '',
    description: recording.description?.trim() || recording.notes?.trim() || '',
    tags: Array.isArray(recording.tags)
      ? Array.from(
          new Set(
            recording.tags
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        )
      : [],
    audioUrl: URL.createObjectURL(recording.audioBlob),
  };
}

function buildDownloadName(recording: UiRecording): string {
  const stamp = recording.createdAt.replace(/[:.]/g, '-');
  const base = slugifyForFile(recording.placeName);
  return `${base}-${stamp}.${extensionFromMimeType(recording.mimeType)}`;
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

function buildExportManifest(recording: UiRecording) {
  return {
    id: recording.id,
    placeName: recording.placeName,
    environmentType: recording.environmentType,
    weather: recording.weather,
    equipment: recording.equipment,
    description: recording.description,
    tags: recording.tags,
    createdAt: recording.createdAt,
    createdAtLocal: format(new Date(recording.createdAt), 'yyyy-MM-dd HH:mm:ss'),
    year: format(new Date(recording.createdAt), 'yyyy'),
    time: format(new Date(recording.createdAt), 'HH:mm:ss'),
    durationMs: recording.durationMs,
    duration: formatDuration(recording.durationMs),
    mode: recording.mode,
    gps: recording.gps,
    audio: {
      mimeType: recording.mimeType,
      fileName: buildDownloadName(recording),
    },
    visual: recording.imageUrl
      ? {
          embedded: recording.imageUrl.startsWith('data:'),
          prompt: recording.prompt ?? '',
        }
      : null,
  };
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
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] transition ${
        active
          ? 'border-[color:var(--signal-strong)] bg-[color:var(--signal-soft)] text-[color:var(--paper)]'
          : 'border-white/10 bg-white/5 text-[color:var(--muted)] hover:border-white/20 hover:text-[color:var(--paper)]'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function RecordingCard({
  recording,
  isGeneratingImage,
  isExportingPackage,
  onDelete,
  onGenerateImage,
  onSaveMetadata,
  onExportPackage,
}: {
  recording: UiRecording;
  isGeneratingImage: boolean;
  isExportingPackage: boolean;
  onDelete: () => void;
  onGenerateImage: () => void;
  onSaveMetadata: (metadata: RecordingMetadata) => Promise<void> | void;
  onExportPackage: () => Promise<void> | void;
}) {
  const [placeNameDraft, setPlaceNameDraft] = useState(recording.placeName);
  const [environmentTypeDraft, setEnvironmentTypeDraft] = useState(recording.environmentType);
  const [weatherDraft, setWeatherDraft] = useState(recording.weather);
  const [equipmentDraft, setEquipmentDraft] = useState(recording.equipment);
  const [descriptionDraft, setDescriptionDraft] = useState(recording.description);
  const [tagsDraft, setTagsDraft] = useState(recording.tags.join(', '));
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);

  useEffect(() => {
    setPlaceNameDraft(recording.placeName);
    setEnvironmentTypeDraft(recording.environmentType);
    setWeatherDraft(recording.weather);
    setEquipmentDraft(recording.equipment);
    setDescriptionDraft(recording.description);
    setTagsDraft(recording.tags.join(', '));
  }, [
    recording.id,
    recording.placeName,
    recording.environmentType,
    recording.weather,
    recording.equipment,
    recording.description,
    recording.tags,
  ]);

  const modeTone =
    recording.mode === 'walk'
      ? 'border-[color:rgba(255,140,92,0.28)] bg-[rgba(255,140,92,0.12)] text-[color:var(--ember)]'
      : 'border-[color:rgba(191,255,136,0.24)] bg-[rgba(191,255,136,0.1)] text-[color:var(--signal-strong)]';
  const normalizedPlaceName =
    placeNameDraft.trim() || buildSuggestedPlaceName(recording.createdAt, recording.mode);
  const normalizedEnvironmentType = environmentTypeDraft.trim();
  const normalizedWeather = weatherDraft.trim();
  const normalizedEquipment = equipmentDraft.trim();
  const normalizedDescription = descriptionDraft.trim();
  const normalizedTags = normalizeTags(tagsDraft);
  const metadataChanged =
    normalizedPlaceName !== recording.placeName ||
    normalizedEnvironmentType !== recording.environmentType ||
    normalizedWeather !== recording.weather ||
    normalizedEquipment !== recording.equipment ||
    normalizedDescription !== recording.description ||
    !areTagsEqual(normalizedTags, recording.tags);

  async function handleSaveMetadata() {
    if (!metadataChanged || isSavingMetadata) {
      return;
    }

    setIsSavingMetadata(true);
    try {
      await onSaveMetadata({
        placeName: normalizedPlaceName,
        environmentType: normalizedEnvironmentType,
        weather: normalizedWeather,
        equipment: normalizedEquipment,
        description: normalizedDescription,
        tags: normalizedTags,
      });
    } finally {
      setIsSavingMetadata(false);
    }
  }

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="panel flex flex-col gap-5 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] ${modeTone}`}>
              {recording.mode === 'walk' ? 'Tramo de ruta' : 'Toma manual'}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted)]">
              {formatDuration(recording.durationMs)}
            </span>
          </div>
          <div>
            <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">
              {recording.placeName}
            </p>
            <p className="text-sm text-[color:var(--muted)]">
              {format(new Date(recording.createdAt), 'MMM d, yyyy · HH:mm:ss')} · {recording.gps.lat.toFixed(5)}, {recording.gps.lon.toFixed(5)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExportPackage}
            disabled={isExportingPackage}
            className="inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:text-[color:var(--signal-strong)] disabled:cursor-wait disabled:opacity-60"
          >
            {isExportingPackage ? 'Exportando' : 'Exportar'}
          </button>
          <button
            onClick={onDelete}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[color:var(--muted)] transition hover:border-[color:var(--ember)] hover:text-[color:var(--ember)]"
            aria-label="Eliminar toma"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">Tipo de entorno</p>
          <p className="mt-2 text-sm text-[color:var(--paper)]">{recording.environmentType || 'Sin indicar'}</p>
        </div>
        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">Tiempo atmosférico</p>
          <p className="mt-2 text-sm text-[color:var(--paper)]">{recording.weather || 'Sin indicar'}</p>
        </div>
        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">Equipo</p>
          <p className="mt-2 text-sm text-[color:var(--paper)]">{recording.equipment || 'Sin indicar'}</p>
        </div>
        <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">Año</p>
          <p className="mt-2 text-sm text-[color:var(--paper)]">{format(new Date(recording.createdAt), 'yyyy')}</p>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
        <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">
          <Play className="h-4 w-4 text-[color:var(--signal-strong)]" />
          Escucha
        </div>
        <audio controls preload="metadata" src={recording.audioUrl} className="field-audio w-full" />
      </div>

      {recording.description ? (
        <p className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4 text-sm leading-6 text-[color:var(--muted)]">
          {recording.description}
        </p>
      ) : null}

      {recording.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {recording.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--muted)]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <details className="rounded-[24px] border border-white/10 bg-white/[0.02]">
        <summary className="cursor-pointer list-none px-4 py-4 text-sm font-medium text-[color:var(--paper)]">
          Ficha completa y edición
        </summary>
        <div className="grid gap-4 border-t border-white/10 px-4 py-4 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm text-[color:var(--muted)]">
              <span>Nombre del lugar</span>
              <input
                value={placeNameDraft}
                onChange={(event) => setPlaceNameDraft(event.target.value)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                placeholder="Barranco de Valdehierro"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                <span>Tipo de entorno</span>
                <input
                  value={environmentTypeDraft}
                  onChange={(event) => setEnvironmentTypeDraft(event.target.value)}
                  className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                  placeholder="Bosque, costa, urbano..."
                />
              </label>
              <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                <span>Tiempo atmosférico</span>
                <input
                  value={weatherDraft}
                  onChange={(event) => setWeatherDraft(event.target.value)}
                  className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                  placeholder="Nublado, viento suave, 12C"
                />
              </label>
            </div>
            <label className="grid gap-2 text-sm text-[color:var(--muted)]">
              <span>Equipo usado</span>
              <input
                value={equipmentDraft}
                onChange={(event) => setEquipmentDraft(event.target.value)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                placeholder="Zoom H6, par XY"
              />
            </label>
            <label className="grid gap-2 text-sm text-[color:var(--muted)]">
              <span>Tags</span>
              <input
                value={tagsDraft}
                onChange={(event) => setTagsDraft(event.target.value)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                placeholder="agua, aves, viento"
              />
            </label>
            <label className="grid gap-2 text-sm text-[color:var(--muted)]">
              <span>Descripción del lugar</span>
              <textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                rows={5}
                className="min-h-32 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                placeholder="Describe el espacio, el contexto y el interés sonoro."
              />
            </label>
            <button
              onClick={handleSaveMetadata}
              disabled={!metadataChanged || isSavingMetadata}
              className="inline-flex items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:text-[color:var(--signal-strong)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSavingMetadata ? 'Guardando ficha' : metadataChanged ? 'Guardar cambios' : 'Ficha guardada'}
            </button>
          </div>

          <div className="grid gap-4">
            <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
              <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">
                <MapPin className="h-4 w-4 text-[color:var(--ember)]" />
                Coordenadas
              </div>
              <p className="font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">
                {recording.gps.lat.toFixed(6)}, {recording.gps.lon.toFixed(6)}
              </p>
              <p className="mt-2 text-sm text-[color:var(--muted)]">
                Precisión: {recording.gps.accuracy ? `${Math.round(recording.gps.accuracy)} m` : 'desconocida'}
              </p>
            </div>

            {recording.imageUrl ? (
              <div className="space-y-3">
                <img
                  src={recording.imageUrl}
                  alt="AI-generated soundscape"
                  className="h-52 w-full rounded-[24px] border border-white/10 object-cover"
                  referrerPolicy="no-referrer"
                />
                <p className="rounded-[20px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm italic text-[color:var(--muted)]">
                  {recording.prompt}
                </p>
              </div>
            ) : (
              <button
                onClick={onGenerateImage}
                disabled={isGeneratingImage}
                className="inline-flex items-center justify-center gap-3 rounded-[20px] border border-dashed border-white/15 bg-white/[0.03] px-4 py-4 text-sm text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:bg-[color:var(--signal-soft)] disabled:cursor-wait disabled:opacity-60"
              >
                {isGeneratingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                {isGeneratingImage ? 'Generando visual' : 'Generar visual AI'}
              </button>
            )}
          </div>
        </div>
      </details>
    </motion.article>
  );
}

export default function App() {
  const [view, setView] = useState<View>('capture');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('idle');
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(emptyCaptureDraft());
  const [recordings, setRecordings] = useState<UiRecording[]>([]);
  const [currentGps, setCurrentGps] = useState<Coordinates | null>(null);
  const [gpsMessage, setGpsMessage] = useState('Buscando señal GPS...');
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  const [liveSessionMs, setLiveSessionMs] = useState(0);
  const [statusNote, setStatusNote] = useState('Ficha preparada. Registra el lugar y lanza la toma cuando estés listo.');
  const [appError, setAppError] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<'loading' | 'ready' | 'memory-only'>('loading');
  const [isGeneratingImageId, setIsGeneratingImageId] = useState<string | null>(null);
  const [isExportingId, setIsExportingId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentGpsRef = useRef<Coordinates | null>(null);
  const recordingsRef = useRef<UiRecording[]>([]);

  useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  useEffect(() => {
    let active = true;

    if (!('geolocation' in navigator)) {
      setGpsStatus('error');
      setGpsMessage('Este navegador no expone geolocalización.');
      return undefined;
    }

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

        currentGpsRef.current = nextLocation;
        setCurrentGps(nextLocation);
        setGpsStatus('ready');
        setGpsMessage(`Señal estable dentro de ${Math.round(nextLocation.accuracy ?? 0)} m.`);
      },
      (error) => {
        if (!active) {
          return;
        }

        setGpsStatus('error');
        if (error.code === error.PERMISSION_DENIED) {
          setGpsMessage('Sin permiso de ubicación. Puedes escribir coordenadas manualmente.');
        } else {
          setGpsMessage('La señal GPS es inestable ahora mismo.');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 20_000,
      },
    );

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  useEffect(() => {
    if (!currentGps) {
      return;
    }

    setCaptureDraft((previous) => {
      if (previous.latitude.trim() || previous.longitude.trim()) {
        return previous;
      }

      return {
        ...previous,
        latitude: currentGps.lat.toFixed(6),
        longitude: currentGps.lon.toFixed(6),
      };
    });
  }, [currentGps]);

  useEffect(() => {
    let active = true;

    async function loadPersistedRecordings() {
      try {
        const stored = await listStoredRecordings();
        const hydrated = stored.map(hydrateRecording);

        if (!active) {
          hydrated.forEach((recording) => URL.revokeObjectURL(recording.audioUrl));
          return;
        }

        setRecordings((previous) => {
          if (previous.length === 0) {
            return hydrated;
          }

          const merged = new Map<string, UiRecording>();

          for (const recording of hydrated) {
            merged.set(recording.id, recording);
          }

          for (const recording of previous) {
            const duplicate = merged.get(recording.id);
            if (duplicate) {
              URL.revokeObjectURL(duplicate.audioUrl);
            }
            merged.set(recording.id, recording);
          }

          return Array.from(merged.values()).sort(
            (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
          );
        });
        setStorageMode('ready');
      } catch (error) {
        if (!active) {
          return;
        }

        console.error('Storage bootstrap failed:', error);
        setStorageMode('memory-only');
        setStatusNote('El archivo local no está disponible. Las nuevas tomas quedarán sólo en memoria.');
      }
    }

    loadPersistedRecordings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current);
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // Ignore stop errors during shutdown.
        }
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      recordingsRef.current.forEach((recording) => URL.revokeObjectURL(recording.audioUrl));
    };
  }, []);

  function stopSessionTimer() {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
  }

  function startSessionTimer(startedAt: number) {
    stopSessionTimer();
    setLiveSessionMs(0);

    sessionTimerRef.current = setInterval(() => {
      setLiveSessionMs(Date.now() - startedAt);
    }, 250);
  }

  function releaseStream() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
  }

  function closeCapture(resetClock = true) {
    stopSessionTimer();
    releaseStream();
    if (resetClock) {
      setLiveSessionMs(0);
    }
  }

  function applyCurrentGpsToDraft() {
    if (!currentGpsRef.current) {
      setAppError('No hay una señal GPS activa para rellenar las coordenadas.');
      return;
    }

    setCaptureDraft((previous) => ({
      ...previous,
      latitude: currentGpsRef.current?.lat.toFixed(6) ?? previous.latitude,
      longitude: currentGpsRef.current?.lon.toFixed(6) ?? previous.longitude,
    }));
  }

  function resolveDraftGps(): Coordinates {
    const latitudeText = captureDraft.latitude.trim();
    const longitudeText = captureDraft.longitude.trim();
    const latitude = parseCoordinate(latitudeText);
    const longitude = parseCoordinate(longitudeText);

    if ((latitudeText && latitude === null) || (longitudeText && longitude === null)) {
      throw new Error('Las coordenadas deben ser numéricas.');
    }

    if ((latitudeText && longitude === null) || (longitudeText && latitude === null)) {
      throw new Error('Debes completar latitud y longitud o dejar ambas vacías para usar el GPS.');
    }

    if (latitude !== null && longitude !== null) {
      return {
        lat: latitude,
        lon: longitude,
        accuracy: currentGpsRef.current?.accuracy ?? null,
      };
    }

    return currentGpsRef.current ?? FALLBACK_GPS;
  }

  function buildMetadataFromDraft(createdAt: string, mode: Exclude<CaptureMode, 'idle'>): RecordingMetadata {
    return {
      placeName: captureDraft.placeName.trim() || buildSuggestedPlaceName(createdAt, mode),
      environmentType: captureDraft.environmentType.trim(),
      weather: captureDraft.weather.trim(),
      equipment: captureDraft.equipment.trim(),
      description: captureDraft.description.trim(),
      tags: normalizeTags(captureDraft.tagsText),
    };
  }

  async function prepareRecorder(): Promise<MediaRecorder | null> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAppError('Este navegador no puede acceder al micrófono.');
      return null;
    }

    if (typeof MediaRecorder === 'undefined') {
      setAppError('MediaRecorder no está disponible en este navegador.');
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const preferredMimeType = chooseAudioMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      return recorder;
    } catch (error) {
      console.error('Microphone access failed:', error);
      setAppError('Falló el acceso al micrófono. Revisa permisos y contexto seguro.');
      return null;
    }
  }

  async function persistAndHydrate(recording: StoredRecording) {
    if (storageMode !== 'memory-only') {
      try {
        await saveStoredRecording(recording);
        setStorageMode('ready');
      } catch (error) {
        console.error('Saving recording failed:', error);
        setStorageMode('memory-only');
        setStatusNote('Falló la escritura local. Las nuevas tomas quedarán en memoria hasta recargar.');
      }
    }

    setRecordings((previous) => [hydrateRecording(recording), ...previous]);
  }

  async function finalizeRecording(blob: Blob, durationMs: number, mode: Exclude<CaptureMode, 'idle'>) {
    if (blob.size === 0) {
      setAppError('La grabadora devolvió un clip vacío.');
      return;
    }

    const createdAt = new Date().toISOString();
    const gps = resolveDraftGps();
    const metadata = buildMetadataFromDraft(createdAt, mode);

    const storedRecording: StoredRecording = {
      id: uuidv4(),
      createdAt,
      durationMs,
      mode,
      gps: {
        lat: gps.lat,
        lon: gps.lon,
        accuracy: gps.accuracy,
      },
      mimeType: blob.type || chooseAudioMimeType() || 'audio/webm',
      audioBlob: blob,
      placeName: metadata.placeName,
      environmentType: metadata.environmentType,
      weather: metadata.weather,
      equipment: metadata.equipment,
      description: metadata.description,
      title: metadata.placeName,
      tags: metadata.tags,
      notes: metadata.description,
    };

    await persistAndHydrate(storedRecording);
    setAppError(null);
    setStatusNote(mode === 'walk' ? 'Tramo de ruta archivado.' : 'Toma archivada en el cuaderno de campo.');
  }

  async function startManualRecording() {
    if (captureMode !== 'idle') {
      return;
    }

    setAppError(null);
    try {
      resolveDraftGps();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'La ficha del lugar no es válida.');
      return;
    }

    const recorder = await prepareRecorder();
    if (!recorder) {
      return;
    }

    const chunks: Blob[] = [];
    const startedAt = Date.now();

      recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      setAppError('La grabación falló al escribir la toma.');
      setCaptureMode('idle');
      closeCapture();
    };

    recorder.onstop = async () => {
      const clipMimeType = recorder.mimeType || chunks[0]?.type || chooseAudioMimeType() || 'audio/webm';
      const blob = new Blob(chunks, { type: clipMimeType });
      try {
        await finalizeRecording(blob, Math.max(1000, Date.now() - startedAt), 'manual');
      } catch (error) {
        setAppError(error instanceof Error ? error.message : 'No se pudo guardar la toma.');
      }
      setCaptureMode('idle');
      closeCapture();
    };

    try {
      recorder.start();
      setCaptureMode('manual');
      setStatusNote('Toma manual en marcha. Detén cuando la escena esté completa.');
      startSessionTimer(startedAt);
    } catch (error) {
      console.error('Recorder start failed:', error);
      setAppError('La grabadora no pudo iniciarse.');
      closeCapture();
    }
  }

  function stopManualRecording() {
    if (captureMode !== 'manual' || !mediaRecorderRef.current) {
      return;
    }

    setStatusNote('Cerrando la toma...');
    stopSessionTimer();
    mediaRecorderRef.current.stop();
  }

  async function startWalkMode() {
    if (captureMode !== 'idle') {
      return;
    }

    setAppError(null);
    try {
      resolveDraftGps();
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'La ficha del lugar no es válida.');
      return;
    }

    const recorder = await prepareRecorder();
    if (!recorder) {
      return;
    }

    const sessionStartedAt = Date.now();
    let sliceStartedAt = sessionStartedAt;

    recorder.ondataavailable = async (event) => {
      if (event.data.size === 0) {
        return;
      }

      const now = Date.now();
      const sliceDuration = Math.max(1000, now - sliceStartedAt);
      sliceStartedAt = now;
      try {
        await finalizeRecording(event.data, sliceDuration, 'walk');
      } catch (error) {
        setAppError(error instanceof Error ? error.message : 'No se pudo guardar el tramo de ruta.');
      }
    };

    recorder.onerror = () => {
      setAppError('El modo ruta falló al cortar el audio.');
      setCaptureMode('idle');
      closeCapture();
    };

    recorder.onstop = () => {
      setCaptureMode('idle');
      closeCapture();
      setStatusNote('Modo ruta pausado. El último tramo ya se ha guardado.');
    };

    try {
      recorder.start(CAPTURE_SLICE_MS);
      setCaptureMode('walk');
      setStatusNote('Modo ruta activo. Se archivará un nuevo tramo cada 30 segundos.');
      startSessionTimer(sessionStartedAt);
    } catch (error) {
      console.error('Walk mode start failed:', error);
      setAppError('No se pudo iniciar el modo ruta.');
      closeCapture();
    }
  }

  function stopWalkMode() {
    if (captureMode !== 'walk' || !mediaRecorderRef.current) {
      return;
    }

    setStatusNote('Flushing final walk slice...');
    stopSessionTimer();
    mediaRecorderRef.current.stop();
  }

  async function removeRecording(recording: UiRecording) {
    URL.revokeObjectURL(recording.audioUrl);
    setRecordings((previous) => previous.filter((entry) => entry.id !== recording.id));

    if (storageMode === 'ready') {
      try {
        await deleteStoredRecording(recording.id);
      } catch (error) {
        console.error('Deleting recording failed:', error);
        setAppError('La toma se quitó de la vista, pero no se pudo borrar del almacenamiento.');
      }
    }
  }

  async function saveRecordingMetadata(recordingId: string, metadata: RecordingMetadata) {
    const previous = recordings.find((entry) => entry.id === recordingId);
    if (!previous) {
      return;
    }

    setRecordings((current) =>
      current.map((entry) => (entry.id === recordingId ? { ...entry, ...metadata } : entry)),
    );

    if (storageMode === 'ready') {
      try {
        await updateStoredRecordingMetadata(recordingId, metadata);
      } catch (error) {
        console.error('Metadata update failed:', error);
        setRecordings((current) =>
          current.map((entry) => (entry.id === recordingId ? previous : entry)),
        );
        setAppError('No se pudo guardar la ficha en el archivo.');
        return;
      }
    }

    setStatusNote('Ficha guardada en el archivo.');
  }

  async function exportRecordingPackage(recording: UiRecording) {
    setIsExportingId(recording.id);
    setAppError(null);

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const baseName = slugifyForFile(recording.placeName);
      const audioFileName = buildDownloadName(recording);

      zip.file(audioFileName, recording.audioBlob);
      zip.file(
        `${baseName}.json`,
        JSON.stringify(
          {
            ...buildExportManifest(recording),
            exportedAt: new Date().toISOString(),
            exportTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          null,
          2,
        ),
      );

      if (recording.imageUrl) {
        const imageParts = dataUrlToParts(recording.imageUrl);
        if (imageParts) {
          zip.file(
            `${baseName}-visual.${imageExtensionFromMimeType(imageParts.mimeType)}`,
            imageParts.base64,
            { base64: true },
          );
        } else {
          zip.file(
            `${baseName}-visual.txt`,
            `Referencia visual\n${recording.imageUrl}\n\nPrompt\n${recording.prompt ?? ''}\n`,
          );
        }
      }

      const packageBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(packageBlob, `${baseName}-archive.zip`);
      setStatusNote(`Paquete exportado para "${recording.placeName}".`);
    } catch (error) {
      console.error('Export package failed:', error);
      setAppError('No se pudo generar el paquete de archivo.');
    } finally {
      setIsExportingId(null);
    }
  }

  async function generateSoundscape(recording: UiRecording) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      setAppError('Falta GEMINI_API_KEY. Añádela antes de generar visuales.');
      return;
    }

    setAppError(null);
    setIsGeneratingImageId(recording.id);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Create an abstract cinematic image for a field recording captured in ${recording.placeName} at latitude ${recording.gps.lat.toFixed(5)} and longitude ${recording.gps.lon.toFixed(5)}. The environment is ${recording.environmentType || 'unspecified'} with weather described as ${recording.weather || 'unspecified'}. The place can be described as: ${recording.description || 'no additional place description'}. The clip lasts ${Math.round(recording.durationMs / 1000)} seconds and should feel ${recording.mode === 'walk' ? 'restless, moving, and wind-cut' : 'precise, attentive, and intimate'}. Use topographic patterns, warm signal lights, and atmospheric depth.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{ parts: [{ text: prompt }] }],
      });

      const parts = response.candidates?.[0]?.content?.parts ?? [];
      let imageUrl = '';

      for (const part of parts as Array<{ inlineData?: { data?: string; mimeType?: string } }>) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType ?? 'image/png';
          imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!imageUrl) {
        throw new Error('Gemini no devolvió una imagen embebida.');
      }

      setRecordings((previous) =>
        previous.map((entry) => (entry.id === recording.id ? { ...entry, imageUrl, prompt } : entry)),
      );

      if (storageMode === 'ready') {
        await updateStoredRecordingVisual(recording.id, imageUrl, prompt);
      }

      setStatusNote('Visual AI generado y asociado a la toma.');
    } catch (error) {
      console.error('Image generation failed:', error);
      setAppError(error instanceof Error ? error.message : 'La generación de imagen falló.');
    } finally {
      setIsGeneratingImageId(null);
    }
  }

  const latestRecording = recordings[0] ?? null;
  const totalArchiveDurationMs = recordings.reduce((sum, recording) => sum + recording.durationMs, 0);
  const gpsLabel = currentGps
    ? `${currentGps.lat.toFixed(5)}, ${currentGps.lon.toFixed(5)}`
    : 'Sin señal activa';
  const captureDateLabel = format(new Date(), 'MMM d, yyyy');
  const captureTimeLabel = format(new Date(), 'HH:mm:ss');
  const captureYearLabel = format(new Date(), 'yyyy');

  return (
    <div className="field-shell min-h-screen px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel flex flex-col gap-5 p-5 md:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="eyebrow text-[color:var(--signal-strong)]">Field Recorder Atlas</p>
              <h1 className="font-['Fraunces'] text-4xl text-[color:var(--paper)] md:text-5xl">
                Cuaderno de campo sonoro
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-[color:var(--muted)]">
                Registra el lugar, las coordenadas, el clima, el equipo usado y la toma en una sola ficha, sin ruido visual.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                <p className="eyebrow text-[color:var(--muted)]">GPS actual</p>
                <p className="mt-2 font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{gpsLabel}</p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                <p className="eyebrow text-[color:var(--muted)]">Archivo local</p>
                <p className="mt-2 text-sm text-[color:var(--paper)]">
                  {storageMode === 'ready' ? 'Activo' : storageMode === 'loading' ? 'Cargando' : 'Sólo memoria'}
                </p>
              </div>
            </div>
          </div>

          <p className="text-sm leading-6 text-[color:var(--muted)]">{statusNote}</p>
          {appError ? (
            <div className="rounded-[20px] border border-[color:rgba(255,140,92,0.3)] bg-[rgba(255,140,92,0.12)] px-4 py-3 text-sm text-[color:var(--paper)]">
              {appError}
            </div>
          ) : null}
        </motion.header>

        <div className="flex flex-wrap items-center gap-3">
          <ViewButton active={view === 'capture'} label="Registro" icon={Mic} onClick={() => setView('capture')} />
          <ViewButton active={view === 'library'} label="Archivo" icon={History} onClick={() => setView('library')} />
        </div>

        <AnimatePresence mode="wait">
          {view === 'capture' ? (
            <motion.section
              key="capture"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]"
            >
              <div className="panel p-5 md:p-6">
                <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="eyebrow text-[color:var(--signal-strong)]">Ficha del lugar</p>
                    <h2 className="mt-2 font-['Fraunces'] text-3xl text-[color:var(--paper)]">Datos útiles para archivo de campo</h2>
                  </div>
                  <button
                    onClick={applyCurrentGpsToDraft}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-[10px] uppercase tracking-[0.24em] text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:text-[color:var(--signal-strong)]"
                  >
                    <MapPin className="h-4 w-4" />
                    Usar GPS actual
                  </button>
                </div>

                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                    <span>Nombre del lugar</span>
                    <input
                      value={captureDraft.placeName}
                      onChange={(event) => setCaptureDraft((previous) => ({ ...previous, placeName: event.target.value }))}
                      className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                      placeholder="Laguna de Uña"
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Tipo de entorno</span>
                      <input
                        value={captureDraft.environmentType}
                        onChange={(event) =>
                          setCaptureDraft((previous) => ({ ...previous, environmentType: event.target.value }))
                        }
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="Bosque, urbano, costa, río..."
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Tiempo atmosférico</span>
                      <input
                        value={captureDraft.weather}
                        onChange={(event) => setCaptureDraft((previous) => ({ ...previous, weather: event.target.value }))}
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="Nublado, 14C, viento flojo"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Latitud</span>
                      <input
                        value={captureDraft.latitude}
                        onChange={(event) => setCaptureDraft((previous) => ({ ...previous, latitude: event.target.value }))}
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 font-['IBM_Plex_Mono'] text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="40.123456"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Longitud</span>
                      <input
                        value={captureDraft.longitude}
                        onChange={(event) => setCaptureDraft((previous) => ({ ...previous, longitude: event.target.value }))}
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 font-['IBM_Plex_Mono'] text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="-3.123456"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Equipo usado</span>
                      <input
                        value={captureDraft.equipment}
                        onChange={(event) => setCaptureDraft((previous) => ({ ...previous, equipment: event.target.value }))}
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="Zoom H6, cápsula XY"
                      />
                    </label>
                    <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                      <span>Tags</span>
                      <input
                        value={captureDraft.tagsText}
                        onChange={(event) => setCaptureDraft((previous) => ({ ...previous, tagsText: event.target.value }))}
                        className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                        placeholder="agua, pájaros, campanas"
                      />
                    </label>
                  </div>

                  <label className="grid gap-2 text-sm text-[color:var(--muted)]">
                    <span>Descripción del lugar</span>
                    <textarea
                      value={captureDraft.description}
                      onChange={(event) => setCaptureDraft((previous) => ({ ...previous, description: event.target.value }))}
                      rows={6}
                      className="min-h-36 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-[color:var(--paper)] outline-none transition focus:border-[color:var(--signal-strong)]"
                      placeholder="Contexto del sitio, distancia a la fuente sonora, estado del suelo, interferencias, etc."
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-6">
                <div className="panel p-5 md:p-6">
                  <p className="eyebrow text-[color:var(--signal-strong)]">Grabación</p>
                  <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-['Fraunces'] text-3xl text-[color:var(--paper)]">
                        {captureMode === 'manual' ? 'Grabando toma' : captureMode === 'walk' ? 'Modo ruta activo' : 'Listo para grabar'}
                      </p>
                      <p className="mt-2 text-sm text-[color:var(--muted)]">
                        Hora y año se archivan automáticamente con cada toma.
                      </p>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3 text-right">
                      <p className="eyebrow text-[color:var(--muted)]">Tiempo de toma</p>
                      <p className="mt-2 font-['IBM_Plex_Mono'] text-3xl text-[color:var(--paper)]">{formatDuration(liveSessionMs)}</p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col items-center gap-5">
                    <button
                      onClick={captureMode === 'manual' ? stopManualRecording : startManualRecording}
                      disabled={captureMode === 'walk'}
                      className={`capture-dial flex h-56 w-56 items-center justify-center rounded-full border text-center transition md:h-64 md:w-64 ${
                        captureMode === 'manual'
                          ? 'border-[color:rgba(255,140,92,0.5)] bg-[radial-gradient(circle_at_top,rgba(255,140,92,0.24),rgba(15,18,17,0.96)_70%)] text-[color:var(--paper)]'
                          : 'border-[color:rgba(191,255,136,0.3)] bg-[radial-gradient(circle_at_top,rgba(191,255,136,0.18),rgba(12,16,14,0.96)_70%)] text-[color:var(--paper)]'
                      } disabled:cursor-not-allowed disabled:opacity-45`}
                    >
                      <div className="space-y-3">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-black/20">
                          {captureMode === 'manual' ? <Square className="h-6 w-6 fill-current" /> : <Mic className="h-7 w-7" />}
                        </div>
                        <div>
                          <p className="eyebrow text-[color:var(--muted)]">
                            {captureMode === 'manual' ? 'Detener y archivar' : 'Toma manual'}
                          </p>
                          <p className="mt-2 font-['Fraunces'] text-3xl">
                            {captureMode === 'manual' ? 'Cerrar toma' : 'Registrar'}
                          </p>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={captureMode === 'walk' ? stopWalkMode : startWalkMode}
                      disabled={captureMode === 'manual'}
                      className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:text-[color:var(--signal-strong)] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Activity className="h-4 w-4" />
                      {captureMode === 'walk' ? 'Detener modo ruta (30s)' : 'Activar modo ruta (30s)'}
                    </button>
                  </div>

                  <div className="mt-6 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="eyebrow text-[color:var(--muted)]">Fecha y hora</p>
                      <p className="mt-2 text-sm text-[color:var(--paper)]">{captureDateLabel}</p>
                      <p className="mt-1 font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{captureTimeLabel}</p>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="eyebrow text-[color:var(--muted)]">Año</p>
                      <p className="mt-2 font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{captureYearLabel}</p>
                      <p className="mt-1 text-sm text-[color:var(--muted)]">{gpsMessage}</p>
                    </div>
                  </div>
                </div>

                <div className="panel p-5 md:p-6">
                  <p className="eyebrow text-[color:var(--signal-strong)]">Última toma</p>
                  {latestRecording ? (
                    <div className="mt-4 space-y-3">
                      <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">{latestRecording.placeName}</p>
                      <p className="text-sm text-[color:var(--muted)]">
                        {format(new Date(latestRecording.createdAt), 'MMM d · HH:mm')} · {latestRecording.weather || 'sin clima indicado'} · {latestRecording.equipment || 'sin equipo indicado'}
                      </p>
                      <audio controls preload="metadata" src={latestRecording.audioUrl} className="field-audio w-full" />
                    </div>
                  ) : (
                    <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">
                      La última toma aparecerá aquí con reproducción inmediata y su ficha archivada.
                    </p>
                  )}
                </div>
              </div>
            </motion.section>
          ) : null}

          {view === 'library' ? (
            <motion.section
              key="library"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-5"
            >
              <div className="panel flex flex-wrap items-end justify-between gap-4 p-5 md:p-6">
                <div>
                  <p className="eyebrow text-[color:var(--signal-strong)]">Archivo</p>
                  <h2 className="mt-2 font-['Fraunces'] text-3xl text-[color:var(--paper)]">
                    Tomas de campo con ficha, coordenadas y exportación
                  </h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                    <p className="eyebrow text-[color:var(--muted)]">Tomas</p>
                    <p className="mt-2 font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{recordings.length}</p>
                  </div>
                  <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                    <p className="eyebrow text-[color:var(--muted)]">Duración total</p>
                    <p className="mt-2 font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{formatDuration(totalArchiveDurationMs)}</p>
                  </div>
                </div>
              </div>

              <AnimatePresence mode="popLayout">
                {recordings.length === 0 ? (
                  <motion.div
                    key="library-empty"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="panel px-6 py-16 text-center"
                  >
                    <History className="mx-auto h-12 w-12 text-white/20" />
                    <p className="mt-4 font-['Fraunces'] text-3xl text-[color:var(--paper)]">Todavía no hay tomas</p>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                      Registra primero un lugar desde la ficha principal y la toma aparecerá aquí con su archivo completo.
                    </p>
                  </motion.div>
                ) : (
                  <div className="grid gap-5">
                    {recordings.map((recording) => (
                      <React.Fragment key={recording.id}>
                        <RecordingCard
                          recording={recording}
                          isGeneratingImage={isGeneratingImageId === recording.id}
                          isExportingPackage={isExportingId === recording.id}
                          onDelete={() => removeRecording(recording)}
                          onGenerateImage={() => generateSoundscape(recording)}
                          onSaveMetadata={(metadata) => saveRecordingMetadata(recording.id, metadata)}
                          onExportPackage={() => exportRecordingPackage(recording)}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </AnimatePresence>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
