import { useState } from 'react';
import { Link } from 'react-router';
import { useData } from '../../context/DataContext';
import CoordinatorForm from '../coordinator/CoordinatorForm';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import { cn } from '../../lib/utils';
import type { Coordinator } from '../../types';
import AdminsCard from './AdminsCard';
import PasswordCard from './PasswordCard';

/** Settings > Team: everyone who can sign in. Edit a coordinator (details, email, password) or add one here, add admins, change your own password. */
export default function TeamTab() {
  const { coordinators } = useData();
  const [form, setForm] = useState<Coordinator | 'new' | null>(null);

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Coordinators</h2>
          <div className="flex gap-2">
            <Link className="btn" to="/admin/coordinators">Manage coordinators</Link>
            {coordinators.length > 0 && <button className="btn btn-primary" onClick={() => setForm('new')}>+ Add Coordinator</button>}
          </div>
        </div>
        <ul className="divide-y divide-line">
          {coordinators.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
              <Avatar name={c.name} color={c.color} size="sm" />
              <span className="font-medium">{c.name}</span>
              <span className="text-ink-2">{c.email}</span>
              <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium', c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-ink-2')}>{c.isActive ? 'Active' : 'Inactive'}</span>
              <button className="btn px-2 py-1 text-xs" onClick={() => setForm(c)}>Edit</button>
            </li>
          ))}
        </ul>
        {coordinators.length === 0 && <EmptyState icon="user-group" message="No coordinators yet" action={{ label: '+ Add Coordinator', onClick: () => setForm('new') }} />}
      </div>

      <AdminsCard />
      <PasswordCard />

      {form && <CoordinatorForm coordinator={form === 'new' ? undefined : form} onClose={() => setForm(null)} />}
    </div>
  );
}
