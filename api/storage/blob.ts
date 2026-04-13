import { get } from '@vercel/blob';

function buildCorsHeaders() {
  const headers = new Headers();
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type, range');
  headers.set('access-control-expose-headers', 'content-type, content-length, accept-ranges, content-range');
  headers.set('vary', 'origin');
  return headers;
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export async function GET(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: 'Missing BLOB_READ_WRITE_TOKEN.' },
      { status: 500, headers: buildCorsHeaders() },
    );
  }

  const { searchParams } = new URL(request.url);
  const blobRef = searchParams.get('blob')?.trim();

  if (!blobRef) {
    return Response.json({ error: 'Missing blob reference.' }, { status: 400, headers: buildCorsHeaders() });
  }

  try {
    const result = await get(blobRef, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: true,
    });

    if (!result) {
      return Response.json({ error: 'Blob not found.' }, { status: 404, headers: buildCorsHeaders() });
    }

    if (result.statusCode === 304 || !result.stream) {
      return new Response(null, { status: 304, headers: buildCorsHeaders() });
    }

    const headers = buildCorsHeaders();
    headers.set('content-type', result.blob.contentType);
    headers.set('cache-control', result.blob.cacheControl || 'private, max-age=3600');
    headers.set('content-disposition', result.blob.contentDisposition || 'inline');

    return new Response(result.stream, {
      status: 200,
      headers,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to fetch blob.' },
      { status: 500, headers: buildCorsHeaders() },
    );
  }
}
