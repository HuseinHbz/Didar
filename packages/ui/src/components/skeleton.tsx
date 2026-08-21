import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn.js';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}
