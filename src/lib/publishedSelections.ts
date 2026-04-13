import type { PublishSelectionPayload, PublishedSelection } from '../types/publishedSelections';

async function parseApiError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error || `${fallbackMessage} (HTTP ${response.status})`);
  } catch {
    try {
      const text = await response.text();
      return new Error(text || `${fallbackMessage} (HTTP ${response.status})`);
    } catch {
      return new Error(`${fallbackMessage} (HTTP ${response.status})`);
    }
  }
}

export async function publishSelection(payload: PublishSelectionPayload): Promise<PublishedSelection> {
  const response = await fetch('/api/published-selections', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ selection: payload }),
  });

  if (!response.ok) {
    throw await parseApiError(response, 'No se pudo publicar la selección.');
  }

  return ((await response.json()) as { selection: PublishedSelection }).selection;
}

export async function listPublishedSelections(filters?: {
  sessionId?: string | null;
  pointId?: string | null;
}): Promise<PublishedSelection[]> {
  const params = new URLSearchParams();
  if (filters?.sessionId) {
    params.set('sessionId', filters.sessionId);
  }
  if (filters?.pointId) {
    params.set('pointId', filters.pointId);
  }

  const query = params.toString();
  const response = await fetch(`/api/published-selections${query ? `?${query}` : ''}`);
  if (!response.ok) {
    throw await parseApiError(response, 'No se pudieron cargar las selecciones publicadas.');
  }

  return (await response.json()) as PublishedSelection[];
}
