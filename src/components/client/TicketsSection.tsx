import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import { cn, formatDate, isOpen } from '../../lib/utils';
import type { Ticket } from '../../types';
import Avatar from '../ui/Avatar';
import { moduleColor } from '../ui/ModuleBadge';
import StatusBadge from '../ui/StatusBadge';

const TABS = [
  { key: 'all', label: 'ALL', match: () => true },
  { key: 'open', label: 'OPEN', match: (t: Ticket) => isOpen(t.status) },
  { key: 'rescheduled', label: 'RESCHEDULED', match: (t: Ticket) => t.status === 'rescheduled' },
  { key: 'completed', label: 'COMPLETED', match: (t: Ticket) => t.status === 'completed' },
  { key: 'cancelled', label: 'CANCELLED', match: (t: Ticket) => t.status === 'cancelled' },
];

/** A client's tickets as a Zoho Desk style list with status filter tabs. */
export default function TicketsSection({ tickets }: { tickets: Ticket[] }) {
  const { base, getModule, getCoordinator, getSession } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const rows = tickets.filter(TABS.find((t) => t.key === tab)!.match);

  return (
    <section className="card p-0">
      <div className="flex gap-1 overflow-x-auto border-b border-line px-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cn('-mb-px border-b-2 px-3 py-3 text-xs font-semibold tracking-wide', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
            {t.label} ({tickets.filter(t.match).length})
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="px-4 py-8 text-center text-ink-3">No tickets here.</p>}
      <ul className="divide-y divide-line">
        {rows.map((ticket) => {
          const module = getModule(ticket.moduleId);
          const coordinator = getCoordinator(ticket.coordinatorId);
          return (
            <li key={ticket.id}>
              <button className="flex h-14 w-full items-center gap-3 px-4 text-left hover:bg-[var(--row-hover)]" onClick={() => navigate(`${base}/tickets/${ticket.id}`)}>
                <Avatar name={module?.name ?? '?'} color={module ? moduleColor(module) : undefined} />
                <span className="w-44 truncate font-medium">{module?.name}</span>
                <span className="w-36 font-medium text-primary">{ticket.ticketNumber}</span>
                <span className="w-28 text-ink-2" title="Session date">{formatDate(getSession(ticket.id)?.booking.startTime ?? ticket.createdAt)}</span>
                <span className="flex-1"><StatusBadge status={ticket.status} /></span>
                {coordinator ? <span title={coordinator.name}><Avatar name={coordinator.name} color={coordinator.color} size="sm" /></span> : <span className="text-ink-3" title="Unassigned">—</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
