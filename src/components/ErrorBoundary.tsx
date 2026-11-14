import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A rendering failure must never leave a blank screen or look like success.
 * Shows what happened and how to recover; nothing is retried automatically.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="m-6 rounded-md border-l-4 border-red-700 bg-red-50 p-4 text-red-950">
        <p className="font-semibold">This screen could not be displayed.</p>
        <p className="mt-1 text-sm">
          Nothing was saved by this error. Reload the page to try again; unsent POS drafts are kept.
        </p>
        <button
          type="button"
          className="mt-2 min-h-11 rounded-md border border-red-700 px-3"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
