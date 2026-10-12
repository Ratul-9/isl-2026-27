'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { safeImageUrl } from '@/domain/presets/images';
import { cn } from '@/lib/cn';

/** Set `NEXT_PUBLIC_PRESET_IMAGES=off` to never contact the image host (fallbacks only). */
const IMAGES_ENABLED = process.env.NEXT_PUBLIC_PRESET_IMAGES !== 'off';

interface RemoteImageProps {
  /** Image URL as stored; only https URLs on an allowed host are ever requested. */
  src: string | null | undefined;
  /** Shown instead of the image when there is none, it is not allowed, it failed, and while it loads. */
  fallback: ReactNode;
  /** `contain` for logos (never cropped), `cover` for portraits (anchored to the top, where faces are). */
  fit?: 'contain' | 'cover';
  className?: string;
}

/**
 * An externally hosted picture with a guaranteed fallback. The box has a fixed size from the
 * caller, so a slow, huge or odd-shaped image can never move the layout. Nothing here blocks:
 * a failed or slow request leaves the fallback in place and the rest of the screen usable.
 */
export function RemoteImage({ src, fallback, fit = 'cover', className }: RemoteImageProps) {
  const url = IMAGES_ENABLED ? safeImageUrl(src) : null;
  // Keyed by URL so a new picture starts from "loading" again.
  return (
    <span className={cn('relative inline-flex shrink-0 overflow-hidden', className)}>
      <ImageBox key={url ?? 'none'} url={url} fallback={fallback} fit={fit} />
    </span>
  );
}

function ImageBox({ url, fallback, fit }: { url: string | null; fallback: ReactNode; fit: 'contain' | 'cover' }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const showImage = url !== null && state !== 'failed';
  return (
    <>
      {state === 'loaded' ? null : <span className="flex h-full w-full items-center justify-center">{fallback}</span>}
      {showImage ? (
        // External, copyrighted images are referenced, never optimised or proxied by this app.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'absolute inset-0 h-full w-full transition-opacity duration-200',
            fit === 'contain' ? 'object-contain' : 'object-cover object-top',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </>
  );
}
