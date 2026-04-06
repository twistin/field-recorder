import type { CatalogSessionPayload } from '../../src/lib/catalogPayload';
import { getCatalogSession, upsertCatalogSession } from '../_lib/catalogStore.js';

function getIdFromRequest(request: Request): string | null {
  return new URL(request.url).searchParams.get('id');
}

export async function GET(request: Request) {
  try {
    const sessionId = getIdFromRequest(request);
    if (!sessionId) {
      return Response.json({ error: 'Missing session id.' }, { status: 400 });
    }

    const session = await getCatalogSession(sessionId);
    if (!session) {
      return Response.json({ error: 'Catalog session not found.' }, { status: 404 });
    }

    return Response.json({ session });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to fetch catalog session.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let payload: { session?: CatalogSessionPayload };

  try {
    payload = (await request.json()) as { session?: CatalogSessionPayload };
  } catch {
    return Response.json({ error: 'Invalid catalog request body.' }, { status: 400 });
  }

  if (!payload.session?.id) {
    return Response.json({ error: 'Missing catalog session payload.' }, { status: 400 });
  }

  try {
    const result = await upsertCatalogSession(payload.session);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to sync catalog session.' },
      { status: 500 },
    );
  }
}
