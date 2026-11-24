import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { MIN_PASSWORD_LENGTH } from '../../types';

/** Settings > Team: change the password of the account you are signed in as. */
export default function PasswordCard() {
  const { mutate } = useData();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate('/api/auth/change-password', 'PATCH', form, 'Password changed')) setForm({ currentPassword: '', newPassword: '' });
  };

  return (
    <form onSubmit={save} className="card space-y-4">
      <h2 className="font-semibold">Change my password</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Current password</label>
          <input className="input" type="password" autoComplete="current-password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        </div>
        <div>
          <label className="label">New password (min {MIN_PASSWORD_LENGTH} characters)</label>
          <input className="input" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </div>
      </div>
      <button className="btn btn-primary">Change password</button>
    </form>
  );
}
