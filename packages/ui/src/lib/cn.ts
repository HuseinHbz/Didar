import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges Tailwind class lists, resolving conflicts (last one wins) — the standard shadcn/ui helper. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
