import { Link, useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import { cn } from '../../lib/utils';

/** Settings > Team: who can sign in. Coordinators are managed on their own page. */
export default function TeamTab() {
  const { coordinators } = useData();
  const navigate = useNavigate();

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Coordinators</h2>
        <Link className="btn" to="/admin/coordinators">Manage coordinators</Link>
      </div>
      <ul className="divide-y divide-line">
        {coordinators.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-2">
            <Avatar name={c.name} color={c.color} size="sm" />
            <span className="font-medium">{c.name}</span>
            <span className="text-ink-2">{c.email}</span>
            <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium', c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-ink-2')}>{c.isActive ? 'Active' : 'Inactive'}</span>
          </li>
        ))}
      </ul>
      {coordinators.length === 0 && <EmptyState icon="user-group" message="No coordinators yet" action={{ label: '+ Add Coordinator', onClick: () => navigate('/admin/coordinators') }} />}
      <p className="text-ink-2">Admin accounts are created with <code>POST /api/auth/create-user</code>, signed in as an admin.</p>
    </div>
  );
}
