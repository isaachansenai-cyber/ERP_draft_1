import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { Badge, Loading, Notice, QueryError } from '../components/ui';
import { supabase } from '../lib/supabase';

export function OverviewPage() {
  const { context, selectedLocation } = useAuth();
  const gates = useQuery({
    queryKey: ['gate-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pilot_setup_gates').select('status');
      if (error) throw error;
      return { open: data.filter((g) => g.status === 'open').length, total: data.length };
    },
  });

  if (!context) return <Loading />;
  return (
    <section aria-labelledby="overview-heading" className="flex flex-col gap-6">
      <div>
        <h1 id="overview-heading" className="text-2xl font-bold">
          Overview
        </h1>
        <p className="text-sm text-slate-700">Business date {context.business_date} (America/Denver)</p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Signed in as</dt>
          <dd className="text-lg font-semibold">{context.employee?.display_name}</dd>
          <dd className="text-xs text-slate-600">{context.employee?.employee_id}</dd>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Location and role</dt>
          <dd className="text-lg font-semibold">{selectedLocation?.location_name ?? '—'}</dd>
          <dd className="text-xs uppercase text-slate-600">{selectedLocation?.role ?? 'no location access'}</dd>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-4">
          <dt className="text-sm text-slate-700">Operational posting</dt>
          <dd className="mt-1">
            {context.posting_enabled ? (
              <Badge tone="good">Enabled</Badge>
            ) : (
              <Badge tone="warn">Disabled until setup gates pass</Badge>
            )}
          </dd>
          <dd className="mt-2 text-xs text-slate-600">
            {gates.isPending
              ? 'Checking setup gates…'
              : gates.error
                ? null
                : `${gates.data?.open} of ${gates.data?.total} setup gates open`}
          </dd>
        </div>
      </dl>
      {gates.error ? <QueryError error={gates.error} onRetry={() => void gates.refetch()} /> : null}

      {context.roles.length === 0 ? (
        <Notice tone="warning" title="No location access">
          Your account is signed in but has no active role. Ask the owner to grant a location membership.
        </Notice>
      ) : null}

      <Notice tone="info" title="What is available in this build">
        <p>
          Milestones 1–2 are installed: sign-in and roles, pilot setup gates, staff access, purchasing with partial
          receipts, the stock ledger, the staff POS, the kitchen and pickup queue, recorded payments and the sales
          dashboard.
        </p>
        <p className="mt-1">
          Counts, waste, transfers, returns, refunds, supplier invoices, planning, schedules and labels arrive in later
          milestones and are not shown until they work end to end.
        </p>
      </Notice>
    </section>
  );
}
