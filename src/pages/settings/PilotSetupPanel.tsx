import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
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
import { supabase } from '../../lib/supabase';
import { useRpcMutation } from '../../lib/useRpcMutation';

interface Gate {
  gate_id: string;
  gate_key: string;
  scope_type: 'company' | 'location' | 'supplier' | 'supplier_item' | 'item';
  scope_id: string | null;
  status: 'open' | 'confirmed';
  confirmed_by: string | null;
  confirmed_at: string | null;
  evidence_note: string | null;
  provenance: string;
}

const GATE_TEXT: Record<string, { title: string; blocks: string }> = {
  roles_verified: {
    title: 'Roles verified',
    blocks: 'Final posting switch. Confirm after direct API permission tests on real accounts.',
  },
  perishables_confirmed: {
    title: 'Perishable list confirmed',
    blocks: 'Pilot receipts. Review which items require a use-by date.',
  },
  return_policy_configured: { title: 'Return policy configured', blocks: 'Retail returns (available in Milestone 3).' },
  backup_restore_tested: { title: 'Backup and restore tested', blocks: 'Final posting switch.' },
  acceptance_suite_passed: { title: 'Acceptance suite passed', blocks: 'Final posting switch.' },
  menu_prices_confirmed: { title: 'Menu prices confirmed', blocks: 'Orders that take money at this location.' },
  tax_rate_confirmed: { title: 'Tax rate confirmed', blocks: 'Orders that take money at this location.' },
  opening_counts_posted: {
    title: 'Opening counts posted',
    blocks: 'POS at this location (stock ledger arrives in Milestone 2).',
  },
  planning_inputs_confirmed: { title: 'Planning inputs confirmed', blocks: 'Saving ROP/EOQ settings (Milestone 4).' },
  supplier_master_verified: {
    title: 'Supplier details verified',
    blocks: 'Submitting purchase orders to this supplier.',
  },
  pack_conversions_verified: { title: 'Pack size and cost verified', blocks: 'Receiving in packs from this supplier.' },
  recipes_verified: { title: 'Recipe portions verified', blocks: 'Selling this dish.' },
};

const SECTIONS: Array<{ scope: Gate['scope_type']; title: string; collapsed: boolean }> = [
  { scope: 'company', title: 'Company', collapsed: false },
  { scope: 'location', title: 'Locations', collapsed: false },
  { scope: 'item', title: 'Recipes', collapsed: false },
  { scope: 'supplier', title: 'Suppliers', collapsed: true },
  { scope: 'supplier_item', title: 'Supplier packs', collapsed: true },
];

function useLabels() {
  return useQuery({
    queryKey: ['gate-labels'],
    queryFn: async () => {
      const [locations, items, suppliers, supplierItems] = await Promise.all([
        supabase.from('locations').select('location_id, name'),
        supabase.from('items').select('item_id, name'),
        supabase.from('suppliers').select('supplier_id, name'),
        supabase.from('supplier_items').select('supplier_item_id, supplier_id, item_id'),
      ]);
      for (const r of [locations, items, suppliers, supplierItems]) if (r.error) throw r.error;
      const map = new Map<string, string>();
      locations.data?.forEach((l) => map.set(l.location_id, l.name));
      items.data?.forEach((i) => map.set(i.item_id, `${i.item_id} ${i.name}`));
      suppliers.data?.forEach((s) => map.set(s.supplier_id, `${s.supplier_id} ${s.name}`));
      supplierItems.data?.forEach((si) => map.set(si.supplier_item_id, `${si.supplier_id} → ${si.item_id}`));
      return map;
    },
  });
}

function GateRow({ gate, label, isOwner }: { gate: Gate; label: string; isOwner: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<'confirm' | 'reopen'>('confirm');
  const [note, setNote] = useState('');
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['gates'] });
    void queryClient.invalidateQueries({ queryKey: ['gate-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['my-context'] });
  };
  const confirm = useRpcMutation('confirm_setup_gate', `confirm-gate:${gate.gate_id}`, { onSuccess: invalidate });
  const reopen = useRpcMutation('reopen_setup_gate', `reopen-gate:${gate.gate_id}`, { onSuccess: invalidate });
  // The action is fixed when the form opens, so the outcome message survives the refetch.
  const mutation = action === 'confirm' ? confirm : reopen;
  const text = GATE_TEXT[gate.gate_key] ?? { title: gate.gate_key, blocks: '' };
  const fieldId = `gate-note-${gate.gate_id}`;

  return (
    <li className="rounded-md border border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <p className="font-semibold">
            {text.title}
            {gate.scope_type !== 'company' ? <span className="font-normal text-slate-700"> — {label}</span> : null}
          </p>
          <p className="text-xs text-slate-600">Blocks: {text.blocks}</p>
          {gate.status === 'confirmed' ? (
            <p className="mt-1 text-xs text-slate-700">
              Confirmed {formatDateTime(gate.confirmed_at)} by {gate.confirmed_by ?? 'demo seed'}: “{gate.evidence_note}
              ”
            </p>
          ) : null}
        </div>
        {gate.status === 'confirmed' ? (
          <Badge tone={gate.provenance.startsWith('synthetic') ? 'warn' : 'good'}>
            {gate.provenance.startsWith('synthetic') ? 'Confirmed (synthetic demo)' : 'Confirmed'}
          </Badge>
        ) : (
          <Badge tone="bad">Open</Badge>
        )}
        {isOwner && !open ? (
          <Button
            variant="secondary"
            onClick={() => {
              const next = gate.status === 'open' ? 'confirm' : 'reopen';
              (next === 'confirm' ? confirm : reopen).reset();
              setAction(next);
              setNote('');
              setOpen(true);
            }}
          >
            {gate.status === 'open' ? 'Confirm…' : 'Reopen…'}
          </Button>
        ) : null}
      </div>
      {open ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (action === 'confirm') void confirm.submit({ p_gate_id: gate.gate_id, p_evidence_note: note });
            else void reopen.submit({ p_gate_id: gate.gate_id, p_reason: note });
          }}
        >
          <Field
            label={action === 'confirm' ? 'Evidence note (what you verified, where, when)' : 'Reason for reopening'}
            htmlFor={fieldId}
          >
            <textarea
              id={fieldId}
              className={inputClass}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={
                !mutation.canPost ||
                note.trim().length < (action === 'confirm' ? 10 : 3) ||
                ('kind' in mutation.state && mutation.state.kind === 'success')
              }
            >
              {action === 'confirm' ? 'Confirm gate' : 'Reopen gate'}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
          <MutationStatus
            state={mutation.state}
            successText={action === 'confirm' ? 'Gate confirmed.' : 'Gate reopened.'}
            onRetry={() => void mutation.retry()}
            onCheckAgain={() => void mutation.checkAgain()}
          />
        </form>
      ) : null}
    </li>
  );
}

function EnablePosting() {
  const { refreshContext } = useAuth();
  const [note, setNote] = useState('');
  const m = useRpcMutation('enable_posting', 'enable-posting', { onSuccess: () => void refreshContext() });
  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void m.submit({ p_evidence_note: note });
      }}
    >
      <Field
        label="Enable operational posting — evidence note"
        htmlFor="posting-note"
        hint="Requires roles, backup/restore and acceptance-suite gates."
      >
        <textarea
          id="posting-note"
          rows={2}
          className={inputClass}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!m.canPost || note.trim().length < 10}>
        Enable posting
      </Button>
      <MutationStatus
        state={m.state}
        successText="Posting enabled."
        onRetry={() => void m.retry()}
        onCheckAgain={() => void m.checkAgain()}
      />
    </form>
  );
}

export function PilotSetupPanel() {
  const { context } = useAuth();
  const gates = useQuery({
    queryKey: ['gates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pilot_setup_gates')
        .select(
          'gate_id, gate_key, scope_type, scope_id, status, confirmed_by, confirmed_at, evidence_note, provenance',
        )
        .order('gate_key')
        .order('scope_id');
      if (error) throw error;
      return data as Gate[];
    },
  });
  const labels = useLabels();
  const isOwner = Boolean(context?.is_owner);

  if (gates.isPending) return <Loading label="Loading setup gates…" />;
  if (gates.error) return <QueryError error={gates.error} onRetry={() => void gates.refetch()} />;
  if (gates.data.length === 0) return <Empty>No setup gates exist yet.</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <Notice tone="info" title="Pilot setup gates">
        Each gate keeps a workflow switched off until the owner enters and confirms real operating values. Gates are
        never confirmed automatically. {isOwner ? null : 'Only the owner can confirm or reopen gates.'}
      </Notice>
      {isOwner && !context?.posting_enabled ? <EnablePosting /> : null}
      {SECTIONS.map((section) => {
        const rows = gates.data.filter((g) => g.scope_type === section.scope);
        if (!rows.length) return null;
        const open = rows.filter((g) => g.status === 'open').length;
        return (
          <details
            key={section.scope}
            open={!section.collapsed}
            className="rounded-lg border border-slate-300 bg-slate-100 p-3"
          >
            <summary className="min-h-11 cursor-pointer py-2 text-lg font-semibold">
              {section.title}{' '}
              <span className="text-sm font-normal">
                ({open} open of {rows.length})
              </span>
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {rows.map((g) => (
                <GateRow
                  key={g.gate_id}
                  gate={g}
                  isOwner={isOwner}
                  label={labels.data?.get(g.scope_id ?? '') ?? g.scope_id ?? ''}
                />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
