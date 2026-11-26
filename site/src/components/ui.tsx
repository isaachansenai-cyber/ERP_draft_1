import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { WebApiError } from '../lib/webApi';

const buttonBase =
  'inline-flex min-h-11 items-center justify-center rounded-full px-6 py-2 text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ultramarine';

const buttonVariants = {
  primary: 'bg-brick text-paper hover:bg-charcoal',
  light: 'bg-paper text-charcoal hover:bg-cream',
};

export function LinkButton({
  to,
  children,
  variant = 'primary',
}: {
  to: string;
  children: ReactNode;
  variant?: keyof typeof buttonVariants;
}) {
  return (
    <Link to={to} className={`${buttonBase} ${buttonVariants[variant]}`}>
      {children}
    </Link>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="font-semibold text-brick underline decoration-2 underline-offset-4 hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-ultramarine"
    >
      {children}
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-bold uppercase tracking-[0.2em] text-brick">{children}</p>;
}

/** Heading block at the top of every non-home page, clear of the fixed navigation bar. */
export function PageHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <header className="bg-charcoal px-4 pb-12 pt-28 text-cream md:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-saffron">{eyebrow}</p>
        <h1 className="mt-2 font-display text-4xl font-black md:text-5xl">{title}</h1>
        {intro ? <p className="mt-4 max-w-2xl text-lg">{intro}</p> : null}
      </div>
    </header>
  );
}

/** Honest status note, e.g. that online ordering is not open yet. Text plus color. */
export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border-l-8 border-saffron bg-cream p-4 text-charcoal">
      <p className="font-bold">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** A failed read from the ERP. Says plainly that nothing was ordered. */
export function LoadFailure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const code = error instanceof WebApiError ? error.code : 'network';
  if (code === 'not_configured') {
    return (
      <Notice title="Online ordering isn't available here">
        This copy of the site is not connected to the restaurant. Visit us in person to order.
      </Notice>
    );
  }
  return (
    <Notice title="We can't reach the restaurant right now">
      Prices and availability will appear when the connection is back. Nothing was ordered.
      {onRetry ? (
        <span className="mt-2 block">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center rounded-full bg-charcoal px-5 font-semibold text-cream focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine"
          >
            Try again
          </button>
        </span>
      ) : null}
    </Notice>
  );
}
