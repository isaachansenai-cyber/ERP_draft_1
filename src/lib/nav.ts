// Navigation is a convenience only; every screen and RPC is authorized server-side.
// Employees see only the screens their job needs (ADR 0033).
interface NavItem {
  to: string;
  label: string;
  end: boolean;
  managersOnly?: boolean;
  /** What an employee sees instead (same screen, narrower scope). */
  employee?: { to: string; label: string };
}

const NAV: NavItem[] = [
  { to: '/', label: 'Overview', end: true },
  { to: '/dashboard', label: 'Dashboard', end: false, managersOnly: true },
  { to: '/pos', label: 'POS', end: false },
  { to: '/kitchen', label: 'Kitchen', end: false },
  { to: '/inventory', label: 'Inventory', end: false, employee: { to: '/inventory/waste', label: 'Waste reports' } },
  { to: '/returns', label: 'Refunds & returns', end: false },
  { to: '/customer-invoices', label: 'Customer invoices', end: false, managersOnly: true },
  { to: '/catalog', label: 'Recipes', end: false, managersOnly: true },
  { to: '/purchasing', label: 'Purchasing', end: false, managersOnly: true },
  { to: '/invoices', label: 'Supplier invoices', end: false, managersOnly: true },
  { to: '/planning', label: 'Planning', end: false, managersOnly: true },
  { to: '/serve', label: 'What can we serve', end: false },
  { to: '/staff', label: 'Staff time', end: false },
  { to: '/labels', label: 'Labels', end: false, managersOnly: true },
  { to: '/settings', label: 'Settings & setup', end: false, managersOnly: true },
];

export function navFor(role: string | undefined): Array<{ to: string; label: string; end: boolean }> {
  const employee = role === 'employee';
  return NAV.filter((n) => !employee || !n.managersOnly).map((n) =>
    employee && n.employee ? { to: n.employee.to, label: n.employee.label, end: n.end } : n,
  );
}
