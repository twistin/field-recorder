import { listCatalogSessions } from '../_lib/catalogStore.js';

export async function GET() {
  try {
    const sessions = await listCatalogSessions();
    return Response.json(sessions);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to list catalog sessions.' },
      { status: 500 },
    );
  }
}
