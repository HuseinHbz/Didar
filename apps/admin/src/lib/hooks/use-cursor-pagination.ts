import { useState } from 'react';

/**
 * Every admin list endpoint returns a forward-only `nextCursor` (real
 * cursor pagination, never a page number or total count). This hook owns
 * the cursor-history stack that makes a "previous" button possible on
 * top of a forward-only API — the stack is client state, never sent to
 * or trusted from the server beyond the cursor strings themselves.
 */
export function useCursorPagination() {
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);

  const cursor = cursorStack[index];

  function goToNext(nextCursor: string | null) {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, index + 1), nextCursor]);
    setIndex((i) => i + 1);
  }

  function goToPrevious() {
    setIndex((i) => Math.max(0, i - 1));
  }

  function reset() {
    setCursorStack([undefined]);
    setIndex(0);
  }

  return {
    cursor,
    hasPrevious: index > 0,
    goToNext,
    goToPrevious,
    reset,
  };
}
