// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { sampleAnalysis } from '@/domain/replay/fixtures';
import { checkClip, fetchVideoStatus, requestVideoAnalysis, VideoClientError } from './client';
import type { VideoLimits } from './schema';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LIMITS: VideoLimits = { maxBytes: 1024 * 1024, maxSeconds: 60, samplingFps: 5, types: ['video/mp4'] };
const MP4 = new Blob([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])]);
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as VideoClientError;
const asFetch = (fn: unknown) => fn as typeof fetch;

describe('fetchVideoStatus', () => {
  it('returns the status with its limits', async () => {
    const f = vi.fn(async () => json({ configured: true, provider: 'gemini', model: 'm', limits: LIMITS }));
    expect(await fetchVideoStatus(asFetch(f))).toMatchObject({ configured: true, provider: 'gemini', limits: LIMITS });
  });
  it('carries the reason when not configured', async () => {
    const f = async () => json({ configured: false, provider: 'gemini', model: 'm', limits: LIMITS, reason: 'No GEMINI_API_KEY is set.' });
    expect(await fetchVideoStatus(asFetch(f))).toMatchObject({ configured: false, reason: 'No GEMINI_API_KEY is set.' });
  });
  it('is null when the server cannot be reached or answers with something else', async () => {
    expect(await fetchVideoStatus(asFetch(async () => { throw new TypeError('fetch failed'); }))).toBeNull();
    expect(await fetchVideoStatus(asFetch(async () => new Response('nope', { status: 404 })))).toBeNull();
    expect(await fetchVideoStatus(asFetch(async () => json({ hello: 1 })))).toBeNull();
  });
});

describe('checkClip', () => {
  it('passes a real MP4 within limits and reports why not otherwise', async () => {
    expect(await checkClip(MP4, 20, LIMITS)).toBeNull();
    expect(await checkClip(MP4, 90, LIMITS)).toMatchObject({ code: 'video_too_long' });
    expect(await checkClip(new Blob(['plain text, not a video at all']), null, LIMITS)).toMatchObject({ code: 'unsupported_media' });
    expect(await checkClip(new Blob([]), null, LIMITS)).toMatchObject({ code: 'invalid_request' });
  });
});

describe('requestVideoAnalysis', () => {
  const META = { model: 'gemini-x', samplingFps: 5, durationSeconds: 12, analysedAt: '2026-10-12T09:00:00.000Z' };

  it('posts the clip as multipart with the duration and returns a normalised analysis', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const form = init?.body as FormData;
      expect(form.get('video')).toBeInstanceOf(Blob);
      expect(form.get('durationSeconds')).toBe('12');
      return json({ ok: true, analysis: sampleAnalysis(), meta: META });
    });
    const r = await requestVideoAnalysis(MP4, 12, { fetchFn: asFetch(f) });
    expect(r.analysis.primaryEvent?.type).toBe('shotOnTarget');
    expect(r.meta).toEqual(META);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('turns a server error envelope into a presentable failure', async () => {
    const f = async () => json({ ok: false, error: { code: 'rate_limited', message: 'Out of quota.', retryable: true } }, 429);
    const e = await failure(requestVideoAnalysis(MP4, null, { fetchFn: asFetch(f) }));
    expect(e).toBeInstanceOf(VideoClientError);
    expect(e.failure).toEqual({ code: 'rate_limited', message: 'Out of quota.', retryable: true });
  });

  it('reports network failures, non-JSON answers and wrong-shaped analyses', async () => {
    const net = await failure(requestVideoAnalysis(MP4, null, { fetchFn: asFetch(async () => { throw new TypeError('fetch failed'); }) }));
    expect(net.failure).toMatchObject({ code: 'network', retryable: true });
    const html = await failure(requestVideoAnalysis(MP4, null, { fetchFn: asFetch(async () => new Response('<html>404</html>', { status: 404 })) }));
    expect(html.failure.message).toMatch(/server/i);
    const bad = await failure(requestVideoAnalysis(MP4, null, { fetchFn: asFetch(async () => json({ ok: true, analysis: { summary: 1 }, meta: META })) }));
    expect(bad.failure.code).toBe('unexpected');
  });

  it('reports a cancelled request distinctly', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = async (_u: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return json({});
    };
    const e = await failure(requestVideoAnalysis(MP4, null, { fetchFn: asFetch(f), signal: controller.signal }));
    expect(e.failure.message).toBe('Analysis was cancelled.');
  });
});
