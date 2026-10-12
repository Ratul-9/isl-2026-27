import { connection } from 'next/server';
import { videoAnalysisEnabled } from '@/lib/features';
import { cvServiceUrl, cvTarget } from '@/tracking/proxy';

/**
 * Same-origin pass-through to the local computer-vision service (`cv-service/`, FastAPI), so the browser
 * needs no CORS setup. Only the service's public endpoints are forwarded (see `cvTarget`); uploads are
 * streamed, not buffered. The service does all validation and runs only on the machine you point
 * CV_SERVICE_URL at (default http://127.0.0.1:8001). No cloud service is involved.
 */

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function forward(request: Request, ctx: RouteContext<'/api/cv/[...path]'>) {
  await connection();
  // Switched off: never contact (or even resolve) the service.
  if (!videoAnalysisEnabled()) return json({ error: { code: 'disabled', message: 'Video tracking is coming soon.' } }, 503);
  const { path } = await ctx.params;
  const target = cvTarget(request.method, path);
  if (!target) return json({ error: { code: 'not_found', message: 'No such computer-vision endpoint.' } }, 404);
  const base = cvServiceUrl(process.env.CV_SERVICE_URL);
  const headers = new Headers();
  for (const name of ['content-type', 'content-length', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, cache: 'no-store', signal: request.signal };
    if (request.method === 'POST') {
      init.body = request.body;
      init.duplex = 'half'; // stream the upload through
    }
    const upstream = await fetch(new URL(target, base), init);
    const out = new Headers({ 'Cache-Control': 'no-store' });
    const type = upstream.headers.get('content-type');
    if (type) out.set('content-type', type);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    if (request.signal.aborted) return json({ error: { code: 'aborted', message: 'The request was cancelled.' } }, 499);
    void e;
    return json(
      {
        error: {
          code: 'service_unreachable',
          message: `The computer-vision service is not running at ${base.origin}. Start it with "uv run uvicorn app.main:app --port 8001" in cv-service/ (see cv-service/README.md).`,
        },
      },
      502,
    );
  }
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
