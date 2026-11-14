import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { DataModeBanner, OfflineBanner } from '../components/AppShell';
import { Button, Field, inputClass, Notice } from '../components/ui';
import { callRpc } from '../lib/rpc';
import { configError, supabase } from '../lib/supabase';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mode = useQuery({
    queryKey: ['public-app-mode'],
    queryFn: () => callRpc<{ data_mode: 'pilot' | 'demo'; company_name: string }>('get_public_app_mode', {}),
    retry: 1,
  });

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        setError(
          signInError.status === 400
            ? 'Email or password is incorrect.'
            : 'Sign-in failed. Check the connection and try again.',
        );
      }
    } catch {
      setError('Sign-in failed. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <DataModeBanner mode={mode.data?.data_mode} />
      <OfflineBanner />
      <main className="mx-auto mt-16 max-w-md rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">{mode.data?.company_name ?? 'Meats Around the World'}</h1>
        <p className="mt-1 text-sm text-slate-700">
          Staff sign-in. Accounts are created by the owner; there is no self sign-up.
        </p>
        {configError ? (
          <div className="mt-4">
            <Notice tone="error" title="Not configured">
              {configError}
            </Notice>
          </div>
        ) : null}
        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? (
            <Notice tone="error" title="Not signed in">
              {error}
            </Notice>
          ) : null}
          <Button type="submit" disabled={busy || !email || !password || Boolean(configError)}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </main>
    </div>
  );
}
