import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:hover:bg-emerald-700',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:hover:bg-zinc-800 border border-zinc-700',
  ghost: 'text-zinc-300 hover:bg-zinc-800 disabled:hover:bg-transparent',
  danger: 'bg-red-600/90 text-white hover:bg-red-500 disabled:hover:bg-red-600/90',
};

const SIZES: Record<Size, string> = {
  // Touch devices get taller targets (WCAG 2.5.8 / platform guidance).
  sm: 'h-8 px-2.5 text-xs gap-1.5 pointer-coarse:h-10 pointer-coarse:px-3',
  md: 'h-10 px-4 text-sm gap-2 pointer-coarse:h-11',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
