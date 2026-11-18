import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/format';
import {
  BAR_H,
  BAR_TOP,
  chartGeometry,
  H,
  LEFT,
  LINE_H,
  LINE_TOP,
  PLOT_W,
  RIGHT,
  W,
  type StockHistoryDay,
} from '../lib/stockChart';
import { callRpc } from '../lib/rpc';
import { Badge, Button, Loading, QueryError, ScrollRegion } from './ui';

export type { StockHistoryDay };

export interface StockHistory {
  location_id: string;
  item_id: string;
  name: string;
  base_unit: string;
  days: number;
  date_from: string;
  date_to: string;
  timezone: string;
  refreshed_at: string;
  data_label: string;
  on_hand_now: string;
  available_now: string;
  reorder_applicable: boolean;
  reorder_point: string | null;
  suggested_order: { quantity: string | null; packs: string | null; demand_source: string | null } | null;
  suggested_order_missing_reason: 'insufficient_history' | 'planning_inputs_missing' | null;
  next_delivery: { po_number: string; expected_date: string | null; quantity: string; late: boolean } | null;
  series: StockHistoryDay[];
}

const RANGES = [7, 30, 90] as const;

/** Trim trailing zeros from a decimal string (display only). */
function q(value: string | null | undefined): string {
  if (value == null) return '—';
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function Chart({ data }: { data: StockHistory }) {
  const g = chartGeometry(data.series, data.reorder_applicable ? data.reorder_point : null);
  const barW = Math.max(1, g.band * 0.38);
  const labelIdx = [...new Set([0, Math.floor((g.n - 1) / 2), g.n - 1])];
  const unit = data.base_unit;
  const summary =
    `On hand ${q(data.on_hand_now)} ${unit} today` +
    (g.rop != null ? `, reorder point ${q(data.reorder_point)} ${unit}` : ', no reorder point set') +
    `. ${data.days} days from ${data.date_from} to ${data.date_to}.`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full max-w-3xl"
      role="img"
      aria-label={`Stock history for ${data.name}. ${summary}`}
      data-testid="stock-history-svg"
    >
      {/* stock level panel */}
      <text x={LEFT} y={LINE_TOP - 10} className="fill-slate-900 text-[12px] font-semibold">
        On hand at end of day ({unit})
      </text>
      <line x1={LEFT} x2={W - RIGHT} y1={LINE_TOP + LINE_H} y2={LINE_TOP + LINE_H} className="stroke-slate-400" />
      <text x={LEFT - 6} y={LINE_TOP + 4} textAnchor="end" className="fill-slate-700 text-[11px]">
        {Math.round(g.lineMax).toLocaleString()}
      </text>
      <text x={LEFT - 6} y={LINE_TOP + LINE_H} textAnchor="end" className="fill-slate-700 text-[11px]">
        0
      </text>
      {g.rop != null ? (
        <g data-testid="reorder-line">
          <line
            x1={LEFT}
            x2={W - RIGHT}
            y1={g.yLine(g.rop)}
            y2={g.yLine(g.rop)}
            strokeDasharray="6 4"
            strokeWidth={2}
            className="stroke-red-700"
          />
          <text x={LEFT + 4} y={g.yLine(g.rop) - 5} className="fill-red-800 text-[11px] font-semibold">
            Reorder point {q(data.reorder_point)}
          </text>
        </g>
      ) : null}
      <path d={g.path} fill="none" strokeWidth={2.5} className="stroke-emerald-800" />
      {data.series.map((d, i) => (
        <circle key={d.date} cx={g.x(i)} cy={g.yLine(g.onHand[i]!)} r={g.n > 40 ? 1.5 : 3} className="fill-emerald-800">
          <title>{`${d.date}: on hand ${q(d.on_hand)} ${unit}`}</title>
        </circle>
      ))}

      {/* daily movements panel */}
      <text x={LEFT} y={BAR_TOP - 10} className="fill-slate-900 text-[12px] font-semibold">
        Per day ({unit}): used, wasted, delivered
      </text>
      <line x1={LEFT} x2={W - RIGHT} y1={BAR_TOP + BAR_H} y2={BAR_TOP + BAR_H} className="stroke-slate-400" />
      {g.hasBars ? (
        <>
          <text x={LEFT - 6} y={BAR_TOP + 4} textAnchor="end" className="fill-slate-700 text-[11px]">
            {Math.round(g.barMax).toLocaleString()}
          </text>
          <text x={LEFT - 6} y={BAR_TOP + BAR_H} textAnchor="end" className="fill-slate-700 text-[11px]">
            0
          </text>
        </>
      ) : (
        <text
          x={LEFT + PLOT_W / 2}
          y={BAR_TOP + BAR_H / 2 + 4}
          textAnchor="middle"
          className="fill-slate-700 text-[12px]"
        >
          No usage, waste or deliveries in this period
        </text>
      )}
      {data.series.map((d, i) => {
        const usedH = g.barHeight(g.used[i]!);
        const wasteH = g.barHeight(g.wasted[i]!);
        const recvH = g.barHeight(g.received[i]!);
        const base = BAR_TOP + BAR_H;
        return (
          <g key={d.date}>
            {usedH > 0 ? (
              <rect x={g.x(i) - barW} y={base - usedH} width={barW} height={usedH} className="fill-slate-600">
                <title>{`${d.date}: used ${q(d.used)} ${unit}`}</title>
              </rect>
            ) : null}
            {wasteH > 0 ? (
              <rect x={g.x(i) - barW} y={base - usedH - wasteH} width={barW} height={wasteH} className="fill-red-600">
                <title>{`${d.date}: wasted ${q(d.wasted)} ${unit}`}</title>
              </rect>
            ) : null}
            {recvH > 0 ? (
              <rect x={g.x(i)} y={base - recvH} width={barW} height={recvH} className="fill-sky-600">
                <title>{`${d.date}: delivered ${q(d.received)} ${unit}`}</title>
              </rect>
            ) : null}
          </g>
        );
      })}
      {labelIdx.map((i) => (
        <text
          key={i}
          x={g.x(i)}
          y={BAR_TOP + BAR_H + 16}
          textAnchor={i === 0 ? 'start' : i === g.n - 1 ? 'end' : 'middle'}
          className="fill-slate-700 text-[11px]"
        >
          {data.series[i]?.date.slice(5)}
        </text>
      ))}
    </svg>
  );
}

function Legend() {
  const swatch = 'inline-block h-3 w-3 rounded-sm align-middle';
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Chart legend">
      <li>
        <span className={`${swatch} bg-emerald-800`} /> On hand (end of day)
      </li>
      <li>
        <span className="inline-block w-4 border-t-2 border-dashed border-red-700 align-middle" /> Reorder point
      </li>
      <li>
        <span className={`${swatch} bg-slate-600`} /> Used
      </li>
      <li>
        <span className={`${swatch} bg-red-600`} /> Wasted
      </li>
      <li>
        <span className={`${swatch} bg-sky-600`} /> Delivered
      </li>
    </ul>
  );
}

export function StockHistoryPanel({ locationId, itemId }: { locationId: string; itemId: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const history = useQuery({
    queryKey: ['item-history', locationId, itemId, days],
    queryFn: () =>
      callRpc<StockHistory>('get_item_stock_history', { p_location_id: locationId, p_item_id: itemId, p_days: days }),
  });
  const d = history.data;
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-slate-300 bg-slate-50 p-3"
      data-testid={`history-${itemId}`}
    >
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Chart range">
        {RANGES.map((r) => (
          <Button
            key={r}
            variant={r === days ? 'primary' : 'secondary'}
            aria-pressed={r === days}
            onClick={() => setDays(r)}
          >
            {r} days
          </Button>
        ))}
      </div>
      {history.isPending ? (
        <Loading label="Loading history…" />
      ) : history.error ? (
        <QueryError error={history.error} onRetry={() => void history.refetch()} />
      ) : d ? (
        <>
          <p className="text-xs text-slate-600" data-testid="history-scope">
            {d.data_label} · {d.date_from} to {d.date_to} · {d.timezone} · refreshed {formatDateTime(d.refreshed_at)}
          </p>
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="inline font-semibold">Reorder point: </dt>
              <dd className="inline" data-testid="history-rop">
                {d.reorder_applicable && d.reorder_point != null ? (
                  `${q(d.reorder_point)} ${d.base_unit}`
                ) : (
                  <>
                    Not set —{' '}
                    <Link to="/planning/settings" className="underline">
                      set it under Planning
                    </Link>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Available now: </dt>
              <dd className="inline">
                {q(d.available_now)} {d.base_unit}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Suggested order quantity: </dt>
              <dd className="inline" data-testid="history-suggested">
                {d.suggested_order?.quantity != null ? (
                  <>
                    {q(d.suggested_order.quantity)} {d.base_unit}
                    {d.suggested_order.packs ? ` (${q(d.suggested_order.packs)} packs)` : ''}
                  </>
                ) : d.suggested_order_missing_reason === 'insufficient_history' ? (
                  'Not enough history yet — a manager demand input is needed under Planning'
                ) : (
                  'Not available — planning inputs are not set'
                )}
              </dd>
            </div>
            <div>
              <dt className="inline font-semibold">Next expected delivery: </dt>
              <dd className="inline" data-testid="history-next-delivery">
                {d.next_delivery ? (
                  <>
                    {d.next_delivery.po_number} · {d.next_delivery.expected_date ?? 'no date'} ·{' '}
                    {q(d.next_delivery.quantity)} {d.base_unit}{' '}
                    {d.next_delivery.late ? <Badge tone="bad">late</Badge> : null}
                  </>
                ) : (
                  'None on order'
                )}
              </dd>
            </div>
          </dl>
          <Legend />
          <Chart data={d} />
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Show as table</summary>
            <ScrollRegion label={`Daily stock history for ${d.name}`}>
              <table className="w-full border-collapse bg-white text-xs">
                <thead>
                  <tr className="border-b border-slate-400 text-left">
                    <th className="p-1">Date</th>
                    <th className="p-1">On hand</th>
                    <th className="p-1">Used</th>
                    <th className="p-1">Wasted</th>
                    <th className="p-1">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {d.series.map((row) => (
                    <tr key={row.date} className="border-b border-slate-200">
                      <td className="p-1">{row.date}</td>
                      <td className="p-1">{q(row.on_hand)}</td>
                      <td className="p-1">{q(row.used)}</td>
                      <td className="p-1">{q(row.wasted)}</td>
                      <td className="p-1">{q(row.received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </details>
        </>
      ) : null}
    </div>
  );
}
