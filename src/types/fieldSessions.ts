export interface GpsCoordinates {
  lat: number;
  lon: number;
  accuracy: number | null;
}

export interface AutomaticWeatherSummary {
  summary: string;
  details: string;
  fetchedAt: string;
}

export interface DetectedPlaceSummary {
  placeName: string;
  context: string;
  displayName: string;
  fetchedAt: string;
}

export interface SessionPhoto {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  cloudPath?: string | null;
  cloudUrl?: string | null;
  cloudSyncedAt?: string | null;
}

export type AudioTakeMatchMethod = 'reference' | 'time' | 'manual' | 'unmatched';
export type AudioTakeMatchConfidence = 'high' | 'medium' | 'low';

export interface SessionAudioTake {
  id: string;
  source: 'zoom-h6';
  fileName: string;
  relativePath: string;
  mimeType: string;
  sizeBytes: number;
  importedAt: string;
  lastModified: string;
  inferredRecordedAt: string;
  associatedPointId: string | null;
  matchedBy: AudioTakeMatchMethod;
  confidence: AudioTakeMatchConfidence;
  matchedPointDeltaMinutes: number | null;
  detectedReference: string;
  durationSeconds: number | null;
  sampleRateHz: number | null;
  bitDepth: number | null;
  channels: number | null;
  inputSetup: string;
  lowCutEnabled: boolean | null;
  limiterEnabled: boolean | null;
  phantomPowerEnabled: boolean | null;
  takeNotes: string;
}

export interface SessionPoint {
  id: string;
  createdAt: string;
  gps: GpsCoordinates;
  placeName: string;
  habitat: string;
  characteristics: string;
  observedWeather: string;
  automaticWeather?: AutomaticWeatherSummary | null;
  detectedPlace?: DetectedPlaceSummary | null;
  tags: string[];
  notes: string;
  zoomTakeReference: string;
  microphoneSetup: string;
  photos: SessionPhoto[];
}

export interface FieldSession {
  id: string;
  name: string;
  projectName: string;
  region: string;
  notes: string;
  createdAt: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'closed';
  equipmentPreset: string;
  points: SessionPoint[];
  audioTakes: SessionAudioTake[];
  cloudSyncStatus?: 'local-only' | 'pending' | 'syncing' | 'synced' | 'error';
  cloudSyncedAt?: string | null;
  cloudError?: string | null;
  cloudManifestPath?: string | null;
  cloudManifestUrl?: string | null;
  catalogSyncStatus?: 'local-only' | 'pending' | 'syncing' | 'synced' | 'error';
  catalogSyncedAt?: string | null;
  catalogError?: string | null;
}
