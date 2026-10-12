import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ connection: async () => undefined }));
const { GET, POST, DELETE } = await import('./route');

const ctx = (...path: string[]) => ({ params: Promise.resolve({ path }) });
const JOB = 'b'.repeat(32);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/api/cv proxy', () => {
  it('forwards whitelisted requests to CV_SERVICE_URL and passes the answer back', async () => {
    vi.stubEnv('CV_SERVICE_URL', 'http://127.0.0.1:9999');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('http://localhost/api/cv/health'), ctx('health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('http://127.0.0.1:9999/health');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('streams uploads through and forwards job deletion', async () => {
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit & { duplex?: string }) => {
      expect(init.duplex).toBe('half');
      expect(init.body).toBeInstanceOf(ReadableStream);
      return new Response(JSON.stringify({ jobId: JOB }), { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.set('video', new File([new Uint8Array(10)], 'clip.mp4'));
    const request = new Request('http://localhost/api/cv/analyze', { method: 'POST', body: form });
    const response = await POST(request, ctx('analyze'));
    expect(response.status).toBe(202);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:8001/api/analyze');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"deleted":true}', { status: 200 })));
    expect((await DELETE(new Request(`http://localhost/api/cv/jobs/${JOB}`, { method: 'DELETE' }), ctx('jobs', JOB))).status).toBe(200);
  });

  it('refuses anything else without contacting the service', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('http://localhost/api/cv/docs'), ctx('docs'));
    expect(response.status).toBe(404);
    expect((await GET(new Request('http://localhost/api/cv/jobs/x'), ctx('jobs', '..', 'health'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains how to start the service when it is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const response = await GET(new Request('http://localhost/api/cv/health'), ctx('health'));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('service_unreachable');
    expect(body.error.message).toMatch(/uv run uvicorn app.main:app --port 8001/);
  });

  it('refuses everything, without contacting the service, when video analysis is switched off', async () => {
    vi.stubEnv('NEXT_PUBLIC_VIDEO_ANALYSIS', 'off');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new Request('http://localhost/api/cv/health'), ctx('health'));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('disabled');
    const form = new FormData();
    form.set('video', new File([new Uint8Array(10)], 'clip.mp4'));
    expect((await POST(new Request('http://localhost/api/cv/analyze', { method: 'POST', body: form }), ctx('analyze'))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

