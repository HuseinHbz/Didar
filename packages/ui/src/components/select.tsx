import type { SelectHTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

/** Native `<select>`, styled to match `Input` — no Radix Select
 * dependency added for a form control the platform already provides
 * accessibly (keyboard nav, screen-reader semantics) for free. */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        'border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
