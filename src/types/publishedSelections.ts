export interface PublishedSelection {
  id: string;
  sessionId: string;
  pointId: string;
  photoId: string;
  audioTakeId: string;
  caption: string;
  project: string;
  session: string;
  point: string;
  imageUrl: string;
  audioUrl: string;
  imageFileName: string;
  audioFileName: string;
  pointCapturedAt: string;
  latitude: number | null;
  longitude: number | null;
  weather: string;
  placeContext: string;
  tags: string[];
  notes: string;
  habitat: string;
  characteristics: string;
  microphoneSetup: string;
  zoomTakeReference: string;
  publishedAt: string;
  updatedAt: string;
}

export interface PublishSelectionPayload {
  id: string;
  sessionId: string;
  pointId: string;
  photoId: string;
  audioTakeId: string;
  caption: string;
  project: string;
  session: string;
  point: string;
  imageUrl: string;
  audioUrl: string;
  imageFileName: string;
  audioFileName: string;
  pointCapturedAt: string;
  latitude: number | null;
  longitude: number | null;
  weather: string;
  placeContext: string;
  tags: string[];
  notes: string;
  habitat: string;
  characteristics: string;
  microphoneSetup: string;
  zoomTakeReference: string;
}
