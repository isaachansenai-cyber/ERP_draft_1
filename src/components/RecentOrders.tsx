// Recent completed orders at the selected location, so staff can pick one to refund, return or
// exchange instead of typing its order number or pickup code. Read-only: staff already read orders
// at their own locations (orders_read policy), so this needs no database change.
import { useQuery } from '@tanstack/react-query';
import { formatCents, formatDateTime } from '../lib/format';
import { supabase } from '../lib/supabase';
import { Empty, Loading, QueryError } from './ui';

// Matches the return policy's 30-day window: older orders can't be returned anyway.
const WINDOW_DAYS = 30;

interface RecentOrder {
  order_id: string;
  order_number: string;
  pickup_code: string;
  pickup_name: string | null;
  revision: number;
  total_cents: number;
  completed_at: string;
  order_lines: Array<{ revision: number; quantity: number; items: { name: string } | null }>;
}

function itemSummary(o: RecentOrder): string {
  const lines = o.order_lines.filter((l) => l.revision === o.revision);
  return lines.map((l) => `${l.quantity} × ${l.items?.name ?? 'item'}`).join(', ');
}

export function RecentOrders({
  locationId,
  selected,
  onPick,
}: {
  locationId: string;
  selected: string;
  onPick: (orderNumber: string) => void;
}) {
  const recent = useQuery({
    // Shares the 'order-for-return' prefix so the list refreshes after a refund, return or exchange.
    queryKey: ['order-for-return', locationId, 'recent'],
    queryFn: async () => {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('orders')
        .select(
          'order_id, order_number, pickup_code, pickup_name, revision, total_cents, completed_at, order_lines(revision, quantity, items!order_lines_item_id_is_sellable_fkey(name))',
        )
        .eq('location_id', locationId)
        .eq('status', 'completed')
        .gte('completed_at', since)
        .order('completed_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as unknown as RecentOrder[];
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Completed orders, last {WINDOW_DAYS} days</h2>
      {recent.isPending ? (
        <Loading />
      ) : recent.error ? (
        <QueryError error={recent.error} onRetry={() => void recent.refetch()} />
      ) : recent.data.length === 0 ? (
        <Empty>No completed orders at this location in the last {WINDOW_DAYS} days.</Empty>
      ) : (
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {recent.data.map((o) => (
            <li key={o.order_id}>
              <button
                type="button"
                onClick={() => onPick(o.order_number)}
                className={`w-full rounded-md border p-2 text-left text-sm ${selected === o.order_number ? 'border-emerald-800 bg-emerald-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}
              >
                <span className="font-mono font-semibold">{o.pickup_code}</span>
                {o.pickup_name ? ` · ${o.pickup_name}` : ''} · {formatCents(o.total_cents)} ·{' '}
                {formatDateTime(o.completed_at)}
                <span className="block text-xs text-slate-700">{itemSummary(o)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
