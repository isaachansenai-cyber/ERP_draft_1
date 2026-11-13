import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Field, inputClass, Loading, Notice, QueryError } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { supabase } from '../../lib/supabase';
import { useRpcMutation } from '../../lib/useRpcMutation';
import { Status } from '../inventory/ControlsPanels';

/** Owner-set retail return policy (backs the return_policy_configured gate). */
export function ReturnPolicyPanel() {
  const { context } = useAuth();
  const queryClient = useQueryClient();
  const policy = useQuery({
    queryKey: ['return-policy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('return_policy')
        .select('window_days, allow_customer_restock, provenance, configured_at')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [days, setDays] = useState('');
  const [restock, setRestock] = useState(false);
  const m = useRpcMutation('set_return_policy', 'return-policy', {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['return-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['setup-gates'] });
    },
  });
  const canEdit = Boolean(context?.is_owner);
  const n = Number(days);
  return (
    <section aria-labelledby="policy-heading" className="flex flex-col gap-3">
      <h2 id="policy-heading" className="text-lg font-semibold">
        Retail return policy
      </h2>
      <p className="text-sm text-slate-700">
        Meals are refunded, never returned. Retail units can be returned to the selling location within the window.
        Returned goods are held outside stock; with restocking disabled they can only be disposed. After saving, confirm
        the <span className="font-mono">return_policy_configured</span> gate under Pilot setup.
      </p>
      {policy.isPending ? (
        <Loading />
      ) : policy.error ? (
        <QueryError error={policy.error} onRetry={() => void policy.refetch()} />
      ) : policy.data ? (
        <Notice tone="info" title="Current policy">
          {policy.data.window_days}-day window · customer restock{' '}
          {policy.data.allow_customer_restock ? 'allowed (unopened, shelf-stable retail only)' : 'disabled'} · set{' '}
          {formatDateTime(policy.data.configured_at)}{' '}
          {policy.data.provenance.startsWith('synthetic') ? <Badge tone="warn">synthetic demo</Badge> : null}
        </Notice>
      ) : (
        <Notice tone="warning" title="No policy set">
          Retail returns are closed until the owner sets a policy and confirms the gate.
        </Notice>
      )}
      {canEdit ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded-md border border-slate-400 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void m.submit({ p_window_days: n, p_allow_customer_restock: restock });
          }}
        >
          <Field label="Return window (days)" htmlFor="policy-days" hint="0 to 90">
            <input
              id="policy-days"
              inputMode="numeric"
              className={`${inputClass} w-24`}
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={restock}
              onChange={(e) => setRestock(e.target.checked)}
            />
            Allow unopened, shelf-stable retail returns back into stock
          </label>
          <Button type="submit" disabled={!m.canPost || days === '' || n > 90}>
            Save policy
          </Button>
          <div className="w-full">
            <Status m={m} text="Return policy saved (audited)." />
          </div>
        </form>
      ) : (
        <p className="text-sm">Only the owner can change the return policy.</p>
      )}
    </section>
  );
}
