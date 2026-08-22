import { Button } from './button.js';

export interface PaginationProps {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

/** Dumb prev/next control for cursor-paginated lists — every admin list
 * endpoint returns a forward-only `nextCursor`, never total counts or a
 * page number (real cursor pagination, not offset), so this component
 * has no notion of "page 3 of 10." The caller (a small
 * `useCursorPagination` hook in apps/admin) owns the cursor history
 * stack that makes "previous" possible. */
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  disabled,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-end gap-2 pt-3">
      <Button
        variant="outline"
        size="sm"
        onClick={onPrevious}
        disabled={Boolean(disabled) || !hasPrevious}
      >
        قبلی
      </Button>
      <Button variant="outline" size="sm" onClick={onNext} disabled={Boolean(disabled) || !hasNext}>
        بعدی
      </Button>
    </div>
  );
}
