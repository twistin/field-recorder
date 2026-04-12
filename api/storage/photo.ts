import { get } from '@vercel/blob';

export async function GET(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json({ error: 'Missing BLOB_READ_WRITE_TOKEN.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const blobRef = searchParams.get('blob')?.trim();

  if (!blobRef) {
    return Response.json({ error: 'Missing blob reference.' }, { status: 400 });
  }

  try {
    const result = await get(blobRef, {
      access: 'private',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      useCache: true,
    });

    if (!result) {
      return Response.json({ error: 'Blob not found.' }, { status: 404 });
    }

    if (result.statusCode === 304 || !result.stream) {
      return new Response(null, { status: 304 });
    }

    const headers = new Headers();
    headers.set('content-type', result.blob.contentType);
    headers.set('cache-control', result.blob.cacheControl || 'private, max-age=3600');
    headers.set('content-disposition', result.blob.contentDisposition || 'inline');

    return new Response(result.stream, {
      status: 200,
      headers,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unable to fetch photo blob.' },
      { status: 500 },
    );
  }
}
