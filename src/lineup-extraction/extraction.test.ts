// @vitest-environment node
// Server-only code: runs under Node, exactly like the API route.
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BENGALURU_GROUND_TRUTH } from '@/domain/lineupImport/fixtures';
import { createGeminiProvider, GEMINI_RESPONSE_SCHEMA, translateError } from './geminiProvider';
import { ExtractionFailed } from './provider';
import { DEFAULT_MODEL, readExtractionConfig, statusFromConfig } from './config';
import { lineupExtractionSchema } from './schema';
import type { LineupExtractionOutput } from './schema';
import { sniffImageType } from './imageType';
import { normalizeOutput } from './normalize';
import { extractLineup, validateRequest } from './service';

// A real 1×1 PNG and a minimal JPEG header, as base64 request payloads.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]).toString('base64');

/** What a model would return for the Bengaluru graphic, in the provider's output shape. */
function modelOutput(overrides: Partial<LineupExtractionOutput> = {}): LineupExtractionOutput {
  return {
    teamName: 'Bengaluru',
    teamNameSource: 'crest',
    coach: 'JOSE MUNOZ ZOYO',
    formation: '4-3-3',
    goalkeeperEdge: 'bottom',
    starters: BENGALURU_GROUND_TRUTH.starters.map((s) => ({ ...s })),
    substitutes: BENGALURU_GROUND_TRUTH.substitutes.map((s) => ({ ...s })),
    warnings: [],
    ...overrides,
  };
}

describe('request validation', () => {
  it('accepts real PNG and JPEG payloads', () => {
    expect(validateRequest({ mediaType: 'image/png', data: PNG_1X1 })).toMatchObject({ ok: true });
    expect(validateRequest({ mediaType: 'image/jpeg', data: JPEG_HEAD })).toMatchObject({ ok: true });
  });

  it.each([
    [null, 'invalid_request'],
    [{ mediaType: 'image/gif', data: PNG_1X1 }, 'unsupported_image'],
    [{ mediaType: 'image/png', data: '' }, 'invalid_request'],
    [{ mediaType: 'image/png', data: 'not base64 !!' }, 'invalid_request'],
    [{ mediaType: 'image/png', data: Buffer.from('hello world, definitely not an image').toString('base64') }, 'unsupported_image'],
    [{ mediaType: 'image/jpeg', data: PNG_1X1 }, 'unsupported_image'], // a PNG labelled JPEG
  ])('rejects %j as %s', (body, code) => {
    const result = validateRequest(body);
    expect(result).toMatchObject({ ok: false, failure: { code, retryable: false } });
  });

  it('rejects oversize images before decoding', () => {
    const huge = 'A'.repeat(8 * 1024 * 1024);
    expect(validateRequest({ mediaType: 'image/png', data: huge })).toMatchObject({ ok: false, failure: { code: 'image_too_large' } });
  });

  it('sniffs magic bytes', () => {
    expect(sniffImageType(Buffer.from(PNG_1X1, 'base64'))).toBe('image/png');
    expect(sniffImageType(Buffer.from(JPEG_HEAD, 'base64'))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('normalising provider output', () => {
  it('keeps every readable player and separates substitutes', () => {
    const lineup = normalizeOutput(modelOutput());
    expect(lineup.starters).toHaveLength(11);
    expect(lineup.substitutes).toHaveLength(9);
    expect(lineup.substitutes.every((s) => s.x === null && s.y === null)).toBe(true);
    expect(lineup).toMatchObject({ teamName: 'Bengaluru', teamNameSource: 'crest', formation: '4-3-3', coach: 'JOSE MUNOZ ZOYO' });
  });

  it('does not silently drop partial entries, and reports fully empty ones', () => {
    const base = modelOutput();
    const out = modelOutput({
      starters: [
        { ...base.starters[0], name: '', shirtNumber: 7 }, // number only
        { ...base.starters[1], name: 'ASHIQUE', shirtNumber: null }, // name only
        { ...base.starters[2], name: '  ', shirtNumber: null }, // nothing readable
      ],
    });
    const lineup = normalizeOutput(out);
    expect(lineup.starters).toHaveLength(2);
    expect(lineup.starters.every((p) => p.uncertain)).toBe(true);
    expect(lineup.warnings).toEqual(['An empty starter entry was ignored.']);
  });

  it('treats out-of-range coordinates and non-integers defensively', () => {
    const base = modelOutput();
    const lineup = normalizeOutput(modelOutput({ starters: [{ ...base.starters[0], x: 1.4, y: -0.1, shirtNumber: 9.7 }] }));
    expect(lineup.starters[0]).toMatchObject({ x: null, y: null, shirtNumber: 9 });
  });

  it('forgets a team-name source when there is no name', () => {
    expect(normalizeOutput(modelOutput({ teamName: '  ', teamNameSource: 'text' })).teamNameSource).toBe('unknown');
  });
});

describe('provider (mocked SDK client)', () => {
  const image = { mediaType: 'image/png' as const, data: PNG_1X1 };
  const reply = (text: string, extra: Record<string, unknown> = {}) => ({
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', ...extra }],
  });
  const clientReturning = (response: unknown) => ({ models: { generateContent: vi.fn(async () => response) } }) as never;

  it('asks for schema-constrained JSON, with the image inline and the instructions as system instruction', async () => {
    const generateContent = vi.fn(async () => reply(JSON.stringify(modelOutput())));
    const provider = createGeminiProvider({ apiKey: 'k', model: 'gemini-test', client: { models: { generateContent } } as never });
    await provider.extract(image);
    const params = (generateContent.mock.calls as unknown as [Record<string, unknown>][])[0][0] as {
      model: string;
      contents: { parts: Record<string, unknown>[] }[];
      config: Record<string, unknown>;
    };
    expect(params.model).toBe('gemini-test');
    expect(params.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_1X1 } });
    expect(params.contents[0].parts[1]).toHaveProperty('text');
    expect(params.config.responseMimeType).toBe('application/json');
    expect(params.config.responseJsonSchema).toBe(GEMINI_RESPONSE_SCHEMA);
    expect(String(params.config.systemInstruction)).toMatch(/Never invent/);
    expect(params.config).not.toHaveProperty('temperature');
  });

  it('sends a schema using only the documented subset (type arrays for nullables, no anyOf)', () => {
    const text = JSON.stringify(GEMINI_RESPONSE_SCHEMA);
    expect(text).not.toContain('anyOf');
    expect(text).not.toContain('$schema');
    const props = (GEMINI_RESPONSE_SCHEMA as { properties: Record<string, { type: unknown; enum?: unknown; description?: string }> }).properties;
    expect(props.goalkeeperEdge.type).toEqual(['string', 'null']);
    expect(props.goalkeeperEdge.description).toMatch(/top, bottom, left, right/);
    expect(props.teamNameSource.enum).toEqual(['text', 'crest', 'unknown']);
    // zod still enforces the enum after parsing, so dropping it from the schema loses no safety.
    expect(lineupExtractionSchema.safeParse({ ...modelOutput(), goalkeeperEdge: 'middle' }).success).toBe(false);
  });

  it('sends a schema with every field required', () => {
    const schema = GEMINI_RESPONSE_SCHEMA as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(['teamName', 'coach', 'formation', 'starters', 'substitutes', 'warnings']));
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['goalkeeperEdge', 'teamNameSource']));
  });

  it('returns the parsed output on success and ignores "thought" parts', async () => {
    const provider = createGeminiProvider({
      apiKey: 'k',
      model: 'm',
      client: clientReturning({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Let me think…', thought: true }, { text: JSON.stringify(modelOutput()) }] },
          },
        ],
      }),
    });
    expect((await provider.extract(image)).starters).toHaveLength(11);
  });

  it.each([
    ['a prompt block', 'refused', false, { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }],
    ['a safety stop', 'refused', false, reply('', { finishReason: 'SAFETY' })],
    ['a prohibited-content stop', 'refused', false, reply('', { finishReason: 'PROHIBITED_CONTENT' })],
    ['truncation', 'unreadable', true, reply('{"teamName": "Ben', { finishReason: 'MAX_TOKENS' })],
    ['an empty reply', 'unreadable', true, { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }],
    ['no candidates', 'unreadable', true, {}],
    ['text that is not JSON', 'unreadable', true, reply('I cannot read this image.')],
    ['JSON of the wrong shape', 'unreadable', true, reply('{"starters": "many"}')],
  ])('surfaces %s as %s (retryable: %s) instead of an empty lineup', async (_label, code, retryable, response) => {
    const provider = createGeminiProvider({ apiKey: 'k', model: 'm', client: clientReturning(response) });
    await expect(provider.extract(image)).rejects.toMatchObject({ failure: { code, retryable } });
  });

  it('maps API errors to safe, actionable failures', () => {
    const mk = (status: number, message = 'secret-detail AIza-abc') => new ApiError({ status, message });
    expect(translateError(mk(401)).failure).toMatchObject({ code: 'provider_auth', retryable: false });
    expect(translateError(mk(403)).failure).toMatchObject({ code: 'provider_auth', retryable: false });
    expect(translateError(mk(400, '{"error":{"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}')).failure).toMatchObject({
      code: 'provider_auth',
    });
    expect(translateError(mk(429)).failure).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(translateError(mk(504)).failure).toMatchObject({ code: 'timeout', retryable: true });
    expect(translateError(mk(404)).failure).toMatchObject({ code: 'provider_unavailable', retryable: false });
    expect(translateError(mk(400, 'FAILED_PRECONDITION: location is not supported')).failure).toMatchObject({ code: 'provider_unavailable', retryable: false });
    expect(translateError(mk(400)).failure).toMatchObject({ code: 'unsupported_image' });
    // A rejected request format must not be reported as a bad image.
    expect(translateError(mk(400, '{"error":{"message":"Invalid JSON payload received. Unknown name \\"responseJsonSchema\\"","status":"INVALID_ARGUMENT"}}')).failure).toMatchObject({
      code: 'unexpected',
      retryable: false,
    });
    expect(translateError(mk(503)).failure).toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect(translateError(new TypeError('fetch failed')).failure).toMatchObject({ code: 'provider_unavailable', retryable: true });
    expect(translateError(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })).failure).toMatchObject({ code: 'timeout' });
    expect(translateError(new Error('weird')).failure.code).toBe('unexpected');
    // Provider detail (which could echo request data or a key) never reaches the user.
    for (const status of [400, 401, 403, 404, 429, 503]) {
      expect(JSON.stringify(translateError(mk(status)).failure)).not.toMatch(/secret-detail|AIza/);
    }
  });
});

describe('extractLineup (service)', () => {
  it('returns a normalised lineup from a good provider', async () => {
    const provider = { extract: vi.fn(async () => modelOutput()) };
    const r = await extractLineup({ mediaType: 'image/png', data: PNG_1X1 }, provider);
    expect(r).toMatchObject({ ok: true, lineup: { formation: '4-3-3' } });
    expect(provider.extract).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider for an invalid request', async () => {
    const provider = { extract: vi.fn() };
    const r = await extractLineup({ mediaType: 'image/png', data: 'zzzz' }, provider);
    expect(r.ok).toBe(false);
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('passes through provider failures and converts surprises', async () => {
    const failing = { extract: vi.fn(async () => { throw new ExtractionFailed({ code: 'rate_limited', message: 'slow down', retryable: true }); }) };
    expect(await extractLineup({ mediaType: 'image/png', data: PNG_1X1 }, failing)).toEqual({
      ok: false,
      failure: { code: 'rate_limited', message: 'slow down', retryable: true },
    });
    const crashing = { extract: vi.fn(async () => { throw new TypeError('x is undefined'); }) };
    const r = await extractLineup({ mediaType: 'image/png', data: PNG_1X1 }, crashing);
    expect(r).toMatchObject({ ok: false, failure: { code: 'unexpected' } });
    expect(JSON.stringify(r)).not.toContain('undefined');
  });
});

describe('configuration', () => {
  it('reads the key, model and base URL from the environment and reports status without the key', () => {
    const cfg = readExtractionConfig({ GEMINI_API_KEY: ' AIza-secret ', LINEUP_EXTRACTION_MODEL: 'gemini-3.5-flash-lite', GEMINI_BASE_URL: ' http://127.0.0.1:1 ' });
    expect(cfg).toEqual({ apiKey: 'AIza-secret', model: 'gemini-3.5-flash-lite', baseUrl: 'http://127.0.0.1:1' });
    const status = statusFromConfig(cfg);
    expect(status).toEqual({ configured: true, provider: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(JSON.stringify(status)).not.toMatch(/secret|127\.0\.0\.1/);
  });

  it('is unconfigured without a key and defaults the model', () => {
    const cfg = readExtractionConfig({});
    expect(cfg).toEqual({ apiKey: null, model: DEFAULT_MODEL, baseUrl: null });
    expect(statusFromConfig(cfg)).toMatchObject({ configured: false, reason: expect.stringContaining('GEMINI_API_KEY') });
    expect(readExtractionConfig({ GEMINI_API_KEY: '   ' }).apiKey).toBeNull();
  });

  it('does not read other providers\' variables', () => {
    expect(readExtractionConfig({ ANTHROPIC_API_KEY: 'x', GOOGLE_API_KEY: 'y' }).apiKey).toBeNull();
  });
});

/**
 * Wire-level: the REAL @google/genai SDK talks HTTP to a local server that
 * implements just enough of POST /v1beta/models/{model}:generateContent. This
 * proves our request/response handling with the real SDK; it says NOTHING about
 * the quality of a real model's reading.
 */
describe('real SDK against a local generateContent stand-in', () => {
  let server: Server;
  let baseUrl: string;
  let received: { url: string; headers: IncomingMessage['headers']; body: Record<string, any> }[]; // eslint-disable-line @typescript-eslint/no-explicit-any -- test inspection of an arbitrary JSON body
  let respond: (call: number) => { status: number; json: unknown };

  const ok = (text: string, extra: Record<string, unknown> = {}) => ({
    status: 200,
    json: {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0, ...extra }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
    },
  });
  const apiError = (status: number, message: string, state: string) => ({ status, json: { error: { code: status, message, status: state } } });

  beforeEach(async () => {
    received = [];
    respond = () => ok(JSON.stringify(modelOutput()));
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        const { status, json } = respond(received.length);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => server.close(() => r())));

  const providerFor = (maxAttempts = 1) =>
    createGeminiProvider({ apiKey: 'AIza-test-key', model: 'gemini-test-model', baseUrl, maxAttempts, retryDelaySeconds: 0.01 });

  it('sends the image, schema and key correctly and parses the structured reply', async () => {
    const lineup = await providerFor().extract({ mediaType: 'image/png', data: PNG_1X1 });
    expect(lineup.formation).toBe('4-3-3');
    expect(lineup.starters).toHaveLength(11);

    expect(received).toHaveLength(1);
    const { url, headers, body } = received[0];
    expect(url).toContain('/models/gemini-test-model:generateContent');
    expect(headers['x-goog-api-key']).toBe('AIza-test-key');
    expect(url).not.toContain('AIza-test-key'); // the key is never put in the URL
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_1X1 } });
    expect(body.systemInstruction.parts[0].text).toMatch(/Never invent/);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig).not.toHaveProperty('responseSchema');
    const schema = body.generationConfig.responseJsonSchema;
    expect(schema.required).toEqual(expect.arrayContaining(['teamName', 'coach', 'formation', 'starters', 'substitutes']));
  });

  it('turns HTTP errors from the API into the right failures', async () => {
    const p = providerFor();
    respond = () => apiError(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT');
    await expect(p.extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({ failure: { code: 'provider_auth', retryable: false } });
    respond = () => apiError(403, 'Permission denied', 'PERMISSION_DENIED');
    await expect(p.extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({ failure: { code: 'provider_auth' } });
    respond = () => apiError(429, 'Resource exhausted', 'RESOURCE_EXHAUSTED');
    await expect(p.extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({ failure: { code: 'rate_limited', retryable: true } });
    respond = () => apiError(404, 'models/x is not found', 'NOT_FOUND');
    await expect(p.extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({ failure: { code: 'provider_unavailable', retryable: false } });
  });

  it('retries a transient 503 and then succeeds', async () => {
    respond = (call) => (call === 1 ? apiError(503, 'The model is overloaded.', 'UNAVAILABLE') : ok(JSON.stringify(modelOutput())));
    const lineup = await providerFor(3).extract({ mediaType: 'image/png', data: PNG_1X1 });
    expect(lineup.starters).toHaveLength(11);
    expect(received).toHaveLength(2);
  });

  it('gives up after the configured attempts with a retryable failure', async () => {
    respond = () => apiError(503, 'The model is overloaded.', 'UNAVAILABLE');
    await expect(providerFor(2).extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({
      failure: { code: 'provider_unavailable', retryable: true },
    });
    expect(received).toHaveLength(2);
  });

  it.each([
    ['text that is not JSON', 'I cannot read this image.'],
    ['JSON of the wrong shape', '{"teamName": 42}'],
  ])('reports a malformed model reply (%s) as unreadable and retryable, not as an empty lineup', async (_label, text) => {
    respond = () => ok(text);
    await expect(providerFor().extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({
      failure: { code: 'unreadable', retryable: true },
    });
  });

  it('reports a safety block as refused (not retryable)', async () => {
    respond = () => ({ status: 200, json: { promptFeedback: { blockReason: 'IMAGE_SAFETY' } } });
    await expect(providerFor().extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({
      failure: { code: 'refused', retryable: false },
    });
  });

  it('reports an unreachable endpoint as a retryable provider problem', async () => {
    const dead = createGeminiProvider({ apiKey: 'k', model: 'm', baseUrl: 'http://127.0.0.1:1', maxAttempts: 1 });
    await expect(dead.extract({ mediaType: 'image/png', data: PNG_1X1 })).rejects.toMatchObject({
      failure: { code: 'provider_unavailable', retryable: true },
    });
  });
});
