'use client';

import { useState, type ReactNode } from 'react';

import { Button } from './button.js';
import { Dialog } from './dialog.js';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Rendered above the confirm/cancel buttons — e.g. the consequences of
   * an irreversible action, or a reason textarea for a rejection. */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}

/**
 * Every destructive/irreversible admin action in this app routes through
 * this component — Phase 5's own rule ("require explicit confirmation
 * for dangerous operations, show consequences for irreversible ones").
 * `onConfirm` is awaited and its own error is surfaced inline (never
 * swallowed) rather than closing the dialog optimistically — a rejected
 * mutation must leave the operator able to see what happened and retry.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = 'تأیید',
  cancelLabel = 'انصراف',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'خطای ناشناخته رخ داد.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void handleConfirm()}
            disabled={pending}
          >
            {pending ? '...' : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {error ? (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
