'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Native `<dialog>`-backed modal — no Radix dependency added for
 * something the platform now provides accessibly for free (focus trap,
 * Escape-to-close, top-layer stacking, `::backdrop`). `showModal()`/
 * `close()` are imperative DOM calls, kept in sync with the `open` prop
 * via `useEffect` rather than driven by the `open`/`onClose` attributes
 * directly, so a parent fully controls dialog state the same way every
 * other component in this library is controlled.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        onOpenChange(false);
      }}
      onCancel={() => {
        onOpenChange(false);
      }}
      className={cn(
        'bg-background text-foreground w-full max-w-md rounded-lg border p-0 shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-sm',
        className,
      )}
      onClick={(event) => {
        if (event.target === ref.current) onOpenChange(false);
      }}
    >
      <div className="p-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </dialog>
  );
}
