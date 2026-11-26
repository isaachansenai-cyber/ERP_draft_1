import { countries } from '../content/countries';
import { sauces } from '../content/site';
import { closedMessage } from '../lib/describe';
import { useMenu } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { WebApiError, type MenuItem } from '../lib/webApi';
import { useShop } from '../state/shop';
import { DishCard } from './DishCard';
import { LocationPicker } from './LocationPicker';
import { MenuItemCard } from './MenuItemCard';
import { LoadFailure, Notice } from './ui';

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', timeStyle: 'short' });

function Grid({ items, orderingOpen }: { items: MenuItem[]; orderingOpen: boolean }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <MenuItemCard key={item.item_id} item={item} orderingOpen={orderingOpen} />
      ))}
    </div>
  );
}

/** The dishes as content only, for when no location is chosen or no backend is connected. */
function StaticDishes() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {countries.map((c) => (
        <DishCard key={c.id} country={c} />
      ))}
    </div>
  );
}

/**
 * The menu with the ERP's live prices and availability for the chosen location.
 * `dishes` shows only the dishes (home page); `full` adds the retail sauces.
 */
export function LiveMenu({ variant }: { variant: 'dishes' | 'full' }) {
  const { locationId } = useShop();
  const menu = useMenu(supabase ? locationId : null);

  if (!supabase) {
    return (
      <div className="flex flex-col gap-6">
        <LoadFailure error={new WebApiError('not_configured')} />
        <StaticDishes />
      </div>
    );
  }

  let body;
  if (!locationId) {
    body = (
      <>
        <p className="text-lg">Choose a pickup location to see prices and what is available.</p>
        <StaticDishes />
      </>
    );
  } else if (menu.isPending) {
    body = <p role="status">Loading the menu…</p>;
  } else if (menu.isError) {
    body = <LoadFailure error={menu.error} onRetry={() => void menu.refetch()} />;
  } else {
    const { ordering_open: open, status_reason: reason, items } = menu.data;
    const dishes = items.filter((i) => i.item_type === 'finished_dish');
    const retail = items.filter((i) => i.item_type === 'retail');
    body = (
      <>
        {!open ? <Notice title="Not taking online orders">{closedMessage(reason)}</Notice> : null}
        <p className="text-sm text-muted" data-testid="menu-updated">
          Prices and availability as of {timeFormat.format(menu.dataUpdatedAt)}. They refresh automatically.
        </p>
        {variant === 'full' ? (
          <>
            <section aria-labelledby="dishes" className="flex flex-col gap-4">
              <h2 id="dishes" className="font-display text-3xl font-bold">
                Dishes
              </h2>
              <Grid items={dishes} orderingOpen={open} />
            </section>
            {retail.length > 0 ? (
              <section aria-labelledby="sauces" className="flex flex-col gap-4">
                <h2 id="sauces" className="font-display text-3xl font-bold">
                  {sauces.heading}
                </h2>
                <p className="text-lg">{sauces.body}</p>
                <Grid items={retail} orderingOpen={open} />
              </section>
            ) : null}
          </>
        ) : (
          <Grid items={dishes} orderingOpen={open} />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <LocationPicker />
      {body}
    </div>
  );
}
