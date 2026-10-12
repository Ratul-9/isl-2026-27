// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { BENGALURU_GROUND_TRUTH } from '@/domain/lineupImport/fixtures';
import { ExtractionClientError, fetchProviderStatus, requestExtraction } from './client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const IMAGE = { mediaType: 'image/png' as const, data: 'AAAA' };
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as ExtractionClientError;

describe('fetchProviderStatus', () => {
  it('returns the server-reported status', async () => {
    const fetchFn = vi.fn(async () => json({ configured: true, provider: 'gemini', model: 'gemini-3.8-flash' }));
    await expect(fetchProviderStatus(fetchFn as unknown as typeof fetch)).resolves.toEqual({
      configured: true,
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      reason: undefined,
    });
  });

  it('carries the reason when not configured', async () => {
    const fetchFn = async () => json({ configured: false, provider: 'gemini', model: 'm', reason: 'GEMINI_API_KEY is not set.' });
    expect(await fetchProviderStatus(fetchFn as unknown as typeof fetch)).toMatchObject({ configured: false, reason: 'GEMINI_API_KEY is not set.' });
  });

  it('is null (unknown) when the server cannot be reached or answers with something else', async () => {
    expect(await fetchProviderStatus((async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchProviderStatus((async () => new Response('<html>404</html>', { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchProviderStatus((async () => json({ hello: 'world' })) as unknown as typeof fetch)).toBeNull();
  });
});

describe('requestExtraction', () => {
  it('posts the image and returns the normalised lineup', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual(IMAGE);
      return json({ ok: true, lineup: BENGALURU_GROUND_TRUTH, model: 'm' });
    });
    const lineup = await requestExtraction(IMAGE, { fetchFn: fetchFn as unknown as typeof fetch });
    expect(lineup.teamName).toBe('Bengaluru FC');
    expect(lineup.starters).toHaveLength(11);
    expect(lineup.substitutes).toHaveLength(9);
  });

  it('turns a server error envelope into a presentable failure', async () => {
    const fetchFn = async () =>
      json({ ok: false, error: { code: 'rate_limited', message: 'The reading service is busy. Try again shortly.', retryable: true } }, 429);
    const e = await failure(requestExtraction(IMAGE, { fetchFn: fetchFn as unknown as typeof fetch }));
    expect(e).toBeInstanceOf(ExtractionClientError);
    expect(e.failure).toEqual({ code: 'rate_limited', message: 'The reading service is busy. Try again shortly.', retryable: true });
  });

  it('reports a network failure as retryable', async () => {
    const e = await failure(requestExtraction(IMAGE, { fetchFn: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch }));
    expect(e.failure.code).toBe('network');
    expect(e.failure.retryable).toBe(true);
  });

  it('explains a non-JSON answer (e.g. a static host without the API route)', async () => {
    const e = await failure(requestExtraction(IMAGE, { fetchFn: (async () => new Response('<html>Not found</html>', { status: 404 })) as unknown as typeof fetch }));
    expect(e.failure.code).toBe('unexpected');
    expect(e.failure.message).toMatch(/server/i);
  });

  it('rejects a success envelope whose lineup has the wrong shape instead of importing it', async () => {
    const e = await failure(requestExtraction(IMAGE, { fetchFn: (async () => json({ ok: true, lineup: { starters: 'many' } })) as unknown as typeof fetch }));
    expect(e.failure.code).toBe('unexpected');
  });

  it('reports a cancelled request distinctly', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = async (_u: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return json({});
    };
    const e = await failure(requestExtraction(IMAGE, { fetchFn: fetchFn as unknown as typeof fetch, signal: controller.signal }));
    expect(e.failure.message).toBe('Reading was cancelled.');
  });
});
