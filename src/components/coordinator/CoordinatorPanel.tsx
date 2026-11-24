import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import Avatar from '../ui/Avatar';
import CoordinatorForm from './CoordinatorForm';
import Drawer from '../ui/Drawer';
import StatCard from '../ui/StatCard';
import StatusBadge from '../ui/StatusBadge';
import { awaitingNotes } from '../../lib/dashboard';
import { cn, clientStats, formatDate, isOpen } from '../../lib/utils';
import type { Coordinator } from '../../types';

const RECENT_TICKETS = 5;

/** Slides in from the right when a coordinator's row is clicked: their numbers, clients and latest tickets. */
export default function CoordinatorPanel({ coordinator: c, onClose }: { coordinator: Coordinator; onClose: () => void }) {
  const { tickets, clients, sessions, getClient, mutate } = useData();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const now = new Date();
  const own = tickets.filter((t) => t.coordinatorId === c.id);
  const mine = clients.filter((client) => client.assignedCoordinatorId === c.id);
  const theirs = sessions.filter((s) => s.ticket.coordinatorId === c.id && s.booking.status !== 'cancelled');
  const stats = clientStats(own);

  // The edit form takes the drawer's place while it is open.
  if (editing) return <CoordinatorForm coordinator={c} onClose={() => setEditing(false)} />;

  return (
    <Drawer title="Coordinator" onClose={onClose}>
      <div className="flex items-center gap-3">
        <Avatar name={c.name} color={c.color} size="lg" />
        <div className="min-w-0">
          <p className="text-base font-semibold">{c.name}</p>
          <p className="truncate text-ink-2">{c.email}</p>
          <p className="text-ink-2">{c.phone || 'No phone'}</p>
        </div>
        <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium', c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-ink-2')}>{c.isActive ? 'Active' : 'Inactive'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Active clients" value={mine.length} />
        <StatCard label="Open tickets" value={stats.open} />
        <StatCard label="Completed" value={own.filter((t) => t.status === 'completed').length} />
        <StatCard label="Total tickets" value={stats.total} />
        <StatCard label="Upcoming sessions" value={theirs.filter((s) => new Date(s.booking.startTime) > now).length} />
        <StatCard label="Post-consultation due" value={theirs.filter((s) => awaitingNotes(s, now)).length} />
        <StatCard label="No shows" value={own.filter((t) => t.status === 'no_show').length} />
        <StatCard label="Average rating" value={stats.rating} />
      </div>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Clients</h3>
        <ul className="space-y-1">
          {mine.map((client) => (
            <li key={client.id}>
              <button className="text-primary hover:underline" onClick={() => navigate(`/admin/clients/${client.id}`)}>{client.personName}</button>
              <span className="text-ink-2"> · {client.companyName}</span>
            </li>
          ))}
          {mine.length === 0 && <li className="text-ink-3">No clients assigned.</li>}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Latest tickets</h3>
        <ul className="space-y-2">
          {own.slice(0, RECENT_TICKETS).map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <button className="font-medium text-primary hover:underline" onClick={() => navigate(`/admin/tickets/${t.id}`)}>{t.ticketNumber}</button>
              <span className="truncate text-ink-2">{getClient(t.clientId)?.companyName}</span>
              <span className="ml-auto text-ink-3">{formatDate(t.createdAt)}</span>
              <StatusBadge status={t.status} />
            </li>
          ))}
          {own.length === 0 && <li className="text-ink-3">No tickets yet.</li>}
        </ul>
      </section>

      <button className="btn w-full" onClick={() => setEditing(true)}>Edit details or password</button>
      <button
        className={cn('btn w-full', c.isActive && 'btn-danger')}
        onClick={() => mutate('/api/coordinators', 'PATCH', { id: c.id, isActive: !c.isActive }, c.isActive ? 'Coordinator deactivated' : 'Coordinator activated')}
      >
        {c.isActive ? 'Deactivate coordinator' : 'Activate coordinator'}
      </button>
      {c.isActive && own.some((t) => isOpen(t.status)) && <p className="-mt-3 text-xs text-ink-3">Deactivating blocks their login. Their open tickets stay assigned until you reassign them.</p>}
    </Drawer>
  );
}
