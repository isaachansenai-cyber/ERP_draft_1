import { LocationPicker } from '../components/LocationPicker';
import { QuantityStepper } from '../components/QuantityStepper';
import { LinkButton, LoadFailure, Notice, PageHeader } from '../components/ui';
import { priceCart, type PricedLine } from '../lib/cart';
import { formatCents } from '../lib/money';
import { useLocations, useMenu } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { WebApiError } from '../lib/webApi';
import { useShop } from '../state/shop';

const PROBLEM_TEXT = {
  sold_out: 'Sold out right now. Remove it to continue.',
  too_many: 'We can make fewer of these right now. Lower the quantity to continue.',
  unknown_item: 'No longer on the menu. Remove it to continue.',
};

function CartLineRow({ line }: { line: PricedLine }) {
  const { setLineQuantity } = useShop();
  const max = line.item ? Math.max(line.item.max_orderable, line.quantity) : line.quantity;
  const name = line.item?.name ?? line.item_id;
  return (
    <li className="flex flex-col gap-2 border-b border-charcoal/15 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-lg font-semibold">{name}</p>
        {line.item?.price_cents != null ? (
          <p className="text-sm text-muted">{formatCents(line.item.price_cents)} each</p>
        ) : null}
        {line.problem ? (
          <p role="alert" className="mt-1 font-semibold text-brick">
            {PROBLEM_TEXT[line.problem]}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {line.problem === 'sold_out' || line.problem === 'unknown_item' ? null : (
          <QuantityStepper
            label={`Quantity of ${name}`}
            value={line.quantity}
            max={max}
            onChange={(n) => setLineQuantity(line.item_id, n, line.item?.max_orderable ?? 0)}
          />
        )}
        <button
          type="button"
          onClick={() => setLineQuantity(line.item_id, 0, 0)}
          className="min-h-11 px-3 font-semibold text-brick underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ultramarine"
        >
          Remove<span className="sr-only"> {name}</span>
        </button>
        <p className="w-full text-right text-lg font-bold sm:w-24">
          {line.lineCents !== null && line.problem === null ? formatCents(line.lineCents) : '—'}
        </p>
      </div>
    </li>
  );
}

/** The browser-side draft for the chosen location. Checkout arrives in W4 (BUILD_PLAN §8). */
export function CartPage() {
  const { locationId, lines } = useShop();
  const locations = useLocations();
  const menu = useMenu(supabase ? locationId : null);
  const locationName = locations.data?.find((l) => l.location_id === locationId)?.name;

  let body;
  if (!supabase) {
    body = <LoadFailure error={new WebApiError('not_configured')} />;
  } else if (!locationId) {
    body = (
      <>
        <p className="text-lg">Choose where you will pick up, then add dishes from the menu.</p>
        <LocationPicker />
      </>
    );
  } else if (lines.length === 0) {
    body = (
      <>
        <p className="text-lg">Your cart is empty.</p>
        <p>
          <LinkButton to="/menu">Browse the menu</LinkButton>
        </p>
      </>
    );
  } else if (menu.isPending) {
    body = <p role="status">Checking prices and availability…</p>;
  } else if (menu.isError) {
    body = <LoadFailure error={menu.error} onRetry={() => void menu.refetch()} />;
  } else {
    const cart = priceCart(lines, menu.data.items);
    body = (
      <>
        <p className="font-semibold" data-testid="cart-status">
          Not ordered yet: this cart is saved in this browser only.
        </p>
        <ul aria-label="Cart items">
          {cart.lines.map((l) => (
            <CartLineRow key={l.item_id} line={l} />
          ))}
        </ul>
        <div className="flex items-baseline justify-between text-xl">
          <span className="font-semibold">Subtotal</span>
          <span className="font-bold" data-testid="cart-subtotal">
            {formatCents(cart.subtotalCents)}
          </span>
        </div>
        <p className="text-sm text-muted">Tax, pickup time and payment are confirmed at checkout.</p>
        {!menu.data.ordering_open ? (
          <Notice title="Not taking online orders">This location is not taking online orders right now.</Notice>
        ) : !cart.ok ? (
          <Notice title="Some items need your attention">Fix the items marked above before checking out.</Notice>
        ) : (
          <Notice title="Checkout is not open yet">
            Online checkout arrives in the next update. Nothing has been ordered.
          </Notice>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Pickup order"
        title="Your cart"
        intro={locationName ? `Pickup at ${locationName}.` : undefined}
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 md:px-8">
        {body}
        <p className="text-sm text-muted">We are open daily 12–8 pm. Every order is for pickup.</p>
      </div>
    </>
  );
}
