import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { Loading, Notice, QueryError } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';

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
