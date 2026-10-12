// @vitest-environment node
// Server-only code: runs under Node, exactly like the API route.
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, FileState } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleAnalysis } from '@/domain/replay/fixtures';
import { DEFAULT_MAX_MB, DEFAULT_VIDEO_MODEL, readVideoConfig, videoStatusFromConfig } from './config';
import { createGeminiVideoProvider, GEMINI_VIDEO_RESPONSE_SCHEMA, parseDuration, translateVideoError } from './geminiVideoProvider';
import type { GeminiVideoClient } from './geminiVideoProvider';
import { sniffVideoType, validateVideoUpload } from './media';
import { normalizeAnalysis } from './normalize';
import { VideoAnalysisFailed } from './provider';
import type { VideoProvider } from './provider';
import { videoAnalysisWireSchema } from './schema';
import type { VideoAnalysisWire, VideoLimits } from './schema';
import { analyzeVideo } from './service';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const MP4_HEAD = [0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom'), 0, 0, 2, 0];
const MOV_HEAD = [0, 0, 0, 0x14, ...ascii('ftyp'), ...ascii('qt  '), 0, 0, 0, 0];
const WEBM_HEAD = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...ascii('webm')];
const blobOf = (head: number[], extra = 64) => new Blob([new Uint8Array([...head, ...new Array(extra).fill(7)])]);

const LIMITS: VideoLimits = { maxBytes: 1024 * 1024, maxSeconds: 60, samplingFps: 5, types: ['video/mp4', 'video/quicktime', 'video/webm'] };
const wire = (): VideoAnalysisWire => sampleAnalysis() as VideoAnalysisWire;

describe('configuration', () => {
  it('defaults, and reads limits from the environment', () => {
    const d = readVideoConfig({});
    expect(d).toMatchObject({ apiKey: null, model: DEFAULT_VIDEO_MODEL, baseUrl: null });
    expect(d.limits).toMatchObject({ maxBytes: DEFAULT_MAX_MB * 1024 * 1024, maxSeconds: 60, samplingFps: 5 });
    const c = readVideoConfig({
      GEMINI_API_KEY: ' AIza-secret ',
      GEMINI_MODEL: 'gemini-x',
      VIDEO_MAX_MB: '10',
      VIDEO_MAX_SECONDS: '30',
      VIDEO_SAMPLING_FPS: '8',
      GEMINI_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(c).toMatchObject({ apiKey: 'AIza-secret', model: 'gemini-x', baseUrl: 'http://127.0.0.1:9' });
    expect(c.limits).toMatchObject({ maxBytes: 10 * 1024 * 1024, maxSeconds: 30, samplingFps: 8 });
  });

  it('keeps the frame rate inside Gemini’s valid range and ignores nonsense values', () => {
    expect(readVideoConfig({ VIDEO_SAMPLING_FPS: '999' }).limits.samplingFps).toBe(24);
    expect(readVideoConfig({ VIDEO_SAMPLING_FPS: '-3' }).limits.samplingFps).toBe(5);
    expect(readVideoConfig({ VIDEO_MAX_MB: 'abc' }).limits.maxBytes).toBe(DEFAULT_MAX_MB * 1024 * 1024);
  });

  it('reports status and limits without the key', () => {
    const configured = videoStatusFromConfig(readVideoConfig({ GEMINI_API_KEY: 'AIza-secret' }));
    expect(configured).toMatchObject({ configured: true, provider: 'gemini' });
    expect(JSON.stringify(configured)).not.toContain('secret');
    expect(videoStatusFromConfig(readVideoConfig({}))).toMatchObject({ configured: false, reason: expect.stringContaining('GEMINI_API_KEY') });
  });
});

describe('upload checks', () => {
  it('recognises MP4, MOV and WebM by their bytes, not their names', () => {
    expect(sniffVideoType(new Uint8Array(MP4_HEAD))).toBe('video/mp4');
    expect(sniffVideoType(new Uint8Array(MOV_HEAD))).toBe('video/quicktime');
    expect(sniffVideoType(new Uint8Array(WEBM_HEAD))).toBe('video/webm');
    expect(sniffVideoType(new Uint8Array(ascii('GIF89a-not-a-video-at-all')))).toBeNull();
    expect(sniffVideoType(new Uint8Array(ascii('<html>not video</html>')))).toBeNull();
    expect(sniffVideoType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...ascii('matroska')]))).toBeNull(); // .mkv, not WebM
  });

  it('enforces size, type and duration limits with readable reasons', () => {
    const ok = (over: Partial<Parameters<typeof validateVideoUpload>[0]> = {}) =>
      validateVideoUpload({ sizeBytes: 500, head: new Uint8Array(MP4_HEAD), durationHintSeconds: 20, ...over }, LIMITS);
    expect(ok()).toEqual({ ok: true, mimeType: 'video/mp4' });
    expect(ok({ sizeBytes: 0 })).toMatchObject({ ok: false, failure: { code: 'invalid_request' } });
    expect(ok({ sizeBytes: LIMITS.maxBytes + 1 })).toMatchObject({ ok: false, failure: { code: 'file_too_large', message: expect.stringContaining('limit') } });
    expect(ok({ head: new Uint8Array(ascii('RIFFxxxxAVI LIST')) })).toMatchObject({ ok: false, failure: { code: 'unsupported_media' } });
    expect(ok({ durationHintSeconds: 61 })).toMatchObject({ ok: false, failure: { code: 'video_too_long' } });
    expect(ok({ durationHintSeconds: null })).toMatchObject({ ok: true });
  });
});

describe('normalising the model’s analysis', () => {
  it('accepts a good analysis unchanged apart from rounding', () => {
    const out = normalizeAnalysis(wire(), { durationSeconds: 12 });
    expect(out.primaryEvent?.type).toBe('shotOnTarget');
    expect(out.keyframes).toHaveLength(3);
    expect(out.warnings).toEqual(['Camera angle makes depth hard to judge; positions are approximate.']);
  });

  it('clamps positions, times and confidences and says so', () => {
    const w = wire();
    w.keyframes[0].positions[0] = { actorId: 'a1', x: 140, y: -20, confidence: 3, basis: 'observed' };
    w.keyframes[1].timeSeconds = 400;
    const out = normalizeAnalysis(w, { durationSeconds: 12 });
    expect(out.keyframes[0].positions[0]).toMatchObject({ x: 100, y: 0, confidence: 1 });
    expect(out.keyframes.at(-1)!.timeSeconds).toBeLessThanOrEqual(12);
    expect(out.warnings.join(' ')).toMatch(/clamped/);
  });

  it('drops positions and references to players that were never listed', () => {
    const w = wire();
    w.keyframes[0].positions.push({ actorId: 'ghost', x: 10, y: 10, confidence: 0.5, basis: 'estimated' });
    w.trajectories[0].targetActorId = 'ghost';
    const out = normalizeAnalysis(w, { durationSeconds: 12 });
    expect(out.keyframes[0].positions.some((p) => p.actorId === 'ghost')).toBe(false);
    expect(out.trajectories[0].targetActorId).toBeNull();
    expect(out.warnings.join(' ')).toMatch(/never listed/);
  });

  it('removes duplicate actor ids and extra balls, keeps time order, and never lets an event end before it starts', () => {
    const w = wire();
    w.actors.push({ ...w.actors[0] }); // duplicate id
    w.actors.push({ ...w.actors[4], id: 'ball2' });
    w.keyframes.reverse();
    w.primaryEvent!.startSeconds = 9;
    w.primaryEvent!.endSeconds = 3;
    const out = normalizeAnalysis(w, { durationSeconds: 12 });
    expect(out.actors.map((a) => a.id)).toEqual(['a1', 'a2', 'd1', 'gk', 'ball']);
    expect(out.keyframes.map((k) => k.timeSeconds)).toEqual([4, 6, 9]);
    expect(out.primaryEvent!.endSeconds).toBeGreaterThanOrEqual(out.primaryEvent!.startSeconds);
  });

  it('notes when an event was described but nothing could be placed', () => {
    const w = wire();
    w.keyframes = [];
    const out = normalizeAnalysis(w, { durationSeconds: null });
    expect(out.warnings.join(' ')).toMatch(/no positions/);
  });

  it('wire schema rejects structurally wrong answers', () => {
    expect(videoAnalysisWireSchema.safeParse({ summary: 'x' }).success).toBe(false);
    expect(videoAnalysisWireSchema.safeParse({ ...wire(), primaryEvent: { ...wire().primaryEvent, type: 'wizardry' } }).success).toBe(false);
    expect(videoAnalysisWireSchema.safeParse(wire()).success).toBe(true);
  });

  it('sends Gemini a schema in the documented subset', () => {
    const text = JSON.stringify(GEMINI_VIDEO_RESPONSE_SCHEMA);
    expect(text).not.toContain('anyOf');
    expect(text).not.toContain('$schema');
    expect((GEMINI_VIDEO_RESPONSE_SCHEMA as { required: string[] }).required).toEqual(
      expect.arrayContaining(['summary', 'primaryEvent', 'actors', 'keyframes', 'trajectories', 'timeline', 'warnings']),
    );
  });
});

// ------------------------------------------------------------------ provider (fake client)

interface FakeOptions {
  uploadState?: FileState;
  getStates?: FileState[];
  duration?: string | undefined;
  generate?: () => unknown;
  uploadError?: unknown;
}

function fakeClient(opts: FakeOptions = {}) {
  const calls: string[] = [];
  const getStates = [...(opts.getStates ?? [FileState.ACTIVE])];
  const client: GeminiVideoClient = {
    files: {
      upload: vi.fn(async () => {
        calls.push('upload');
        if (opts.uploadError) throw opts.uploadError;
        return {
          name: 'files/abc',
          uri: 'https://example.test/files/abc',
          mimeType: 'video/mp4',
          state: opts.uploadState ?? FileState.PROCESSING,
          videoMetadata: opts.duration === undefined ? { videoDuration: '12.5s' } : { videoDuration: opts.duration },
        };
      }),
      get: vi.fn(async () => {
        calls.push('get');
        return {
          name: 'files/abc',
          uri: 'https://example.test/files/abc',
          mimeType: 'video/mp4',
          state: getStates.length > 1 ? getStates.shift() : getStates[0],
          videoMetadata: { videoDuration: opts.duration ?? '12.5s' },
        };
      }),
      delete: vi.fn(async () => {
        calls.push('delete');
        return {};
      }),
    },
    models: {
      generateContent: vi.fn(async () => {
        calls.push('generate');
        const out = opts.generate ? opts.generate() : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(wire()) }] } }] };
        if (out instanceof Error) throw out;
        return out as never;
      }),
    },
  };
  return { client, calls };
}

const makeProvider = (client: GeminiVideoClient, over: Partial<Parameters<typeof createGeminiVideoProvider>[0]> = {}) =>
  createGeminiVideoProvider({
    apiKey: 'k',
    model: 'gemini-test',
    samplingFps: 6,
    maxSeconds: 60,
    processingTimeoutMs: 5_000,
    analysisTimeoutMs: 5_000,
    pollIntervalMs: 1,
    sleep: async () => undefined,
    client,
    ...over,
  });
const input = { data: blobOf(MP4_HEAD), mimeType: 'video/mp4', durationHintSeconds: null };

describe('Gemini video provider (fake client)', () => {
  it('uploads, waits for processing, analyses once with an explicit frame rate, then deletes the file', async () => {
    const { client, calls } = fakeClient({ getStates: [FileState.PROCESSING, FileState.PROCESSING, FileState.ACTIVE] });
    const result = await makeProvider(client).analyze(input);
    expect(calls).toEqual(['upload', 'get', 'get', 'get', 'generate', 'delete']);
    expect(result).toMatchObject({ durationSeconds: 12.5, samplingFps: 6, model: 'gemini-test' });
    expect(result.wire.primaryEvent?.type).toBe('shotOnTarget');

    const params = vi.mocked(client.models.generateContent).mock.calls[0][0] as {
      model: string;
      contents: { parts: Record<string, unknown>[] }[];
      config: Record<string, unknown>;
    };
    expect(params.model).toBe('gemini-test');
    expect(params.contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://example.test/files/abc', mimeType: 'video/mp4' },
      videoMetadata: { fps: 6 },
    });
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseJsonSchema).toBe(GEMINI_VIDEO_RESPONSE_SCHEMA);
    expect(String(params.config.systemInstruction)).toMatch(/Never invent/);
    expect(String(params.config.systemInstruction)).toMatch(/about 6 frames per second/);
  });

  it('skips polling when the upload is already active', async () => {
    const { client, calls } = fakeClient({ uploadState: FileState.ACTIVE });
    await makeProvider(client).analyze(input);
    expect(calls).toEqual(['upload', 'generate', 'delete']);
  });

  it('reports a clip the provider could not process, and still deletes it', async () => {
    const { client, calls } = fakeClient({ getStates: [FileState.FAILED] });
    await expect(makeProvider(client).analyze(input)).rejects.toMatchObject({ failure: { code: 'processing_failed', retryable: false } });
    expect(calls).toContain('delete');
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('gives up waiting after the processing timeout', async () => {
    const { client } = fakeClient({ getStates: [FileState.PROCESSING] });
    const provider = makeProvider(client, { processingTimeoutMs: 20, sleep: () => new Promise((r) => setTimeout(r, 15)) });
    await expect(provider.analyze(input)).rejects.toMatchObject({ failure: { code: 'processing_timeout', retryable: true } });
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('refuses a clip whose MEASURED duration exceeds the limit even if the hint said it was short', async () => {
    const { client, calls } = fakeClient({ duration: '120.0s' });
    await expect(makeProvider(client, { maxSeconds: 60 }).analyze({ ...input, durationHintSeconds: 10 })).rejects.toMatchObject({
      failure: { code: 'video_too_long' },
    });
    expect(client.models.generateContent).not.toHaveBeenCalled();
    expect(calls).toContain('delete');
  });

  it('uses the duration hint when the provider reports none', async () => {
    const { client } = fakeClient({ duration: 'n/a' });
    const r = await makeProvider(client).analyze({ ...input, durationHintSeconds: 20 });
    expect(r.durationSeconds).toBe(20);
  });

  it('never retries a paid analysis by itself, even on a transient server error', async () => {
    const { client, calls } = fakeClient({ generate: () => new ApiError({ status: 503, message: 'overloaded' }) });
    await expect(makeProvider(client).analyze(input)).rejects.toMatchObject({ failure: { code: 'provider_unavailable', retryable: true } });
    expect(calls.filter((c) => c === 'generate')).toHaveLength(1);
    expect(calls.at(-1)).toBe('delete');
  });

  it.each([
    ['a prompt block', { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }, 'refused', false],
    ['a safety stop', { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, 'refused', false],
    ['truncation', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"summ' }] } }] }, 'unreadable', true],
    ['an empty reply', { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }, 'unreadable', true],
    ['text that is not JSON', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Sorry, I cannot.' }] } }] }, 'unreadable', true],
    ['JSON of the wrong shape', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"starters":[]}' }] } }] }, 'unreadable', true],
  ])('surfaces %s as %s (retryable: %s)', async (_label, response, code, retryable) => {
    const { client } = fakeClient({ generate: () => response });
    await expect(makeProvider(client).analyze(input)).rejects.toMatchObject({ failure: { code, retryable } });
  });

  it('maps API errors to safe, actionable failures with no provider detail', () => {
    const mk = (status: number, message = 'secret-detail AIza-abc') => new ApiError({ status, message });
    expect(translateVideoError(mk(403)).failure).toMatchObject({ code: 'provider_auth', retryable: false });
    expect(translateVideoError(mk(400, 'API key not valid. Please pass a valid API key.')).failure.code).toBe('provider_auth');
    expect(translateVideoError(mk(429)).failure).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(translateVideoError(mk(504)).failure).toMatchObject({ code: 'timeout' });
    expect(translateVideoError(mk(404)).failure).toMatchObject({ code: 'provider_unavailable', retryable: false });
    expect(translateVideoError(mk(400)).failure).toMatchObject({ code: 'unsupported_media' });
    expect(translateVideoError(new TypeError('fetch failed')).failure).toMatchObject({ code: 'network', retryable: true });
    expect(translateVideoError(new Error('weird')).failure.code).toBe('unexpected');
    for (const status of [400, 403, 404, 429, 503]) {
      expect(JSON.stringify(translateVideoError(mk(status)).failure)).not.toMatch(/secret-detail|AIza/);
    }
  });

  it('parses durations', () => {
    expect(parseDuration('12.5s')).toBe(12.5);
    expect(parseDuration('7')).toBe(7);
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe('analyzeVideo (service)', () => {
  const okProvider = (): VideoProvider => ({
    analyze: vi.fn(async () => ({ wire: wire(), durationSeconds: 12, samplingFps: 5, model: 'gemini-test' })),
  });

  it('validates, calls the provider once and returns a normalised analysis with provenance', async () => {
    const provider = okProvider();
    const r = await analyzeVideo({ data: blobOf(MP4_HEAD), durationHintSeconds: 12 }, { provider, limits: LIMITS, now: () => new Date('2026-10-12T09:00:00Z') });
    expect(r).toMatchObject({ ok: true, meta: { model: 'gemini-test', samplingFps: 5, durationSeconds: 12, analysedAt: '2026-10-12T09:00:00.000Z' } });
    expect(provider.analyze).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider for an invalid upload', async () => {
    const provider = okProvider();
    const text = await analyzeVideo({ data: new Blob(['not a video, just text']), durationHintSeconds: null }, { provider, limits: LIMITS });
    expect(text).toMatchObject({ ok: false, failure: { code: 'unsupported_media' } });
    const big = await analyzeVideo({ data: blobOf(MP4_HEAD, LIMITS.maxBytes), durationHintSeconds: null }, { provider, limits: LIMITS });
    expect(big).toMatchObject({ ok: false, failure: { code: 'file_too_large' } });
    expect(provider.analyze).not.toHaveBeenCalled();
  });

  it('passes through provider failures and converts surprises without leaking them', async () => {
    const failing: VideoProvider = {
      analyze: async () => {
        throw new VideoAnalysisFailed({ code: 'rate_limited', message: 'slow down', retryable: true });
      },
    };
    expect(await analyzeVideo({ data: blobOf(MP4_HEAD), durationHintSeconds: null }, { provider: failing, limits: LIMITS })).toEqual({
      ok: false,
      failure: { code: 'rate_limited', message: 'slow down', retryable: true },
    });
    const crashing: VideoProvider = {
      analyze: async () => {
        throw new TypeError('x is undefined');
      },
    };
    const r = await analyzeVideo({ data: blobOf(MP4_HEAD), durationHintSeconds: null }, { provider: crashing, limits: LIMITS });
    expect(r).toMatchObject({ ok: false, failure: { code: 'unexpected' } });
    expect(JSON.stringify(r)).not.toContain('undefined');
  });
});

// ------------------------------------------------------------------ wire level (real SDK)

/**
 * The REAL @google/genai SDK against a local HTTP server that implements just
 * enough of the Files API (resumable upload, get, delete) and generateContent.
 * This proves our use of the SDK; it says NOTHING about how well a real model
 * understands football footage.
 */
describe('real SDK against a local Gemini stand-in', () => {
  let server: Server;
  let baseUrl: string;
  let requests: { method: string; url: string; headers: IncomingMessage['headers']; body: Buffer }[];
  let polls: number;
  let generateResponse: (() => { status: number; json: unknown }) | null;

  beforeEach(async () => {
    requests = [];
    polls = 0;
    generateResponse = null;
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const url = req.url ?? '';
        requests.push({ method: req.method ?? '', url, headers: req.headers, body });
        const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
          res.writeHead(status, { 'content-type': 'application/json', ...headers });
          res.end(JSON.stringify(json));
        };
        const fileJson = (state: string) => ({
          name: 'files/clip1',
          uri: `${baseUrl}/v1beta/files/clip1`,
          mimeType: 'video/mp4',
          sizeBytes: String(body.length),
          state,
          videoMetadata: { videoDuration: '12s' },
        });
        if (req.method === 'POST' && url.startsWith('/upload/v1beta/files')) {
          return send(200, {}, { 'x-goog-upload-url': `${baseUrl}/upload-session/1`, 'x-goog-upload-status': 'active' });
        }
        if (req.method === 'POST' && url.startsWith('/upload-session/1')) {
          return send(200, { file: fileJson('PROCESSING') }, { 'x-goog-upload-status': 'final' });
        }
        if (req.method === 'GET' && url.startsWith('/v1beta/files/clip1')) {
          polls += 1;
          return send(200, fileJson(polls >= 2 ? 'ACTIVE' : 'PROCESSING'));
        }
        if (req.method === 'DELETE' && url.startsWith('/v1beta/files/clip1')) return send(200, {});
        if (req.method === 'POST' && url.includes(':generateContent')) {
          const custom = generateResponse?.();
          if (custom) return send(custom.status, custom.json);
          return send(200, {
            candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(wire()) }] } }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 },
          });
        }
        return send(404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const provider = () =>
    createGeminiVideoProvider({
      apiKey: 'AIza-test-key',
      model: 'gemini-test-model',
      baseUrl,
      samplingFps: 5,
      maxSeconds: 60,
      processingTimeoutMs: 5_000,
      analysisTimeoutMs: 5_000,
      pollIntervalMs: 5,
    });

  it('uploads, polls, analyses with the chosen frame rate and cleans up, with the key in a header only', async () => {
    const r = await provider().analyze({ data: blobOf(MP4_HEAD, 2000), mimeType: 'video/mp4', durationHintSeconds: null });
    expect(r.wire.primaryEvent?.type).toBe('shotOnTarget');
    expect(r.durationSeconds).toBe(12);

    const kinds = requests.map((q) => `${q.method} ${q.url.split('?')[0].replace(/\/models\/[^:]+/, '/models/M')}`);
    expect(kinds[0]).toBe('POST /upload/v1beta/files');
    expect(kinds[1]).toBe('POST /upload-session/1');
    expect(kinds.filter((k) => k.startsWith('GET /v1beta/files/clip1')).length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain('POST /v1beta/models/M:generateContent');
    expect(kinds.filter((k) => k.includes(':generateContent'))).toHaveLength(1); // not retried
    // The upload carried the clip's bytes.
    expect(requests[1].body.length).toBe(MP4_HEAD.length + 2000);

    const generate = requests.find((q) => q.url.includes(':generateContent'))!;
    expect(generate.headers['x-goog-api-key']).toBe('AIza-test-key');
    expect(generate.url).not.toContain('AIza-test-key');
    const body = JSON.parse(generate.body.toString('utf8'));
    expect(body.contents[0].parts[0]).toEqual({
      fileData: { fileUri: `${baseUrl}/v1beta/files/clip1`, mimeType: 'video/mp4' },
      videoMetadata: { fps: 5 },
    });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseJsonSchema.required).toEqual(expect.arrayContaining(['primaryEvent', 'keyframes']));

    // Cleanup is best effort and asynchronous: give it a tick.
    await new Promise((r2) => setTimeout(r2, 50));
    expect(requests.some((q) => q.method === 'DELETE' && q.url.startsWith('/v1beta/files/clip1'))).toBe(true);
  });

  it('reports a rejected key and a quota error with the right failures', async () => {
    generateResponse = () => ({ status: 400, json: { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } } });
    await expect(provider().analyze({ data: blobOf(MP4_HEAD), mimeType: 'video/mp4', durationHintSeconds: null })).rejects.toMatchObject({
      failure: { code: 'provider_auth' },
    });
    generateResponse = () => ({ status: 429, json: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } } });
    await expect(provider().analyze({ data: blobOf(MP4_HEAD), mimeType: 'video/mp4', durationHintSeconds: null })).rejects.toMatchObject({
      failure: { code: 'rate_limited', retryable: true },
    });
  });

  it('does not repeat a paid analysis by itself when the service answers 503 (the SDK would otherwise retry)', async () => {
    generateResponse = () => ({ status: 503, json: { error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } } });
    await expect(provider().analyze({ data: blobOf(MP4_HEAD), mimeType: 'video/mp4', durationHintSeconds: null })).rejects.toMatchObject({
      failure: { code: 'provider_unavailable', retryable: true },
    });
    expect(requests.filter((q) => q.url.includes(':generateContent'))).toHaveLength(1);
  });

  it('a malformed reply is "unreadable", and the analysis is not repeated on its own', async () => {
    generateResponse = () => ({ status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] } });
    await expect(provider().analyze({ data: blobOf(MP4_HEAD), mimeType: 'video/mp4', durationHintSeconds: null })).rejects.toMatchObject({
      failure: { code: 'unreadable', retryable: true },
    });
    expect(requests.filter((q) => q.url.includes(':generateContent'))).toHaveLength(1);
  });
});
