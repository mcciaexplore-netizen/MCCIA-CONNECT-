import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import Avatar from '../ui/Avatar';
import { MIN_PASSWORD_LENGTH, type AdminUser } from '../../types';

const BLANK = { name: '', email: '', password: '' };

/** Settings > Team: the admin logins, and adding another one. */
export default function AdminsCard() {
  const { get, mutate, user } = useData();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK);
  const set = (patch: Partial<typeof BLANK>) => setForm({ ...form, ...patch });

  const load = useCallback(() => get<AdminUser[]>('/api/auth/users').then(setAdmins).catch(() => {}), [get]);
  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!(await mutate('/api/auth/create-user', 'POST', form, 'Admin added'))) return;
    setForm(BLANK);
    setAdding(false);
    load();
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Admins</h2>
        <button className="btn" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Add admin'}</button>
      </div>
      <ul className="divide-y divide-line">
        {admins.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <Avatar name={a.name} size="sm" />
            <span className="font-medium">{a.name}</span>
            <span className="text-ink-2">{a.email}</span>
            {a.id === user?.userId && <span className="ml-auto text-xs text-ink-3">You</span>}
          </li>
        ))}
      </ul>
      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-3">
          <input className="input" placeholder="Name" aria-label="Admin name" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
          <input className="input" type="email" placeholder="Email (login)" aria-label="Admin email" required value={form.email} onChange={(e) => set({ email: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder={`Password (min ${MIN_PASSWORD_LENGTH})`} aria-label="Admin password" minLength={MIN_PASSWORD_LENGTH} required value={form.password} onChange={(e) => set({ password: e.target.value })} />
          <div className="sm:col-span-3"><button className="btn btn-primary">Add admin</button></div>
        </form>
      )}
    </div>
  );
}
