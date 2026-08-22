'use client';

import { Button } from '@iecp/ui';
import { Component, type ReactNode } from 'react';

import { reportError } from '@/lib/observability/error-reporter';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Root error boundary around the authenticated shell — a render
 * exception (as opposed to a data-fetch error, which each page's own
 * `ErrorState` already handles) still reports through the same
 * `reportError()` interface rather than only logging to the console
 * inline. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    reportError(error, {
      route: typeof window === 'undefined' ? undefined : window.location.pathname,
    });
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="text-xl font-semibold">خطایی رخ داد</h1>
          <p className="text-muted-foreground max-w-md text-sm">
            یک خطای غیرمنتظره در پنل مدیریت رخ داد. تیم فنی از این خطا مطلع شد.
          </p>
          <Button
            onClick={() => {
              this.setState({ error: null });
            }}
          >
            تلاش مجدد
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
