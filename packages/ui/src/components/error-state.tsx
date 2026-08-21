import { Button } from './button.js';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** A real network/API error, distinct from `EmptyState` (a real,
 * successful, zero-result response) — never conflated so an operator
 * can tell "nothing here" from "something is broken." */
export function ErrorState({ title = 'خطا در دریافت اطلاعات', message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center gap-2 rounded-md border p-10 text-center"
    >
      <p className="text-destructive font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          تلاش مجدد
        </Button>
      ) : null}
    </div>
  );
}
