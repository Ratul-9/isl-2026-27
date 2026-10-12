// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkImageFile, ImageProblem, MAX_SOURCE_BYTES, prepareImage } from './imageFile';
import type { ImageDecoder } from './imageFile';
import { MAX_IMAGE_BYTES } from './schema';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];

const file = (bytes: number[] | Uint8Array, name: string, type = 'image/png') => new File([new Uint8Array(bytes)], name, { type });
const problem = async (promise: Promise<unknown>) => (await promise.then(() => null, (e: unknown) => e)) as ImageProblem;

describe('checkImageFile', () => {
  it('accepts PNG and JPEG by content', async () => {
    await expect(checkImageFile(file([...PNG_HEAD, 0, 0, 0, 0], 'a.png'))).resolves.toBe('image/png');
    await expect(checkImageFile(file([...JPEG_HEAD, 0, 0, 0, 0, 0, 0], 'a.jpg', 'image/jpeg'))).resolves.toBe('image/jpeg');
  });

  it('trusts the bytes, not the name or declared type', async () => {
    await expect(checkImageFile(file([...JPEG_HEAD, 0, 0, 0, 0], 'really-a-jpeg.png', 'image/png'))).resolves.toBe('image/jpeg');
    const e = await problem(checkImageFile(file(new TextEncoder().encode('not an image at all'), 'lineup.png')));
    expect(e).toBeInstanceOf(ImageProblem);
    expect(e.code).toBe('unsupported_type');
    expect(e.message).toContain('lineup.png');
  });

  it('rejects other image formats and documents', async () => {
    const webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
    expect((await problem(checkImageFile(file(webp, 'a.webp', 'image/webp')))).code).toBe('unsupported_type');
    const pdf = new TextEncoder().encode('%PDF-1.7');
    expect((await problem(checkImageFile(file(pdf, 'a.pdf', 'application/pdf')))).code).toBe('unsupported_type');
  });

  it('rejects empty and oversized files', async () => {
    expect((await problem(checkImageFile(file([], 'empty.png')))).code).toBe('empty');
    const big = file(PNG_HEAD, 'big.png');
    Object.defineProperty(big, 'size', { value: MAX_SOURCE_BYTES + 1 });
    expect((await problem(checkImageFile(big))).code).toBe('too_large');
  });
});

describe('prepareImage', () => {
  const good = (bytes: number[] = [...PNG_HEAD, 1, 2, 3]): ImageDecoder => ({
    scale: vi.fn(async () => ({ bytes: new Uint8Array(bytes), width: 1568, height: 880 })),
  });

  it('returns base64 of the decoded bytes with the file name and sizes', async () => {
    const decoder = good([...PNG_HEAD, 9, 9]);
    const out = await prepareImage(file([...PNG_HEAD, 0, 0, 0, 0, 0, 0], 'x.png'), decoder);
    expect(out).toMatchObject({ mediaType: 'image/png', width: 1568, height: 880, name: 'x.png', uploadBytes: PNG_HEAD.length + 2 });
    expect(Buffer.from(out.data, 'base64')).toEqual(Buffer.from([...PNG_HEAD, 9, 9]));
  });

  it('reports a corrupt image (valid header, undecodable body) as unreadable rather than throwing raw', async () => {
    const decoder: ImageDecoder = { scale: async () => { throw new Error('InvalidStateError'); } };
    const e = await problem(prepareImage(file([...PNG_HEAD, 0, 0, 0, 0], 'broken.png'), decoder));
    expect(e).toBeInstanceOf(ImageProblem);
    expect(e.code).toBe('unreadable');
    expect(e.message).toContain('broken.png');
  });

  it('re-encodes more aggressively when the first result is too large, then gives up clearly', async () => {
    const huge = new Uint8Array(MAX_IMAGE_BYTES + 10);
    huge.set(PNG_HEAD);
    const scale = vi.fn<ImageDecoder['scale']>(async () => ({ bytes: huge, width: 1, height: 1 }));
    const e = await problem(prepareImage(file([...PNG_HEAD, 0, 0, 0, 0], 'huge.png'), { scale }));
    expect(e.code).toBe('too_large');
    expect(scale).toHaveBeenCalledTimes(2);
    expect(scale.mock.calls[1][1]).toBe('image/jpeg');
  });

  it('never calls the decoder for files that fail the cheap checks', async () => {
    const decoder = good();
    await problem(prepareImage(file(new TextEncoder().encode('hello world, plain text'), 'a.png'), decoder));
    expect(decoder.scale).not.toHaveBeenCalled();
  });
});
