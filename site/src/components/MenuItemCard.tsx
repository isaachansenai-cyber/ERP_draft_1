import { useState } from 'react';
import { ALLERGEN_PENDING } from '../content/site';
import { toneFor } from '../content/countries';
import { prepNote } from '../lib/describe';
import { formatCents } from '../lib/money';
import type { MenuItem } from '../lib/webApi';
import { useShop } from '../state/shop';
import { PlaceholderArt } from './PlaceholderArt';
import { QuantityStepper } from './QuantityStepper';

/**
 * One menu item with the ERP's live price and availability. `orderingOpen` is
 * the location's state: when it is closed the card shows the price only.
 */
export function MenuItemCard({ item, orderingOpen }: { item: MenuItem; orderingOpen: boolean }) {
  const { lines, add } = useShop();
  const inCart = lines.find((l) => l.item_id === item.item_id)?.quantity ?? 0;
  const room = Math.max(0, item.max_orderable - inCart);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState<number | null>(null);
  const note = prepNote(item);
  const canAdd = orderingOpen && item.available && room > 0;

  return (
    <article
      aria-labelledby={`item-${item.item_id}`}
      className="flex flex-col overflow-hidden rounded-xl border border-charcoal/15 bg-paper shadow-sm"
    >
      <div className="aspect-[4/3]">
        <PlaceholderArt tone={toneFor(item.item_id)} subject={item.name} />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {item.country ? <p className="text-sm font-bold uppercase tracking-wider text-brick">{item.country}</p> : null}
        <h3 id={`item-${item.item_id}`} className="font-display text-xl font-bold">
          {item.name}
        </h3>
        <p>{item.description}</p>
        {note ? <p className="text-sm font-semibold">{note}</p> : null}
        <p className="text-sm text-muted">
          {item.allergen_note ? `Allergens: ${item.allergen_note}` : ALLERGEN_PENDING}
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
          <p className="text-xl font-bold">
            {item.price_cents !== null ? formatCents(item.price_cents) : 'Price not set'}
          </p>
          {orderingOpen ? (
            <p
              className={`rounded-full px-3 py-1 text-sm font-semibold ${
                item.available ? 'bg-jade text-paper' : 'bg-cream text-charcoal'
              }`}
            >
              {item.available ? 'Available' : 'Sold out — back soon'}
            </p>
          ) : null}
        </div>
        {canAdd ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.min(quantity, room);
              add(item.item_id, n, item.max_orderable);
              setAdded(n);
              setQuantity(1);
            }}
          >
            <QuantityStepper
              label={`Quantity of ${item.name}`}
              value={Math.min(quantity, room)}
              max={room}
              onChange={setQuantity}
            />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full bg-brick px-5 font-semibold text-paper hover:bg-charcoal focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-ultramarine"
            >
              Add to cart
            </button>
          </form>
        ) : orderingOpen && item.available ? (
          <p className="text-sm font-semibold">Your cart already has the most we can make right now ({inCart}).</p>
        ) : null}
        <p aria-live="polite" className="min-h-5 text-sm font-semibold text-jade">
          {added !== null ? `Added ${added} to your cart.` : ''}
        </p>
      </div>
    </article>
  );
}
