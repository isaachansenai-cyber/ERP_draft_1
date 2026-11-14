// Inventory controls (PRD §6): physical counts, waste reports, quarantine and
// inter-location transfers. Every write is one RPC; the server re-checks roles,
// versions, stock and reasons.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ReasonSelect } from '../../components/ReasonSelect';
import {
  Badge,
  Button,
  Empty,
  Field,
  inputClass,
  Loading,
  MutationStatus,
  Notice,
  QueryError,
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import type { MutationState } from '../../lib/useRpcMutation';
import { callRpc } from '../../lib/rpc';
import { useLocations } from '../../lib/referenceData';
import { supabase } from '../../lib/supabase';
import { useRpcMutation } from '../../lib/useRpcMutation';
import { qty } from '../InventoryPage';

export interface StockItemLite {
  item_id: string;
  name: string;
  base_unit: string;
  item_type: string;
}

interface StatusSource {
  state: MutationState<unknown>;
  retry: () => Promise<void>;
  checkAgain: () => Promise<void>;
}

export function Status({ m, text }: { m: StatusSource; text: string }) {
  return (
    <MutationStatus
      state={m.state}
      successText={text}
      onRetry={() => void m.retry()}
      onCheckAgain={() => void m.checkAgain()}
    />
  );
}

// ---------------------------------------------------------------- quarantine
export function QuarantineAction({
  lotId,
  lotCode,
  condition,
  free,
  onDone,
}: {
  lotId: string;
  lotCode: string;
  condition: string;
  free: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const toQuarantine = condition === 'sellable';
  const m = useRpcMutation('change_stock_condition', `condition:${lotId}:${condition}`, {
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  if (!open)
    return (
      <Button variant="secondary" className="ml-2 min-h-11 px-2 py-1 text-xs" onClick={() => setOpen(true)}>
        {toQuarantine ? 'Quarantine…' : 'Release…'}
      </Button>
    );
  return (
    <form
      className="mt-1 flex flex-wrap items-end gap-2 rounded-md border border-amber-600 bg-amber-50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_lot_id: lotId,
          p_quantity: Number(quantity),
          p_to_condition: toQuarantine ? 'quarantined' : 'sellable',
          p_reason_code: toQuarantine ? reason : undefined,
          p_note: note || undefined,
        });
      }}
    >
      <p className="w-full text-xs">
        {toQuarantine
          ? `Quarantine part of lot ${lotCode}: it stays on hand and valued but is never available. Unreserved: ${qty(free)}.`
          : `Release quarantined stock of lot ${lotCode} back to sellable (only if not expired).`}
      </p>
      <Field label="Quantity" htmlFor={`cq-${lotId}-${condition}`}>
        <input
          id={`cq-${lotId}-${condition}`}
          inputMode="decimal"
          className={`${inputClass} w-28`}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      {toQuarantine ? (
        <ReasonSelect use="waste" id={`cr-${lotId}`} value={reason} onChange={(c) => setReason(c)} />
      ) : null}
      <Field label="Note" htmlFor={`cn-${lotId}-${condition}`}>
        <input
          id={`cn-${lotId}-${condition}`}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost || !(Number(quantity) > 0) || (toQuarantine && !reason)}>
        {toQuarantine ? 'Quarantine' : 'Release'}
      </Button>
      <Button variant="secondary" onClick={() => setOpen(false)}>
        Close
      </Button>
      <div className="w-full">
        <Status m={m} text={toQuarantine ? 'Stock quarantined.' : 'Stock released.'} />
      </div>
    </form>
  );
}

// -------------------------------------------------------------------- counts
interface CountLine {
  lot_id: string;
  condition: string;
  item_id: string;
  expected_qty: number | string;
  counted_qty: number | string | null;
  variance: number | string | null;
  items: { name: string; base_unit: string } | null;
  lots: { lot_code: string; use_by_date: string | null } | null;
}
interface StockCount {
  count_id: string;
  count_number: string;
  status: string;
  version: number;
  item_ids: string[];
  reason_code: string | null;
  note: string | null;
  created_at: string;
  posted_at: string | null;
  stock_count_lines: CountLine[];
}

function DraftCount({ count, onDone }: { count: StockCount; onDone: (message: string) => void }) {
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('COUNT_VARIANCE');
  const [note, setNote] = useState('');
  const post = useRpcMutation<{ adjusted_lines: number }>(
    'post_stock_count',
    `count-post:${count.count_id}:${count.version}`,
    {
      onSuccess: (r) =>
        onDone(`Count ${count.count_number} posted: ${r.adjusted_lines} line(s) adjusted with the reason given.`),
    },
  );
  const cancel = useRpcMutation('cancel_stock_count', `count-cancel:${count.count_id}:${count.version}`, {
    onSuccess: () => onDone(`Count ${count.count_number} cancelled.`),
  });
  const lineKey = (l: CountLine) => `${l.lot_id}:${l.condition}`;
  const entries = count.stock_count_lines
    .filter((l) => (counted[lineKey(l)] ?? '').trim() !== '')
    .map((l) => ({ lot_id: l.lot_id, condition: l.condition, counted_qty: Number(counted[lineKey(l)]) }));
  const valid = entries.every((e) => Number.isFinite(e.counted_qty) && e.counted_qty >= 0);
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void post.submit({
          p_count_id: count.count_id,
          p_expected_version: count.version,
          p_counts: entries,
          p_reason_code: reason,
          p_note: note || undefined,
        });
      }}
    >
      <h3 className="font-semibold">
        Count {count.count_number} — started {formatDateTime(count.created_at)}
      </h3>
      <p className="text-xs text-slate-700">
        Enter what you physically count per lot. Lines left blank are recorded as matching the snapshot. If any counted
        item moves (sale, receipt, waste) before you post, the count is rejected and must be restarted.
      </p>
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-400 text-left">
              <th className="p-1">Item</th>
              <th className="p-1">Lot</th>
              <th className="p-1">Condition</th>
              <th className="p-1">Snapshot</th>
              <th className="p-1">Counted</th>
            </tr>
          </thead>
          <tbody>
            {count.stock_count_lines.map((l) => (
              <tr key={lineKey(l)} className="border-b border-slate-200">
                <td className="p-1">
                  <span className="font-mono">{l.item_id}</span> {l.items?.name}
                </td>
                <td className="p-1">
                  {l.lots?.lot_code}
                  {l.lots?.use_by_date ? <span className="block text-xs">use-by {l.lots.use_by_date}</span> : null}
                </td>
                <td className="p-1">{l.condition}</td>
                <td className="p-1">
                  {qty(l.expected_qty)} {l.items?.base_unit}
                </td>
                <td className="p-1">
                  <input
                    aria-label={`Counted ${l.item_id} lot ${l.lots?.lot_code ?? ''} ${l.condition}`}
                    inputMode="decimal"
                    className={`${inputClass} w-28`}
                    value={counted[lineKey(l)] ?? ''}
                    onChange={(e) => setCounted((c) => ({ ...c, [lineKey(l)]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <ReasonSelect use="count" id={`count-reason-${count.count_id}`} value={reason} onChange={(c) => setReason(c)} />
        <Field label="Note" htmlFor={`count-note-${count.count_id}`}>
          <input
            id={`count-note-${count.count_id}`}
            className={inputClass}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <Button type="submit" disabled={!post.canPost || !valid || !reason}>
          Post count ({entries.length} entered)
        </Button>
        <Button
          variant="secondary"
          disabled={!cancel.canPost}
          onClick={() => void cancel.submit({ p_count_id: count.count_id, p_expected_version: count.version })}
        >
          Cancel count
        </Button>
      </div>
      <Status m={post} text="Count posted. Differences were adjusted with the reason given." />
      <Status m={cancel} text="Count cancelled." />
    </form>
  );
}

export function CountsPanel({ locationId, items }: { locationId: string; items: StockItemLite[] }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const counts = useQuery({
    queryKey: ['stock-counts', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_counts')
        .select(
          'count_id, count_number, status, version, item_ids, reason_code, note, created_at, posted_at, stock_count_lines(lot_id, condition, item_id, expected_qty, counted_qty, variance, items(name, base_unit), lots(lot_code, use_by_date))',
        )
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as unknown as StockCount[];
    },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['stock-counts', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['stock', locationId] });
  };
  const [flash, setFlash] = useState<string | null>(null);
  const start = useRpcMutation('start_stock_count', `count-start:${locationId}:${filter}`, {
    onSuccess: () => {
      setFlash(null);
      refresh();
    },
  });
  const matching = items.filter(
    (i) => i.item_type !== 'finished_dish' && `${i.item_id} ${i.name}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const drafts = (counts.data ?? []).filter((c) => c.status === 'draft');
  const history = (counts.data ?? []).filter((c) => c.status !== 'draft');
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-slate-400 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start.submit({
            p_location_id: locationId,
            p_item_ids: filter.trim() ? matching.map((i) => i.item_id) : undefined,
          });
        }}
      >
        <Field
          label="Items to count"
          htmlFor="count-filter"
          hint={filter.trim() ? `${matching.length} item(s) match` : 'Leave blank to count every stocked item'}
        >
          <input id="count-filter" className={inputClass} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!start.canPost || (filter.trim() !== '' && matching.length === 0)}>
          Start count (snapshot now)
        </Button>
        <div className="w-full">
          <Status m={start} text="Count started. Enter the physical quantities below." />
        </div>
      </form>
      {counts.isPending ? (
        <Loading />
      ) : counts.error ? (
        <QueryError error={counts.error} onRetry={() => void counts.refetch()} />
      ) : (
        <>
          {drafts.length === 0 ? <Empty>No count in progress.</Empty> : null}
          {drafts.map((c) => (
            <DraftCount
              key={`${c.count_id}:${c.version}`}
              count={c}
              onDone={(message) => {
                setFlash(message);
                refresh();
              }}
            />
          ))}
          {flash ? <Notice tone="success">{flash}</Notice> : null}
          {history.length > 0 ? (
            <section className="flex flex-col gap-1">
              <h3 className="font-semibold">Recent counts</h3>
              <ul className="text-sm">
                {history.map((c) => {
                  const adjusted = c.stock_count_lines.filter((l) => Number(l.variance ?? 0) !== 0);
                  return (
                    <li key={c.count_id} className="border-b border-slate-200 py-1">
                      {c.count_number} · <Badge tone={c.status === 'posted' ? 'good' : 'neutral'}>{c.status}</Badge>{' '}
                      {c.posted_at ? formatDateTime(c.posted_at) : formatDateTime(c.created_at)} · {adjusted.length}{' '}
                      adjusted line(s){c.reason_code ? ` · ${c.reason_code}` : ''}
                      {adjusted.length ? (
                        <span className="block text-xs">
                          {adjusted
                            .map((l) => `${l.item_id} ${Number(l.variance) > 0 ? '+' : ''}${qty(l.variance)}`)
                            .join(', ')}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- waste
interface WasteReport {
  waste_report_id: string;
  report_number: string;
  status: string;
  version: number;
  reason_code: string;
  note: string | null;
  submitted_by: string;
  submitted_at: string;
  decision_note: string | null;
  total_cost: string | null;
  lines: Array<{ line_no: number; item_id: string; name: string; base_unit: string; quantity: string }>;
}

function WasteDecision({ report, onDone }: { report: WasteReport; onDone: () => void }) {
  const [note, setNote] = useState('');
  const m = useRpcMutation('decide_waste_report', `waste-decide:${report.waste_report_id}:${report.version}`, {
    onSuccess: onDone,
  });
  if (report.status !== 'submitted') return <Status m={m} text="Decision recorded." />;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Decision note" htmlFor={`wn-${report.waste_report_id}`} hint="Required to reject">
        <input
          id={`wn-${report.waste_report_id}`}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Button
        disabled={!m.canPost}
        onClick={() =>
          void m.submit({
            p_waste_report_id: report.waste_report_id,
            p_expected_version: report.version,
            p_decision: 'post',
            p_note: note || undefined,
          })
        }
      >
        Post waste (removes stock)
      </Button>
      <Button
        variant="secondary"
        disabled={!m.canPost || note.trim().length < 3}
        onClick={() =>
          void m.submit({
            p_waste_report_id: report.waste_report_id,
            p_expected_version: report.version,
            p_decision: 'reject',
            p_note: note,
          })
        }
      >
        Reject
      </Button>
      <div className="w-full">
        <Status m={m} text="Decision recorded." />
      </div>
    </div>
  );
}

export function WastePanel({
  locationId,
  items,
  isManager,
}: {
  locationId: string;
  items: StockItemLite[];
  isManager: boolean;
}) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<Array<{ item_id: string; quantity: string }>>([{ item_id: '', quantity: '' }]);
  const [reason, setReason] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [note, setNote] = useState('');
  const reports = useQuery({
    queryKey: ['waste-reports', locationId],
    queryFn: () => callRpc<WasteReport[]>('list_waste_reports', { p_location_id: locationId }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['waste-reports', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['stock', locationId] });
  };
  const submit = useRpcMutation('submit_waste_report', `waste-submit:${locationId}`, {
    onSuccess: () => {
      setLines([{ item_id: '', quantity: '' }]);
      setNote('');
      refresh();
    },
  });
  const entered = lines.filter((l) => l.item_id && l.quantity.trim() !== '');
  const valid =
    entered.length > 0 &&
    entered.every((l) => Number(l.quantity) > 0) &&
    reason &&
    (!needsNote || note.trim().length >= 3);
  const stockable = items.filter((i) => i.item_type !== 'finished_dish');
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit.submit({
            p_location_id: locationId,
            p_lines: entered.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) })),
            p_reason_code: reason,
            p_note: note || undefined,
          });
        }}
      >
        <h3 className="font-semibold">Report waste</h3>
        <p className="text-xs text-slate-700">
          A report does not change stock. A manager reviews it and posts it, which removes unreserved stock (quarantined
          first, then expired, then earliest use-by).
        </p>
        {lines.map((l, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2">
            <Field label={`Item ${idx + 1}`} htmlFor={`waste-item-${idx}`}>
              <select
                id={`waste-item-${idx}`}
                className={inputClass}
                value={l.item_id}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, item_id: e.target.value } : x)))
                }
              >
                <option value="">Choose…</option>
                {stockable.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.item_id} {i.name} ({i.base_unit})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity (base unit)" htmlFor={`waste-qty-${idx}`}>
              <input
                id={`waste-qty-${idx}`}
                inputMode="decimal"
                className={`${inputClass} w-28`}
                value={l.quantity}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                }
              />
            </Field>
          </div>
        ))}
        <div>
          <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { item_id: '', quantity: '' }])}>
            Add line
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <ReasonSelect
            use="waste"
            id="waste-reason"
            value={reason}
            onChange={(c, n) => {
              setReason(c);
              setNeedsNote(n);
            }}
          />
          <Field label={needsNote ? 'Note (required)' : 'Note'} htmlFor="waste-note">
            <input id="waste-note" className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!submit.canPost || !valid}>
            Submit waste report
          </Button>
        </div>
        <Status m={submit} text="Waste report submitted for manager review." />
      </form>

      {reports.isPending ? (
        <Loading />
      ) : reports.error ? (
        <QueryError error={reports.error} onRetry={() => void reports.refetch()} />
      ) : reports.data.length === 0 ? (
        <Empty>No waste reports in the last 60 days.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.data.map((r) => (
            <li key={r.waste_report_id} className="rounded-md border border-slate-300 bg-white p-2 text-sm">
              <p>
                <span className="font-semibold">{r.report_number}</span>{' '}
                <Badge tone={r.status === 'posted' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}>
                  {r.status}
                </Badge>{' '}
                · {r.reason_code} · by {r.submitted_by} · {formatDateTime(r.submitted_at)}
                {isManager && r.total_cost ? ` · cost $${r.total_cost}` : ''}
              </p>
              <p className="text-xs">
                {r.lines.map((l) => `${l.item_id} ${l.name}: ${qty(l.quantity)} ${l.base_unit}`).join('; ')}
                {r.note ? ` — “${r.note}”` : ''}
                {r.decision_note ? ` — decision: ${r.decision_note}` : ''}
              </p>
              {isManager ? <WasteDecision report={r} onDone={refresh} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- transfers
interface TransferLine {
  transfer_line_id: string;
  item_id: string;
  dispatched_qty: number | string;
  received_qty: number | string;
  lost_qty: number | string;
  in_transit_qty: number | string;
  use_by_date: string | null;
  items: { name: string; base_unit: string } | null;
}
interface Transfer {
  transfer_id: string;
  transfer_number: string;
  from_location_id: string;
  to_location_id: string;
  status: string;
  version: number;
  note: string | null;
  created_at: string;
  dispatched_at: string | null;
  transfer_requests: Array<{ item_id: string; quantity: number | string }>;
  transfer_lines: TransferLine[];
}

function ReceiveTransfer({ t, onDone }: { t: Transfer; onDone: () => void }) {
  const [rows, setRows] = useState<Record<string, { received: string; lost: string; reason: string; note: string }>>(
    {},
  );
  const m = useRpcMutation('receive_transfer', `transfer-receive:${t.transfer_id}:${t.version}`, { onSuccess: onDone });
  const open = t.transfer_lines.filter((l) => Number(l.in_transit_qty) > 0);
  if (open.length === 0) return <Status m={m} text="Transfer receipt recorded." />;
  const set = (id: string, patch: Partial<{ received: string; lost: string; reason: string; note: string }>) =>
    setRows((r) => ({ ...r, [id]: { received: '', lost: '', reason: '', note: '', ...r[id], ...patch } }));
  const entries = open
    .map((l) => ({ l, r: rows[l.transfer_line_id] }))
    .filter(({ r }) => r && (Number(r.received) > 0 || Number(r.lost) > 0));
  const valid = entries.length > 0 && entries.every(({ r }) => !(Number(r!.lost) > 0) || r!.reason);
  return (
    <form
      className="mt-2 flex flex-col gap-2 rounded-md border border-emerald-700 bg-emerald-50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({
          p_transfer_id: t.transfer_id,
          p_expected_version: t.version,
          p_lines: entries.map(({ l, r }) => ({
            transfer_line_id: l.transfer_line_id,
            received_qty: Number(r!.received || 0),
            lost_qty: Number(r!.lost || 0),
            loss_reason_code: Number(r!.lost) > 0 ? r!.reason : undefined,
            note: r!.note || undefined,
          })),
        });
      }}
    >
      <p className="text-xs">
        Record what actually arrived. Anything still unaccounted for stays in transit. Losses need a reason. Expired
        stock arrives quarantined.
      </p>
      {open.map((l) => (
        <div key={l.transfer_line_id} className="flex flex-wrap items-end gap-2 border-b border-emerald-200 pb-2">
          <p className="w-full text-sm">
            {l.item_id} {l.items?.name}: {qty(l.in_transit_qty)} {l.items?.base_unit} in transit
          </p>
          <Field label="Received" htmlFor={`tr-r-${l.transfer_line_id}`}>
            <input
              id={`tr-r-${l.transfer_line_id}`}
              inputMode="decimal"
              className={`${inputClass} w-24`}
              value={rows[l.transfer_line_id]?.received ?? ''}
              onChange={(e) => set(l.transfer_line_id, { received: e.target.value })}
            />
          </Field>
          <Field label="Lost" htmlFor={`tr-l-${l.transfer_line_id}`}>
            <input
              id={`tr-l-${l.transfer_line_id}`}
              inputMode="decimal"
              className={`${inputClass} w-24`}
              value={rows[l.transfer_line_id]?.lost ?? ''}
              onChange={(e) => set(l.transfer_line_id, { lost: e.target.value })}
            />
          </Field>
          {Number(rows[l.transfer_line_id]?.lost) > 0 ? (
            <ReasonSelect
              use="transfer"
              id={`tr-reason-${l.transfer_line_id}`}
              label="Loss reason"
              value={rows[l.transfer_line_id]?.reason ?? ''}
              onChange={(c) => set(l.transfer_line_id, { reason: c })}
            />
          ) : null}
          <Field label="Note" htmlFor={`tr-n-${l.transfer_line_id}`}>
            <input
              id={`tr-n-${l.transfer_line_id}`}
              className={inputClass}
              value={rows[l.transfer_line_id]?.note ?? ''}
              onChange={(e) => set(l.transfer_line_id, { note: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <Button type="submit" disabled={!m.canPost || !valid}>
        Record receipt
      </Button>
      <Status m={m} text="Transfer receipt recorded." />
    </form>
  );
}

function TransferCard({ t, locationId, onDone }: { t: Transfer; locationId: string; onDone: () => void }) {
  const dispatch = useRpcMutation('dispatch_transfer', `transfer-dispatch:${t.transfer_id}:${t.version}`, {
    onSuccess: onDone,
  });
  const cancel = useRpcMutation('cancel_transfer', `transfer-cancel:${t.transfer_id}:${t.version}`, {
    onSuccess: onDone,
  });
  const outgoing = t.from_location_id === locationId;
  return (
    <li
      className="rounded-md border border-slate-300 bg-white p-2 text-sm"
      data-testid={`transfer-${t.transfer_number}`}
    >
      <p>
        <span className="font-semibold">{t.transfer_number}</span>{' '}
        {outgoing ? `→ ${t.to_location_id}` : `← ${t.from_location_id}`}{' '}
        <Badge tone={t.status === 'received' ? 'good' : t.status === 'cancelled' ? 'neutral' : 'warn'}>
          {t.status.replace('_', ' ')}
        </Badge>{' '}
        · created {formatDateTime(t.created_at)}
      </p>
      {t.transfer_lines.length === 0 ? (
        <p className="text-xs">
          Requested: {t.transfer_requests.map((r) => `${r.item_id} ${qty(r.quantity)}`).join(', ')}
        </p>
      ) : (
        <ul className="text-xs">
          {t.transfer_lines.map((l) => (
            <li key={l.transfer_line_id}>
              {l.item_id} {l.items?.name}: dispatched {qty(l.dispatched_qty)}, received {qty(l.received_qty)}, lost{' '}
              {qty(l.lost_qty)}, in transit {qty(l.in_transit_qty)} {l.items?.base_unit}
              {l.use_by_date ? ` · use-by ${l.use_by_date}` : ''}
            </li>
          ))}
        </ul>
      )}
      {outgoing && t.status === 'draft' ? (
        <div className="mt-2 flex gap-2">
          <Button
            disabled={!dispatch.canPost}
            onClick={() => void dispatch.submit({ p_transfer_id: t.transfer_id, p_expected_version: t.version })}
          >
            Dispatch (stock leaves now)
          </Button>
          <Button
            variant="secondary"
            disabled={!cancel.canPost}
            onClick={() => void cancel.submit({ p_transfer_id: t.transfer_id, p_expected_version: t.version })}
          >
            Cancel draft
          </Button>
        </div>
      ) : null}
      {!outgoing && t.status !== 'draft' && t.status !== 'cancelled' ? <ReceiveTransfer t={t} onDone={onDone} /> : null}
      <Status m={dispatch} text="Dispatched: stock is now in transit." />
      <Status m={cancel} text="Draft cancelled." />
    </li>
  );
}

export function TransfersPanel({ locationId, items }: { locationId: string; items: StockItemLite[] }) {
  const queryClient = useQueryClient();
  const locations = useLocations();
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<Array<{ item_id: string; quantity: string }>>([{ item_id: '', quantity: '' }]);
  const transfers = useQuery({
    queryKey: ['transfers', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transfers')
        .select(
          'transfer_id, transfer_number, from_location_id, to_location_id, status, version, note, created_at, dispatched_at, transfer_requests(item_id, quantity), transfer_lines(transfer_line_id, item_id, dispatched_qty, received_qty, lost_qty, in_transit_qty, use_by_date, items(name, base_unit))',
        )
        .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as unknown as Transfer[];
    },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['transfers', locationId] });
    void queryClient.invalidateQueries({ queryKey: ['stock', locationId] });
  };
  const create = useRpcMutation('create_transfer', `transfer-create:${locationId}`, {
    onSuccess: () => {
      setLines([{ item_id: '', quantity: '' }]);
      refresh();
    },
  });
  const entered = lines.filter((l) => l.item_id && Number(l.quantity) > 0);
  const stockable = items.filter((i) => i.item_type !== 'finished_dish');
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void create.submit({
            p_from_location_id: locationId,
            p_to_location_id: to,
            p_lines: entered.map((l) => ({ item_id: l.item_id, quantity: Number(l.quantity) })),
          });
        }}
      >
        <h3 className="font-semibold">New transfer from this location</h3>
        <Field label="Destination" htmlFor="transfer-to">
          <select id="transfer-to" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {(locations.data ?? [])
              .filter((l) => l.location_id !== locationId)
              .map((l) => (
                <option key={l.location_id} value={l.location_id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        {lines.map((l, idx) => (
          <div key={idx} className="flex flex-wrap items-end gap-2">
            <Field label={`Item ${idx + 1}`} htmlFor={`transfer-item-${idx}`}>
              <select
                id={`transfer-item-${idx}`}
                className={inputClass}
                value={l.item_id}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, item_id: e.target.value } : x)))
                }
              >
                <option value="">Choose…</option>
                {stockable.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.item_id} {i.name} ({i.base_unit})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quantity (base unit)" htmlFor={`transfer-qty-${idx}`}>
              <input
                id={`transfer-qty-${idx}`}
                inputMode="decimal"
                className={`${inputClass} w-28`}
                value={l.quantity}
                onChange={(e) =>
                  setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))
                }
              />
            </Field>
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setLines((ls) => [...ls, { item_id: '', quantity: '' }])}>
            Add line
          </Button>
          <Button type="submit" disabled={!create.canPost || !to || entered.length === 0}>
            Create draft transfer
          </Button>
        </div>
        <Status m={create} text="Draft transfer created. Dispatch it when the goods leave." />
      </form>
      {transfers.isPending ? (
        <Loading />
      ) : transfers.error ? (
        <QueryError error={transfers.error} onRetry={() => void transfers.refetch()} />
      ) : transfers.data.length === 0 ? (
        <Empty>No transfers to or from this location.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {transfers.data.map((t) => (
            <TransferCard key={t.transfer_id} t={t} locationId={locationId} onDone={refresh} />
          ))}
        </ul>
      )}
      <Notice tone="info" title="Reconciliation">
        Every line keeps dispatched = received + lost + in transit. In-transit stock belongs to neither location&apos;s
        available stock.
      </Notice>
    </div>
  );
}
