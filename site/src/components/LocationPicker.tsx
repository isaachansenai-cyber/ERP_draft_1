import { closedMessage, hoursSummary } from '../lib/describe';
import { useLocations } from '../lib/queries';
import { useShop } from '../state/shop';
import { LoadFailure } from './ui';

/** Pickup location choice. The menu, prices, stock and cart all follow it. */
export function LocationPicker() {
  const locations = useLocations();
  const { locationId, chooseLocation } = useShop();

  if (locations.isPending) return <p role="status">Loading pickup locations…</p>;
  if (locations.isError) return <LoadFailure error={locations.error} onRetry={() => void locations.refetch()} />;

  return (
    <fieldset className="rounded-xl border border-charcoal/15 bg-cream p-4">
      <legend className="px-1 font-display text-xl font-bold">Pickup location</legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {locations.data.map((l) => {
          const checked = l.location_id === locationId;
          return (
            <label
              key={l.location_id}
              className={`flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border-2 bg-paper p-3 focus-within:outline focus-within:outline-4 focus-within:outline-ultramarine ${
                checked ? 'border-brick' : 'border-charcoal/20'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="pickup-location"
                  value={l.location_id}
                  checked={checked}
                  onChange={() => chooseLocation(l.location_id)}
                  className="h-5 w-5 accent-brick"
                />
                <span className="text-lg font-semibold">{l.name}</span>
              </span>
              <span className="text-sm">{hoursSummary(l)}</span>
              <span className={`text-sm font-semibold ${l.ordering_open ? 'text-jade' : 'text-muted'}`}>
                {l.ordering_open ? 'Taking online orders' : closedMessage(l.status_reason)}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
