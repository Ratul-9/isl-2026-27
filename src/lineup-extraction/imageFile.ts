import { sniffImageType } from './imageType';
import { MAX_IMAGE_BYTES, MAX_LONG_EDGE_PX } from './schema';
import type { AllowedImageType } from './schema';

/** Browser-side checks and preparation of a lineup image before it is sent anywhere. */

export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type ImageProblemCode = 'empty' | 'unsupported_type' | 'too_large' | 'unreadable';

export class ImageProblem extends Error {
  constructor(
    readonly code: ImageProblemCode,
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedImage {
  mediaType: AllowedImageType;
  /** Base64 of the (possibly downscaled) image bytes. */
  data: string;
  width: number;
  height: number;
  /** Size of the original file. */
  originalBytes: number;
  /** Size of what will be uploaded. */
  uploadBytes: number;
  name: string;
}

/** What the browser has to provide; replaced by a fake in tests (jsdom has no canvas). */
export interface ImageDecoder {
  /** Decodes and, if larger than `maxLongEdge`, scales down; returns encoded bytes. */
  scale(file: Blob, type: AllowedImageType, maxLongEdge: number, quality: number): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}

async function headBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 16).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Cheap checks that need no decoding. Throws ImageProblem. */
export async function checkImageFile(file: { name: string; size: number; slice: Blob['slice'] } & Blob): Promise<AllowedImageType> {
  if (file.size === 0) throw new ImageProblem('empty', `“${file.name}” is empty.`);
  if (file.size > MAX_SOURCE_BYTES) throw new ImageProblem('too_large', `“${file.name}” is larger than ${MAX_SOURCE_BYTES / (1024 * 1024)} MB.`);
  const real = sniffImageType(await headBytes(file));
  if (!real) {
    throw new ImageProblem('unsupported_type', `“${file.name}” is not a PNG or JPEG image. Other formats (WebP, HEIC, PDF…) are not supported.`);
  }
  return real;
}

/**
 * Validates, then downscales to the model's useful resolution (long edge
 * 1568 px) so uploads are small and cheap without losing legibility.
 */
export async function prepareImage(file: File, decoder: ImageDecoder = browserDecoder): Promise<PreparedImage> {
  const type = await checkImageFile(file);
  let result;
  try {
    result = await decoder.scale(file, type, MAX_LONG_EDGE_PX, 0.92);
    if (result.bytes.length > MAX_IMAGE_BYTES) {
      // Rare: a huge lossless image. Re-encode more aggressively.
      result = await decoder.scale(file, 'image/jpeg', MAX_LONG_EDGE_PX, 0.8);
    }
  } catch {
    throw new ImageProblem('unreadable', `“${file.name}” could not be opened as an image. It may be corrupt.`);
  }
  if (result.bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageProblem('too_large', `“${file.name}” is still larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB after resizing.`);
  }
  const outType = sniffImageType(result.bytes) ?? type;
  return {
    mediaType: outType,
    data: toBase64(result.bytes),
    width: result.width,
    height: result.height,
    originalBytes: file.size,
    uploadBytes: result.bytes.length,
    name: file.name,
  };
}

/** Canvas-based decoder for real browsers. */
const browserDecoder: ImageDecoder = {
  async scale(file, type, maxLongEdge, quality) {
    const bitmap = await createImageBitmap(file);
    try {
      const longEdge = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, maxLongEdge / longEdge);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      // JPEG has no alpha: paint white first so transparent PNGs don't turn black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality);
      });
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
    } finally {
      bitmap.close();
    }
  },
};
