import { describe, expect, it, vi } from 'vitest';
import realResult from './__fixtures__/real-result-147s.json';
import { analyzeSegment, CvClientError, fetchCvHealth, scanVideo } from './client';
import type { CvProgress, CvTransport } from './client';
import { cvServiceUrl, cvTarget } from './proxy';
import { clippedSegment, segmentError } from './segment';

const JOB = 'a'.repeat(32);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const HEALTH = {
  status: 'ok',
  device: 'mps',
  models: { dir: 'models/', missing: [] },
  limits: { maxUploadMb: 300, maxSourceSeconds: 1800, maxSegmentSeconds: 15, frameStride: 1, formats: ['mp4'] },
  resultTtlSeconds: 3600,
};

/** A scripted cv-service: upload answer, then job states in order, then the result. Records every request. */
function transport(script: { upload?: { status: number; body: unknown }; states?: unknown[]; result?: unknown; health?: Response | Error }) {
  const calls: string[] = [];
  const states = [...(script.states ?? [{ jobId: JOB, state: 'done' }])];
  const t: CvTransport = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/health')) {
        if (script.health instanceof Error) throw script.health;
        return script.health ?? json(HEALTH);
      }
      if (url.includes('/jobs/') && init?.method === 'DELETE') return json({ deleted: true });
      if (url.includes('/jobs/')) return json(states.length > 1 ? states.shift() : states[0]);
      if (url.includes('/results/')) return json(script.result ?? realResult);
      return json({}, 404);
    }) as unknown as typeof fetch,
    upload: vi.fn(async (url: string, _body: FormData, onProgress: (f: number) => void) => {
      calls.push(`UPLOAD ${url}`);
      onProgress(0.5);
      onProgress(1);
      return script.upload ?? { status: 202, body: { jobId: JOB } };
    }),
    sleep: vi.fn(async () => undefined),
  };
  return { t, calls };
}

const file = () => new File([new Uint8Array(64)], 'clip.mp4', { type: 'video/mp4' });

describe('cv-service client', () => {
  it('uploads, reports real progress, polls until done, validates the result and frees the job', async () => {
    const { t, calls } = transport({
      states: [
        { jobId: JOB, state: 'queued' },
        { jobId: JOB, state: 'running', progress: { stage: 'detecting and tracking', done: 20, total: 50 } },
        { jobId: JOB, state: 'done', progress: { stage: 'done', done: 50, total: 50 } },
      ],
    });
    const progress: CvProgress[] = [];
    const result = await analyzeSegment(file(), { startSeconds: 147.2, durationSeconds: 2 }, (p) => progress.push(p), new AbortController().signal, t);
    expect(result.segment.processedFrames).toBe(50);
    expect(progress).toEqual([
      { phase: 'uploading', fraction: 0 },
      { phase: 'uploading', fraction: 0.5 },
      { phase: 'uploading', fraction: 1 },
      { phase: 'queued' },
      { phase: 'processing', stage: 'detecting and tracking', done: 20, total: 50 },
    ]);
    const form = (t.upload as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(form.get('startSeconds')).toBe('147.2');
    expect(form.get('durationSeconds')).toBe('2');
    expect(calls).toContain(`GET /api/cv/results/${JOB}`);
    expect(calls).toContain(`DELETE /api/cv/jobs/${JOB}`);
  });

  it('passes the service error message through for refused uploads and failed jobs', async () => {
    const refused = transport({ upload: { status: 413, body: { error: { code: 'file_too_large', message: 'The upload is larger than 300 MB.' } } } });
    await expect(analyzeSegment(file(), { startSeconds: 0, durationSeconds: 2 }, () => {}, new AbortController().signal, refused.t)).rejects.toMatchObject({
      code: 'file_too_large',
      message: 'The upload is larger than 300 MB.',
    });
    const failed = transport({ states: [{ jobId: JOB, state: 'failed', error: { code: 'video_too_short', message: 'No frames in that segment.' } }] });
    await expect(analyzeSegment(file(), { startSeconds: 0, durationSeconds: 2 }, () => {}, new AbortController().signal, failed.t)).rejects.toThrow('No frames in that segment.');
    expect(failed.calls).toContain(`DELETE /api/cv/jobs/${JOB}`);
  });

  it('refuses a result that does not match the schema instead of using it', async () => {
    const { t } = transport({ result: { ...realResult, tracks: [{ trackId: 't1' }] } });
    await expect(analyzeSegment(file(), { startSeconds: 0, durationSeconds: 2 }, () => {}, new AbortController().signal, t)).rejects.toMatchObject({ code: 'invalid_result' });
  });

  it('stops polling and cancels the job on the service when aborted', async () => {
    const controller = new AbortController();
    const { t, calls } = transport({ states: [{ jobId: JOB, state: 'running', progress: { stage: 'detecting and tracking', done: 1, total: 50 } }] });
    t.sleep = vi.fn(async () => {
      controller.abort();
      throw new CvClientError('cancelled', 'Cancelled.');
    });
    await expect(analyzeSegment(file(), { startSeconds: 0, durationSeconds: 2 }, () => {}, controller.signal, t)).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toContain(`DELETE /api/cv/jobs/${JOB}`);
  });

  it('reads the shot scan and the health check, and explains an unreachable service', async () => {
    const scan = { source: { width: 854, height: 480, fps: 25, durationS: 344.84 }, sampleHz: 2, shots: [{ startS: 0, endS: 5 }], suggestions: [{ startS: 23.52, durationS: 13.84, wideScore: 1 }] };
    const { t } = transport({ result: scan });
    expect((await scanVideo(file(), () => {}, new AbortController().signal, t)).suggestions[0].startS).toBe(23.52);
    expect(await fetchCvHealth(t)).toMatchObject({ ok: true, health: { device: 'mps' } });
    const down = transport({ health: json({ error: { code: 'service_unreachable', message: 'The computer-vision service is not running.' } }, 502) });
    expect(await fetchCvHealth(down.t)).toEqual({ ok: false, code: 'service_unreachable', message: 'The computer-vision service is not running.' });
    const other = transport({ health: json({ hello: 'world' }) });
    expect(await fetchCvHealth(other.t)).toMatchObject({ ok: false, code: 'unexpected' });
  });
});

describe('proxy whitelist', () => {
  it('forwards only the public endpoints with valid job ids', () => {
    expect(cvTarget('GET', ['health'])).toBe('/health');
    expect(cvTarget('POST', ['analyze'])).toBe('/api/analyze');
    expect(cvTarget('POST', ['scan'])).toBe('/api/scan');
    expect(cvTarget('GET', ['jobs', JOB])).toBe(`/api/jobs/${JOB}`);
    expect(cvTarget('DELETE', ['jobs', JOB])).toBe(`/api/jobs/${JOB}`);
    expect(cvTarget('GET', ['results', JOB])).toBe(`/api/results/${JOB}`);
    expect(cvTarget('GET', ['jobs', '../../etc/passwd'])).toBeNull();
    expect(cvTarget('GET', ['results', JOB, 'x'])).toBeNull();
    expect(cvTarget('DELETE', ['results', JOB])).toBeNull();
    expect(cvTarget('GET', ['docs'])).toBeNull();
    expect(cvTarget('POST', ['health'])).toBeNull();
  });

  it('accepts only http(s) service URLs', () => {
    expect(cvServiceUrl(undefined).origin).toBe('http://127.0.0.1:8001');
    expect(cvServiceUrl('http://10.0.0.5:9000').origin).toBe('http://10.0.0.5:9000');
    expect(cvServiceUrl('file:///etc/passwd').origin).toBe('http://127.0.0.1:8001');
    expect(cvServiceUrl('not a url').origin).toBe('http://127.0.0.1:8001');
  });
});

describe('segment choice', () => {
  it('validates the start and length and clips to the end of the video', () => {
    expect(segmentError(10, 8, 60, 15)).toBeNull();
    expect(segmentError(-1, 8, 60, 15)).toMatch(/0 s or later/);
    expect(segmentError(10, 0, 60, 15)).toMatch(/more than 0/);
    expect(segmentError(10, 16, 60, 15)).toMatch(/at most 15/);
    expect(segmentError(60, 5, 60, 15)).toMatch(/only 60.0 s/);
    expect(clippedSegment(55, 8, 60)).toEqual({ startSeconds: 55, durationSeconds: 5 });
    expect(clippedSegment(5, 8, null)).toEqual({ startSeconds: 5, durationSeconds: 8 });
  });
});
