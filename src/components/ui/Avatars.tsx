'use client';

import { cn } from '@/lib/cn';
import { RemoteImage } from './RemoteImage';

/** Up to two capital letters from a name or abbreviation ("Sunil Chhetri" → "SC"). */
function initialsOf(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[\s.\-_/]+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const SIZES = { sm: 'h-8 w-8 text-[11px]', md: 'h-10 w-10 text-xs', lg: 'h-14 w-14 text-sm' } as const;

/** A team crest, or its abbreviation (or initials) when there is no usable image. */
export function TeamLogo({
  url,
  name,
  abbreviation,
  size = 'md',
  className,
}: {
  url: string | null | undefined;
  name: string;
  abbreviation?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const label = (abbreviation && abbreviation.trim()) || initialsOf(name);
  return (
    <RemoteImage
      src={url}
      fit="contain"
      className={cn('rounded-md bg-zinc-800', SIZES[size], className)}
      fallback={
        <span aria-hidden className="font-semibold tracking-tight text-zinc-300">
          {label.slice(0, 4)}
        </span>
      }
    />
  );
}

/** A player headshot, or their initials when there is no usable image. */
export function PlayerAvatar({
  url,
  name,
  size = 'md',
  className,
}: {
  url: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <RemoteImage
      src={url}
      fit="cover"
      className={cn('rounded-full bg-zinc-800', SIZES[size], className)}
      fallback={
        <span aria-hidden className="font-semibold text-zinc-300">
          {initialsOf(name)}
        </span>
      }
    />
  );
}
