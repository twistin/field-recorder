import { listPublishedSelections, upsertPublishedSelection } from './_lib/catalogStore.js';
import type { PublishSelectionPayload } from '../src/types/publishedSelections';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    const pointId = url.searchParams.get('pointId');

    const selections = await listPublishedSelections({
      sessionId,
      pointId,
    });

    return Response.json(selections);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to list published selections.' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  let payload: { selection?: PublishSelectionPayload };

  try {
    payload = (await request.json()) as { selection?: PublishSelectionPayload };
  } catch {
    return Response.json({ error: 'Invalid published selection request body.' }, { status: 400 });
  }

  if (!payload.selection?.id) {
    return Response.json({ error: 'Missing published selection payload.' }, { status: 400 });
  }

  try {
    const selection = await upsertPublishedSelection(payload.selection);
    return Response.json({ selection });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to publish selection.' },
      { status: 500 },
    );
  }
}
