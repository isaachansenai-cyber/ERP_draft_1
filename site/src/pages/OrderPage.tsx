import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { LinkButton, LoadFailure, Notice, PageHeader } from '../components/ui';
import { formatCents, formatRate } from '../lib/money';
import { formatPickup } from '../lib/time';
import { getOrder, WebApiError, type WebOrder } from '../lib/webApi';

const STATUS_TEXT: Record<WebOrder['status'], string> = {
  accepted: 'Received: the kitchen has your order',
  preparing: 'Being prepared',
  ready: 'Ready for pickup',
  completed: 'Picked up. Enjoy!',
  cancelled: 'Cancelled',
};

/** Order confirmation and receipt, found only by its private link (BUILD_PLAN §6.3). */
export function OrderPage() {
  const { token = '' } = useParams();
  const order = useQuery({
    queryKey: ['web', 'order', token],
    queryFn: () => getOrder(token),
    refetchInterval: 30_000,
    retry: (count, err) => !(err instanceof WebApiError && err.code === 'not_found') && count < 1,
  });

  if (order.isPending) {
    return (
      <>
        <PageHeader eyebrow="Your order" title="Loading your order…" />
        <p role="status" className="sr-only">
          Loading your order
        </p>
      </>
    );
  }
  if (order.isError) {
    const notFound = order.error instanceof WebApiError && order.error.code === 'not_found';
    return (
      <>
        <PageHeader eyebrow="Your order" title={notFound ? 'Order not found' : 'Your order'} />
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-10 md:px-8">
          {notFound ? (
            <Notice title="We could not find this order">
              Please check the link. If you placed an order, call the location you chose.
            </Notice>
          ) : (
            <LoadFailure error={order.error} onRetry={() => void order.refetch()} />
          )}
          <p>
            <LinkButton to="/menu">Back to the menu</LinkButton>
          </p>
        </div>
      </>
    );
  }

  const o = order.data;
  return (
    <>
      <PageHeader eyebrow="Thank you" title={`Order ${o.pickup_code}`} intro={`Pickup at ${o.location.name}.`} />
      <article className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 md:px-8" aria-label="Receipt">
        <div className="grid gap-4 rounded-xl border-2 border-charcoal/20 bg-cream p-5 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Pickup code</p>
            <p className="font-display text-4xl font-black" data-testid="pickup-code">
              {o.pickup_code}
            </p>
            <p className="text-sm">Give this code at the counter.</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Pickup</p>
            <p className="text-lg font-semibold" data-testid="pickup-time">
              {formatPickup(o.requested_pickup_at)}
            </p>
            <p>{o.location.name}</p>
            <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">Status</p>
            <p className="text-lg font-semibold" data-testid="order-status" aria-live="polite">
              {STATUS_TEXT[o.status]}
            </p>
          </div>
        </div>

        <section aria-labelledby="receipt-heading" className="flex flex-col gap-2">
          <h2 id="receipt-heading" className="font-display text-2xl font-bold">
            Receipt
          </h2>
          <p className="text-sm text-muted">
            Order {o.order_number}
            {o.pickup_name ? ` · for ${o.pickup_name}` : ''}
          </p>
          <ul className="divide-y divide-charcoal/15">
            {o.lines.map((l) => (
              <li key={l.item_id} className="flex justify-between gap-4 py-2">
                <span>
                  {l.quantity} × {l.name}
                </span>
                <span className="font-semibold">{formatCents(l.net_cents)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t-2 border-charcoal/30 pt-2">
            <dt>Subtotal</dt>
            <dd className="text-right">{formatCents(o.net_cents)}</dd>
            <dt>Sales tax ({formatRate(o.tax_rate)})</dt>
            <dd className="text-right">{formatCents(o.tax_cents)}</dd>
            <dt className="text-xl font-bold">Total</dt>
            <dd className="text-right text-xl font-bold" data-testid="order-total">
              {formatCents(o.total_cents)}
            </dd>
            {o.payment === 'simulated' ? (
              <>
                <dt>Simulated payment (demo, no card charged)</dt>
                <dd className="text-right">{formatCents(o.paid_cents)}</dd>
              </>
            ) : null}
            <dt className="font-semibold">{o.payment === 'simulated' ? 'Balance' : 'To pay at pickup'}</dt>
            <dd className="text-right font-semibold" data-testid="order-balance">
              {formatCents(o.balance_due_cents)}
            </dd>
          </dl>
          {o.note ? <p className="text-sm">Your note: {o.note}</p> : null}
        </section>

        <Notice title="Keep this page">
          Bookmark or print it: it is your receipt, and it shows when your order is ready. To change or cancel the
          order, please call {o.location.name}.
        </Notice>
        <p className="flex flex-wrap gap-3 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-11 items-center rounded-full bg-charcoal px-6 font-semibold text-cream focus-visible:outline focus-visible:outline-4 focus-visible:outline-ultramarine"
          >
            Print receipt
          </button>
          <LinkButton to="/menu" variant="light">
            Back to the menu
          </LinkButton>
        </p>
      </article>
    </>
  );
}
