import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describeError } from '../lib/errors';
import type { MutationState } from '../lib/useRpcMutation';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-emerald-800 text-white hover:bg-emerald-900 disabled:bg-slate-400',
  secondary: 'bg-white text-slate-900 border border-slate-400 hover:bg-slate-100 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-400',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONES: Record<Tone, string> = {
  info: 'border-sky-700 bg-sky-50 text-sky-950',
  success: 'border-emerald-700 bg-emerald-50 text-emerald-950',
  warning: 'border-amber-600 bg-amber-50 text-amber-950',
  error: 'border-red-700 bg-red-50 text-red-950',
};
const TONE_LABEL: Record<Tone, string> = { info: 'Info', success: 'Saved', warning: 'Check', error: 'Not saved' };

export function Notice({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border-l-4 p-3 text-sm ${TONES[tone]}`}>
      <p className="font-semibold">{title ?? TONE_LABEL[tone]}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const cls = {
    neutral: 'bg-slate-200 text-slate-900',
    good: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-700',
    warn: 'bg-amber-100 text-amber-950 ring-1 ring-amber-600',
    bad: 'bg-red-100 text-red-900 ring-1 ring-red-700',
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" aria-live="polite" className="p-4 text-sm text-slate-700">
      {label}
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-slate-400 p-4 text-sm text-slate-700">{children}</p>;
}

export function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: string }).code)
      : 'network_uncertain';
  return (
    <Notice tone="error" title={code === 'unauthorized' ? 'Not permitted' : 'Could not load'}>
      <p>{code === 'network_uncertain' ? 'The server could not be reached.' : describeError(code)}</p>
      {onRetry ? (
        <Button variant="secondary" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Notice>
  );
}

/** Uniform rendering of a write's outcome (AC29, AC32). */
export function MutationStatus<T>({
  state,
  successText,
  onRetry,
  onCheckAgain,
}: {
  state: MutationState<T>;
  successText: string;
  onRetry: () => void;
  onCheckAgain: () => void;
}) {
  if ('status' in state) {
    if (state.status === 'submitting')
      return (
        <Notice tone="info" title="Saving…">
          Waiting for the server to confirm.
        </Notice>
      );
    if (state.status === 'checking')
      return (
        <Notice tone="warning" title="Not confirmed — checking…">
          Checking whether the server saved it.
        </Notice>
      );
    return null;
  }
  switch (state.kind) {
    case 'success':
      return (
        <Notice tone="success">
          {successText}
          {state.replayed ? ' (already saved earlier — no duplicate was created)' : ''}
        </Notice>
      );
    case 'rejected':
      return <Notice tone="error">{describeError(state.error.code, state.error.detail)}</Notice>;
    case 'not_committed':
      return (
        <Notice tone="error" title="Not saved">
          <p>The server confirmed nothing was saved. You can safely try again.</p>
          <Button className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        </Notice>
      );
    case 'unconfirmed':
      return (
        <Notice tone="warning" title="Outcome unknown">
          <p>{describeError(state.error.code)} Do not re-enter it; check again when the connection is back.</p>
          <Button variant="secondary" className="mt-2" onClick={onCheckAgain}>
            Check again
          </Button>
        </Notice>
      );
  }
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-slate-900">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-600">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'min-h-11 rounded-md border border-slate-500 bg-white px-3 py-2 text-base text-slate-950 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500';

/**
 * Horizontally scrollable wrapper for wide tables. Keyboard users can focus it
 * and scroll with the arrow keys (WCAG 2.1.1); the label names the region.
 */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500"
    >
      {children}
    </div>
  );
}
