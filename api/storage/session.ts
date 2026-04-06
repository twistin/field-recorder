import { put } from '@vercel/blob';

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: 'Missing BLOB_READ_WRITE_TOKEN.' }, { status: 500 });
  }

  const payload = (await request.json()) as {
    pathname?: string;
    session?: unknown;
  };

  if (!payload.pathname || !payload.session) {
    return Response.json({ error: 'Missing pathname or session payload.' }, { status: 400 });
  }

  const blob = await put(payload.pathname, JSON.stringify(payload.session, null, 2), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
  });

  return Response.json({
    pathname: blob.pathname,
    url: blob.url,
  });
}
