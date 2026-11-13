import { NavLink, Navigate, useParams } from 'react-router-dom';
import { AccountPanel } from './settings/AccountPanel';
import { PilotSetupPanel } from './settings/PilotSetupPanel';
import { StaffAccessPanel } from './settings/StaffAccessPanel';
import { TaxesPricesPanel } from './settings/TaxesPricesPanel';

const TABS = [
  { id: 'setup', label: 'Pilot setup', element: <PilotSetupPanel /> },
  { id: 'taxes-prices', label: 'Taxes & prices', element: <TaxesPricesPanel /> },
  { id: 'staff', label: 'Staff access', element: <StaffAccessPanel /> },
  { id: 'account', label: 'My manager PIN', element: <AccountPanel /> },
] as const;

export function SettingsPage() {
  const { tab } = useParams();
  const current = TABS.find((t) => t.id === tab);
  if (!current) return <Navigate to="/settings/setup" replace />;
  return (
    <section aria-labelledby="settings-heading" className="flex flex-col gap-4">
      <h1 id="settings-heading" className="text-2xl font-bold">
        Settings &amp; setup
      </h1>
      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/settings/${t.id}`}
            className={({ isActive }) =>
              `inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-500 ${isActive ? 'border-emerald-800 bg-emerald-800 text-white' : 'border-slate-400 bg-white text-slate-900'}`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div>{current.element}</div>
    </section>
  );
}
