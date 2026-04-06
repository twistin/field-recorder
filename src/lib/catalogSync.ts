import {
  buildCatalogSessionPayload,
  type CatalogSessionPayload,
  type CatalogSessionSummary,
  type CatalogSyncResult,
} from './catalogPayload';
import type { FieldSession } from '../types/fieldSessions';

async function parseApiError(response: Response, fallbackMessage: string): Promise<Error> {
  try {
    const payload = (await response.json()) as { error?: string };
    return new Error(payload.error || fallbackMessage);
  } catch {
    return new Error(fallbackMessage);
  }
}

export async function syncSessionToCatalog(session: FieldSession): Promise<CatalogSyncResult> {
  const payload = buildCatalogSessionPayload(session);
  const response = await fetch('/api/catalog/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ session: payload }),
  });

  if (!response.ok) {
    throw await parseApiError(response, 'Catalog sync failed.');
  }

  return (await response.json()) as CatalogSyncResult;
}

export async function listCatalogSessionsRemote(): Promise<CatalogSessionSummary[]> {
  const response = await fetch('/api/catalog/sessions');
  if (!response.ok) {
    throw await parseApiError(response, 'Catalog listing failed.');
  }

  return (await response.json()) as CatalogSessionSummary[];
}

export async function fetchCatalogSessionRemote(sessionId: string): Promise<CatalogSessionPayload> {
  const response = await fetch(`/api/catalog/session?id=${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    throw await parseApiError(response, 'Catalog session fetch failed.');
  }

  return ((await response.json()) as { session: CatalogSessionPayload }).session;
}
