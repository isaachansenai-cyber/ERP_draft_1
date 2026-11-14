import { lazy } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { Loading, Notice, QueryError } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';

// Screens load on demand (route-level code splitting); login and overview stay in the main bundle.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const ReturnsPage = lazy(() => import('./pages/ReturnsPage').then((m) => ({ default: m.ReturnsPage })));
const ServePage = lazy(() => import('./pages/ServePage').then((m) => ({ default: m.ServePage })));
const KitchenPage = lazy(() => import('./pages/KitchenPage').then((m) => ({ default: m.KitchenPage })));
const LabelsPage = lazy(() => import('./pages/LabelsPage').then((m) => ({ default: m.LabelsPage })));
const PlanningPage = lazy(() => import('./pages/PlanningPage').then((m) => ({ default: m.PlanningPage })));
const PosPage = lazy(() => import('./pages/PosPage').then((m) => ({ default: m.PosPage })));
const PurchasingPage = lazy(() => import('./pages/PurchasingPage').then((m) => ({ default: m.PurchasingPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })));

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, context, contextLoading, contextError, refreshContext, signOut } = useAuth();
  const location = useLocation();
  if (session === undefined || contextLoading) return <Loading label="Checking your session…" />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (contextError)
    return (
      <div className="p-6">
        <QueryError error={contextError} onRetry={() => void refreshContext()} />
      </div>
    );
  if (!context?.employee) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Notice tone="warning" title="No active staff record">
          <p>This sign-in account is not linked to an active staff record. Ask the owner to link it.</p>
          <button type="button" className="mt-2 min-h-11 underline" onClick={() => void signOut()}>
            Sign out
          </button>
        </Notice>
      </div>
    );
  }
  return children;
}

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="kitchen" element={<KitchenPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="inventory/:tab" element={<InventoryPage />} />
          <Route path="returns" element={<ReturnsPage />} />
          <Route path="returns/:tab" element={<ReturnsPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="planning" element={<PlanningPage />} />
          <Route path="planning/:tab" element={<PlanningPage />} />
          <Route path="serve" element={<ServePage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="staff/:tab" element={<StaffPage />} />
          <Route path="labels" element={<LabelsPage />} />
          <Route path="purchasing" element={<PurchasingPage />} />
          <Route path="purchasing/:tab" element={<PurchasingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/:tab" element={<SettingsPage />} />
          <Route
            path="*"
            element={
              <Notice tone="warning" title="Not found">
                That screen does not exist in this build.
              </Notice>
            }
          />
        </Route>
      </Routes>
    </HashRouter>
  );
}
