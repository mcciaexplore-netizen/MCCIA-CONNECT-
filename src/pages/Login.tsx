import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useData } from '../context/DataContext';
import { errorMessage, homeFor, usePublicSettings } from '../lib/utils';

export default function Login() {
  const { authLoading, role, signIn } = useData();
  const { brand } = usePublicSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!authLoading && role) return <Navigate to={homeFor(role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email, password); // the page redirects by role once the session is there
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <form onSubmit={submit} className="w-full max-w-sm overflow-hidden rounded-md border border-line bg-white shadow-sm">
        <div className="bg-primary-dark px-8 py-6 text-center text-white">
          <h1 className="text-xl font-semibold">{brand.name}</h1>
          <p className="mt-1 text-xs text-white/80">Sign in to the CRM</p>
        </div>
        <div className="space-y-4 p-8">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-md bg-danger-light px-3 py-2 text-sm text-danger-dark">{error}</p>}
          <button className="btn btn-primary h-10 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </main>
  );
}
