import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { Button } from './ui';

export function DataModeBanner({ mode }: { mode: 'pilot' | 'demo' | undefined }) {
  if (!mode) return null;
  const demo = mode === 'demo';
  return (
    <div
      data-testid="data-mode-banner"
      className={`px-4 py-1 text-center text-sm font-bold tracking-wide ${demo ? 'bg-amber-300 text-amber-950' : 'bg-slate-900 text-white'}`}
    >
      {demo ? 'DEMO — synthetic data' : 'PILOT — real data'}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="alert" className="bg-red-700 px-4 py-2 text-center text-sm font-semibold text-white">
      No connection — nothing was saved. Posting is disabled until the connection returns.
    </div>
  );
}

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/settings', label: 'Settings & setup', end: false },
];

export function AppShell() {
  const { context, selectedLocation, selectLocation, signOut } = useAuth();
  const roles = context?.roles ?? [];
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <DataModeBanner mode={context?.data_mode} />
      <OfflineBanner />
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <p className="mr-auto text-lg font-bold">{context?.company_name ?? 'Meats Around the World'}</p>
          {roles.length > 0 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="location-select" className="text-sm font-semibold">
                Location
              </label>
              <select
                id="location-select"
                className="min-h-11 rounded-md border border-slate-500 bg-white px-3 text-base focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500"
                value={selectedLocation?.location_id ?? ''}
                onChange={(e) => selectLocation(e.target.value)}
              >
                {roles.map((r) => (
                  <option key={r.location_id} value={r.location_id}>
                    {r.location_name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="text-sm" data-testid="signed-in-as">
            <span className="font-semibold">{context?.employee?.display_name ?? 'Signed in'}</span>
            {selectedLocation ? (
              <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase">
                {selectedLocation.role}
              </span>
            ) : null}
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-6xl gap-1 px-4">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center border-b-4 px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500 ${isActive ? 'border-emerald-800 text-emerald-900' : 'border-transparent text-slate-700 hover:text-slate-950'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
