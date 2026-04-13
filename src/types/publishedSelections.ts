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
}
