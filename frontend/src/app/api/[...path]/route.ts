import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowed = new Set(['session', 'threads', 'memories', 'documents', 'health']);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowed.has(path[0]) || path.some((part) => !/^[a-zA-Z0-9-]+$/.test(part)))
    return Response.json({ message: 'Bulunamadı.' }, { status: 404 });
  const mutating = !['GET', 'HEAD'].includes(request.method);
  const origin = request.headers.get('origin');
  if (mutating && origin && new URL(origin).host !== request.headers.get('host'))
    return Response.json({ message: 'Geçersiz istek kaynağı.' }, { status: 403 });
  const base = process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001';
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (request.headers.has('cookie')) headers.set('cookie', request.headers.get('cookie')!);
  try {
    const upstream = await fetch(`${base}/api/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: mutating ? await request.text() : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(70000),
    });
    const responseHeaders = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    for (const cookie of upstream.headers.getSetCookie())
      responseHeaders.append('Set-Cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return Response.json(
      { message: 'Asistana ulaşılamıyor. Biraz sonra tekrar deneyin.' },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as DELETE, proxy as PATCH };
