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
  Settings,
  Square,
  Trash2,
  Volume2,
  Wind,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI } from '@google/genai';

import {
  deleteStoredRecording,
  listStoredRecordings,
  saveStoredRecording,
  StoredRecording,
  updateStoredRecordingVisual,
} from './lib/recordingsDb';

type View = 'capture' | 'library' | 'system';
type CaptureMode = 'idle' | 'manual' | 'walk';

interface Coordinates {
  lat: number;
  lon: number;
  accuracy: number | null;
}

interface UiRecording extends StoredRecording {
  audioUrl: string;
}

const CAPTURE_SLICE_MS = 30_000;
const FALLBACK_GPS: Coordinates = { lat: 0, lon: 0, accuracy: null };

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
  return {
    ...recording,
    audioUrl: URL.createObjectURL(recording.audioBlob),
  };
}

function buildDownloadName(recording: UiRecording): string {
  const stamp = recording.createdAt.replace(/[:.]/g, '-');
  return `field-take-${stamp}-${recording.mode}.${extensionFromMimeType(recording.mimeType)}`;
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
  onDelete,
  onGenerateImage,
}: {
  recording: UiRecording;
  isGeneratingImage: boolean;
  onDelete: () => void;
  onGenerateImage: () => void;
}) {
  const modeTone =
    recording.mode === 'walk'
      ? 'border-[color:rgba(255,140,92,0.28)] bg-[rgba(255,140,92,0.12)] text-[color:var(--ember)]'
      : 'border-[color:rgba(191,255,136,0.24)] bg-[rgba(191,255,136,0.1)] text-[color:var(--signal-strong)]';

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
              {recording.mode === 'walk' ? 'Walk Slice' : 'Manual Take'}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted)]">
              {formatDuration(recording.durationMs)}
            </span>
          </div>
          <div>
            <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">
              {format(new Date(recording.createdAt), 'MMM d, yyyy')}
            </p>
            <p className="text-sm text-[color:var(--muted)]">
              {format(new Date(recording.createdAt), 'HH:mm:ss')} · {recording.gps.lat.toFixed(5)}, {recording.gps.lon.toFixed(5)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={recording.audioUrl}
            download={buildDownloadName(recording)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:text-[color:var(--signal-strong)]"
            aria-label="Download recording"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            onClick={onDelete}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[color:var(--muted)] transition hover:border-[color:var(--ember)] hover:text-[color:var(--ember)]"
            aria-label="Delete recording"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="rounded-[28px] border border-white/10 bg-black/25 p-4">
          <div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">
            <Play className="h-4 w-4 text-[color:var(--signal-strong)]" />
            Playback
          </div>
          <audio controls preload="metadata" src={recording.audioUrl} className="field-audio w-full" />
        </div>

        <div className="rounded-[28px] border border-white/10 bg-black/25 p-4">
          <div className="mb-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">
            <MapPin className="h-4 w-4 text-[color:var(--ember)]" />
            Position
          </div>
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Latitude</dt>
              <dd className="font-['IBM_Plex_Mono'] text-[color:var(--paper)]">{recording.gps.lat.toFixed(6)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Longitude</dt>
              <dd className="font-['IBM_Plex_Mono'] text-[color:var(--paper)]">{recording.gps.lon.toFixed(6)}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-[color:var(--muted)]">Accuracy</dt>
              <dd className="font-['IBM_Plex_Mono'] text-[color:var(--paper)]">
                {recording.gps.accuracy ? `${Math.round(recording.gps.accuracy)} m` : 'Unknown'}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {recording.imageUrl ? (
        <div className="space-y-3">
          <img
            src={recording.imageUrl}
            alt="AI-generated soundscape"
            className="h-56 w-full rounded-[30px] border border-white/10 object-cover"
            referrerPolicy="no-referrer"
          />
          <p className="rounded-[24px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm italic text-[color:var(--muted)]">
            {recording.prompt}
          </p>
        </div>
      ) : (
        <button
          onClick={onGenerateImage}
          disabled={isGeneratingImage}
          className="inline-flex items-center justify-center gap-3 rounded-[24px] border border-dashed border-white/15 bg-white/[0.03] px-4 py-4 text-sm text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:bg-[color:var(--signal-soft)] disabled:cursor-wait disabled:opacity-60"
        >
          {isGeneratingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
          {isGeneratingImage ? 'Rendering visual' : 'Generate AI soundscape visual'}
        </button>
      )}
    </motion.article>
  );
}

export default function App() {
  const [view, setView] = useState<View>('capture');
  const [captureMode, setCaptureMode] = useState<CaptureMode>('idle');
  const [recordings, setRecordings] = useState<UiRecording[]>([]);
  const [currentGps, setCurrentGps] = useState<Coordinates | null>(null);
  const [gpsMessage, setGpsMessage] = useState('Acquiring location lock...');
  const [gpsStatus, setGpsStatus] = useState<'pending' | 'ready' | 'error'>('pending');
  const [liveSessionMs, setLiveSessionMs] = useState(0);
  const [statusNote, setStatusNote] = useState('Recorder armed. Capture a precise moment or switch to walk mode.');
  const [appError, setAppError] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<'loading' | 'ready' | 'memory-only'>('loading');
  const [isGeneratingImageId, setIsGeneratingImageId] = useState<string | null>(null);

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
      setGpsMessage('This browser does not expose geolocation.');
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
        setGpsMessage(`Lock stable within ${Math.round(nextLocation.accuracy ?? 0)} meters.`);
      },
      (error) => {
        if (!active) {
          return;
        }

        setGpsStatus('error');
        if (error.code === error.PERMISSION_DENIED) {
          setGpsMessage('Location access was denied. Recordings will use 0,0 until you allow it.');
        } else {
          setGpsMessage('Location signal is unstable right now.');
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
        setStatusNote('Local archive unavailable. New takes remain in memory for this session.');
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

  async function prepareRecorder(): Promise<MediaRecorder | null> {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAppError('This browser cannot access the microphone.');
      return null;
    }

    if (typeof MediaRecorder === 'undefined') {
      setAppError('MediaRecorder is not supported in this browser.');
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
      setAppError('Microphone access failed. Check browser permissions and secure context.');
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
        setStatusNote('Storage write failed. New takes stay in memory until refresh.');
      }
    }

    setRecordings((previous) => [hydrateRecording(recording), ...previous]);
  }

  async function finalizeRecording(blob: Blob, durationMs: number, mode: Exclude<CaptureMode, 'idle'>) {
    if (blob.size === 0) {
      setAppError('The recorder returned an empty audio clip.');
      return;
    }

    const gps = currentGpsRef.current ?? FALLBACK_GPS;

    const storedRecording: StoredRecording = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      durationMs,
      mode,
      gps: {
        lat: gps.lat,
        lon: gps.lon,
        accuracy: gps.accuracy,
      },
      mimeType: blob.type || chooseAudioMimeType() || 'audio/webm',
      audioBlob: blob,
    };

    await persistAndHydrate(storedRecording);
    setAppError(null);
    setStatusNote(mode === 'walk' ? 'Walk slice archived.' : 'Take archived to your local field library.');
  }

  async function startManualRecording() {
    if (captureMode !== 'idle') {
      return;
    }

    setAppError(null);

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
      setAppError('Recording failed while writing the take.');
      setCaptureMode('idle');
      closeCapture();
    };

    recorder.onstop = async () => {
      const clipMimeType = recorder.mimeType || chunks[0]?.type || chooseAudioMimeType() || 'audio/webm';
      const blob = new Blob(chunks, { type: clipMimeType });
      await finalizeRecording(blob, Math.max(1000, Date.now() - startedAt), 'manual');
      setCaptureMode('idle');
      closeCapture();
    };

    try {
      recorder.start();
      setCaptureMode('manual');
      setStatusNote('Manual take rolling. Press stop when the scene is complete.');
      startSessionTimer(startedAt);
    } catch (error) {
      console.error('Recorder start failed:', error);
      setAppError('The recorder could not start.');
      closeCapture();
    }
  }

  function stopManualRecording() {
    if (captureMode !== 'manual' || !mediaRecorderRef.current) {
      return;
    }

    setStatusNote('Finalizing take...');
    stopSessionTimer();
    mediaRecorderRef.current.stop();
  }

  async function startWalkMode() {
    if (captureMode !== 'idle') {
      return;
    }

    setAppError(null);

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
      await finalizeRecording(event.data, sliceDuration, 'walk');
    };

    recorder.onerror = () => {
      setAppError('Walk mode failed while slicing audio.');
      setCaptureMode('idle');
      closeCapture();
    };

    recorder.onstop = () => {
      setCaptureMode('idle');
      closeCapture();
      setStatusNote('Walk mode paused. The last slice has been flushed.');
    };

    try {
      recorder.start(CAPTURE_SLICE_MS);
      setCaptureMode('walk');
      setStatusNote('Walk mode active. A new 30 second slice is archived continuously.');
      startSessionTimer(sessionStartedAt);
    } catch (error) {
      console.error('Walk mode start failed:', error);
      setAppError('Walk mode could not start.');
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
        setAppError('The take disappeared from memory but could not be removed from storage.');
      }
    }
  }

  async function generateSoundscape(recording: UiRecording) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      setAppError('GEMINI_API_KEY is missing. Add it before generating visuals.');
      return;
    }

    setAppError(null);
    setIsGeneratingImageId(recording.id);

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Create an abstract cinematic image for a field recording captured at latitude ${recording.gps.lat.toFixed(5)} and longitude ${recording.gps.lon.toFixed(5)}. The clip lasts ${Math.round(recording.durationMs / 1000)} seconds and should feel ${recording.mode === 'walk' ? 'restless, moving, and wind-cut' : 'precise, attentive, and intimate'}. Use topographic patterns, warm signal lights, and atmospheric depth.`;

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
        throw new Error('Gemini did not return an inline image.');
      }

      setRecordings((previous) =>
        previous.map((entry) => (entry.id === recording.id ? { ...entry, imageUrl, prompt } : entry)),
      );

      if (storageMode === 'ready') {
        await updateStoredRecordingVisual(recording.id, imageUrl, prompt);
      }

      setStatusNote('AI visual generated and attached to the take.');
    } catch (error) {
      console.error('Image generation failed:', error);
      setAppError(error instanceof Error ? error.message : 'Image generation failed.');
    } finally {
      setIsGeneratingImageId(null);
    }
  }

  const latestRecording = recordings[0] ?? null;
  const totalArchiveDurationMs = recordings.reduce((sum, recording) => sum + recording.durationMs, 0);
  const gpsLabel = currentGps
    ? `${currentGps.lat.toFixed(5)}, ${currentGps.lon.toFixed(5)}`
    : 'No active lock';

  return (
    <div className="field-shell min-h-screen px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]"
        >
          <div className="hero-panel overflow-hidden p-6 md:p-8">
            <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <p className="eyebrow text-[color:var(--signal-strong)]">Field Unit Atlas</p>
                <h1 className="max-w-3xl font-['Fraunces'] text-5xl leading-[0.92] text-[color:var(--paper)] md:text-7xl">
                  Capture the ground truth before the atmosphere disappears.
                </h1>
              </div>
              <div className="rounded-[28px] border border-white/10 bg-black/20 px-4 py-3 text-right">
                <p className="eyebrow text-[color:var(--muted)]">Live Timer</p>
                <p className="font-['IBM_Plex_Mono'] text-3xl text-[color:var(--paper)]">{formatDuration(liveSessionMs)}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="metric-card">
                <p className="eyebrow text-[color:var(--muted)]">Archive</p>
                <p className="mt-3 font-['Fraunces'] text-3xl text-[color:var(--paper)]">{recordings.length}</p>
                <p className="mt-2 text-sm text-[color:var(--muted)]">persistent takes on this device</p>
              </div>
              <div className="metric-card">
                <p className="eyebrow text-[color:var(--muted)]">Footprint</p>
                <p className="mt-3 font-['Fraunces'] text-3xl text-[color:var(--paper)]">{formatDuration(totalArchiveDurationMs)}</p>
                <p className="mt-2 text-sm text-[color:var(--muted)]">total monitored ambience</p>
              </div>
              <div className="metric-card">
                <p className="eyebrow text-[color:var(--muted)]">Storage</p>
                <p className="mt-3 font-['Fraunces'] text-3xl text-[color:var(--paper)]">
                  {storageMode === 'ready' ? 'Local' : storageMode === 'loading' ? 'Syncing' : 'Memory'}
                </p>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  {storageMode === 'ready'
                    ? 'IndexedDB archive is active'
                    : storageMode === 'loading'
                      ? 'bootstrapping the archive'
                      : 'data resets on refresh'}
                </p>
              </div>
            </div>
          </div>

          <div className="panel flex flex-col justify-between gap-5 p-6">
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[color:var(--signal-soft)] bg-[color:var(--signal-soft)]">
                  <Volume2 className="h-5 w-5 text-[color:var(--paper)]" />
                </div>
                <div>
                  <p className="eyebrow text-[color:var(--muted)]">Recorder Status</p>
                  <p className="text-xl text-[color:var(--paper)]">
                    {captureMode === 'manual'
                      ? 'Manual take rolling'
                      : captureMode === 'walk'
                        ? 'Walk mode slicing'
                        : 'Standing by'}
                  </p>
                </div>
              </div>
              <p className="text-sm leading-6 text-[color:var(--muted)]">{statusNote}</p>
              {appError ? (
                <div className="rounded-[24px] border border-[color:rgba(255,140,92,0.3)] bg-[rgba(255,140,92,0.12)] px-4 py-3 text-sm text-[color:var(--paper)]">
                  {appError}
                </div>
              ) : null}
            </div>

            <div className="grid gap-3">
              <div className="rounded-[24px] border border-white/10 bg-black/25 px-4 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <MapPin className={`h-4 w-4 ${gpsStatus === 'ready' ? 'text-[color:var(--signal-strong)]' : 'text-[color:var(--ember)]'}`} />
                  <p className="eyebrow text-[color:var(--muted)]">Location lock</p>
                </div>
                <p className="font-['IBM_Plex_Mono'] text-sm text-[color:var(--paper)]">{gpsLabel}</p>
                <p className="mt-2 text-sm text-[color:var(--muted)]">{gpsMessage}</p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-black/25 px-4 py-4">
                <div className="mb-2 flex items-center gap-2">
                  <Wind className="h-4 w-4 text-[color:var(--ember)]" />
                  <p className="eyebrow text-[color:var(--muted)]">Capture modes</p>
                </div>
                <p className="text-sm leading-6 text-[color:var(--muted)]">
                  Manual mode records a deliberate single take. Walk mode keeps the mic open and archives a fresh 30 second slice until you stop it.
                </p>
              </div>
            </div>
          </div>
        </motion.header>

        <div className="flex flex-wrap items-center gap-3">
          <ViewButton active={view === 'capture'} label="Capture" icon={Mic} onClick={() => setView('capture')} />
          <ViewButton active={view === 'library'} label="Library" icon={History} onClick={() => setView('library')} />
          <ViewButton active={view === 'system'} label="System" icon={Settings} onClick={() => setView('system')} />
        </div>

        <AnimatePresence mode="wait">
          {view === 'capture' ? (
            <motion.section
              key="capture"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="grid gap-6 xl:grid-cols-[1.1fr,0.9fr]"
            >
              <div className="panel flex flex-col items-center justify-center gap-8 px-6 py-8 md:px-10 md:py-12">
                <div className="text-center">
                  <p className="eyebrow text-[color:var(--signal-strong)]">Primary Capture</p>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                    Use the large trigger for one intentional take. Keep walk mode for moving through a route and harvesting timed slices without stopping.
                  </p>
                </div>

                <button
                  onClick={captureMode === 'manual' ? stopManualRecording : startManualRecording}
                  disabled={captureMode === 'walk'}
                  className={`capture-dial flex h-72 w-72 items-center justify-center rounded-full border text-center transition md:h-80 md:w-80 ${
                    captureMode === 'manual'
                      ? 'border-[color:rgba(255,140,92,0.5)] bg-[radial-gradient(circle_at_top,rgba(255,140,92,0.32),rgba(15,18,17,0.96)_70%)] text-[color:var(--paper)] shadow-[0_0_90px_rgba(255,140,92,0.16)]'
                      : 'border-[color:rgba(191,255,136,0.35)] bg-[radial-gradient(circle_at_top,rgba(191,255,136,0.22),rgba(12,16,14,0.96)_70%)] text-[color:var(--paper)] shadow-[0_0_90px_rgba(191,255,136,0.12)]'
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  <div className="space-y-4">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-black/20">
                      {captureMode === 'manual' ? <Square className="h-7 w-7 fill-current" /> : <Mic className="h-8 w-8" />}
                    </div>
                    <div>
                      <p className="eyebrow text-[color:var(--muted)]">
                        {captureMode === 'manual' ? 'Stop and archive' : 'Record a manual take'}
                      </p>
                      <p className="mt-3 font-['Fraunces'] text-4xl">
                        {captureMode === 'manual' ? 'Seal the scene' : 'Register the moment'}
                      </p>
                    </div>
                  </div>
                </button>

                <div className="grid w-full gap-4 md:grid-cols-2">
                  <button
                    onClick={captureMode === 'walk' ? stopWalkMode : startWalkMode}
                    disabled={captureMode === 'manual'}
                    className={`rounded-[28px] border px-5 py-5 text-left transition ${
                      captureMode === 'walk'
                        ? 'border-[color:rgba(255,140,92,0.3)] bg-[rgba(255,140,92,0.12)]'
                        : 'border-white/10 bg-white/[0.03] hover:border-[color:var(--signal-strong)] hover:bg-[color:var(--signal-soft)]'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <Activity className={`h-5 w-5 ${captureMode === 'walk' ? 'text-[color:var(--ember)]' : 'text-[color:var(--signal-strong)]'}`} />
                      <p className="eyebrow text-[color:var(--muted)]">Walk Mode</p>
                    </div>
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">
                      {captureMode === 'walk' ? 'Stop timed slices' : 'Start timed slices'}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      {captureMode === 'walk'
                        ? 'The mic is open and the recorder is flushing the last segment.'
                        : 'Continuous route capture. Every 30 seconds becomes a new archived take.'}
                    </p>
                  </button>

                  <div className="rounded-[28px] border border-white/10 bg-white/[0.03] px-5 py-5">
                    <div className="mb-3 flex items-center gap-3">
                      <Zap className="h-5 w-5 text-[color:var(--ember)]" />
                      <p className="eyebrow text-[color:var(--muted)]">Scene Notes</p>
                    </div>
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Capture clean inputs</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Headphones off, keep the device still during intentional takes, and use walk mode only when movement matters more than isolation.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-6">
                <div className="panel p-6">
                  <p className="eyebrow text-[color:var(--signal-strong)]">Latest Take</p>
                  {latestRecording ? (
                    <div className="mt-5 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-['Fraunces'] text-3xl text-[color:var(--paper)]">
                            {format(new Date(latestRecording.createdAt), 'MMM d · HH:mm')}
                          </p>
                          <p className="text-sm text-[color:var(--muted)]">
                            {latestRecording.mode === 'walk' ? 'Walk slice' : 'Manual take'} · {formatDuration(latestRecording.durationMs)}
                          </p>
                        </div>
                        <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--muted)]">
                          {latestRecording.gps.lat.toFixed(4)}, {latestRecording.gps.lon.toFixed(4)}
                        </span>
                      </div>
                      <audio controls preload="metadata" src={latestRecording.audioUrl} className="field-audio w-full" />
                      {latestRecording.imageUrl ? (
                        <img
                          src={latestRecording.imageUrl}
                          alt="Latest generated soundscape"
                          className="h-52 w-full rounded-[28px] border border-white/10 object-cover"
                        />
                      ) : (
                        <button
                          onClick={() => generateSoundscape(latestRecording)}
                          disabled={isGeneratingImageId === latestRecording.id}
                          className="inline-flex w-full items-center justify-center gap-3 rounded-[22px] border border-dashed border-white/15 bg-white/[0.03] px-4 py-4 text-sm text-[color:var(--paper)] transition hover:border-[color:var(--signal-strong)] hover:bg-[color:var(--signal-soft)] disabled:cursor-wait disabled:opacity-60"
                        >
                          {isGeneratingImageId === latestRecording.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ImageIcon className="h-4 w-4" />
                          )}
                          {isGeneratingImageId === latestRecording.id ? 'Rendering latest visual' : 'Generate visual for latest take'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-[28px] border border-dashed border-white/10 bg-black/15 px-5 py-10 text-center text-sm text-[color:var(--muted)]">
                      No captures yet. The first take will appear here with immediate playback and AI visual generation.
                    </div>
                  )}
                </div>

                <div className="panel p-6">
                  <p className="eyebrow text-[color:var(--signal-strong)]">Archive Protocol</p>
                  <div className="mt-5 grid gap-4 md:grid-cols-3 xl:grid-cols-1">
                    <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Persistent</p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        Takes are written to IndexedDB, so the archive survives reloads on the same device.
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Playable</p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        Every recording ships with browser playback and direct file download instead of dead controls.
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Segmented</p>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        Walk mode now emits real timed slices rather than a placeholder interval log.
                      </p>
                    </div>
                  </div>
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
              <div className="panel flex flex-wrap items-end justify-between gap-4 p-6">
                <div>
                  <p className="eyebrow text-[color:var(--signal-strong)]">Field Library</p>
                  <h2 className="mt-3 font-['Fraunces'] text-4xl text-[color:var(--paper)]">Persistent local takes with playback, GPS, and visuals</h2>
                </div>
                <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-3">
                  <p className="eyebrow text-[color:var(--muted)]">Total capture</p>
                  <p className="mt-2 font-['IBM_Plex_Mono'] text-xl text-[color:var(--paper)]">{formatDuration(totalArchiveDurationMs)}</p>
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
                    <p className="mt-4 font-['Fraunces'] text-3xl text-[color:var(--paper)]">No recordings yet</p>
                    <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[color:var(--muted)]">
                      Start with one deliberate manual take. It will be persisted locally, playable immediately, and ready for AI image generation.
                    </p>
                  </motion.div>
                ) : (
                    <div className="grid gap-5">
                      {recordings.map((recording) => (
                        <React.Fragment key={recording.id}>
                          <RecordingCard
                            recording={recording}
                            isGeneratingImage={isGeneratingImageId === recording.id}
                            onDelete={() => removeRecording(recording)}
                            onGenerateImage={() => generateSoundscape(recording)}
                          />
                        </React.Fragment>
                      ))}
                    </div>
                  )}
              </AnimatePresence>
            </motion.section>
          ) : null}

          {view === 'system' ? (
            <motion.section
              key="system"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]"
            >
              <div className="panel p-6">
                <p className="eyebrow text-[color:var(--signal-strong)]">System Surface</p>
                <div className="mt-5 space-y-4">
                  <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Web capture engine</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Manual recording, real walk segmentation, live timer, microphone lifecycle cleanup, local archive persistence, and direct playback are active in the browser client.
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">AI rendering</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Each stored take can produce an atmospheric visual tied to its length and coordinates, then persist that visual back into the archive.
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Android track</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      The Kivy source still exists as a parallel implementation path. It now needs the same hardening pass: permissions UX, real storage rules, and parity with the web archive.
                    </p>
                  </div>
                </div>
              </div>

              <div className="panel p-6">
                <p className="eyebrow text-[color:var(--signal-strong)]">Next Passes</p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Metadata depth</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Add title, tags, notes, weather snapshot, and gain readings to make the archive searchable instead of just collectible.
                    </p>
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Waveform UX</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Generate waveform previews per take and build scrub-friendly custom transport controls for a more exact review workflow.
                    </p>
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Export pack</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Bundle audio plus metadata JSON into a single export format so the archive can move between devices or into a DAW workflow.
                    </p>
                  </div>
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                    <p className="font-['Fraunces'] text-2xl text-[color:var(--paper)]">Cloud sync</p>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      Once the browser foundation is stable, move persistence to a backend and take Gemini calls out of the client runtime.
                    </p>
                  </div>
                </div>
              </div>
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
