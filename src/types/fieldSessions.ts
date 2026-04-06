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
}
