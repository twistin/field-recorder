import {
  buildCatalogSessionPayload,
  type CatalogSessionPayload,
  type CatalogSessionSummary,
  type CatalogSyncResult,
} from './catalogPayload';
import type { FieldSession } from '../types/fieldSessions';

export const CATALOG_API_UNAVAILABLE_MESSAGE =
  'La API del catálogo no está disponible en este entorno. Usa `vercel dev` o despliega la app con las rutas /api/catalog activas.';

export class CatalogApiUnavailableError extends Error {
  constructor(message = CATALOG_API_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'CatalogApiUnavailableError';
  }
}

export function isCatalogApiUnavailableError(error: unknown): error is CatalogApiUnavailableError {
  return error instanceof CatalogApiUnavailableError;
}

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
    if (response.status === 404) {
      throw new CatalogApiUnavailableError();
    }
    throw await parseApiError(response, 'Catalog sync failed.');
  }

  return (await response.json()) as CatalogSyncResult;
}

export async function listCatalogSessionsRemote(): Promise<CatalogSessionSummary[]> {
  const response = await fetch('/api/catalog/sessions');
  if (!response.ok) {
    if (response.status === 404) {
      throw new CatalogApiUnavailableError();
    }
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
