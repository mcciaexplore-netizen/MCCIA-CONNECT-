import { Link } from 'react-router';
import { useData } from '../../context/DataContext';
import { formatDateTime } from '../../lib/utils';
import type { Session } from '../../types';
import Avatar from '../ui/Avatar';
import ModePill from '../ui/ModePill';
import ModuleBadge from '../ui/ModuleBadge';
import StatusBadge from '../ui/StatusBadge';

function SessionList({ title, sessions, empty }: { title: string; sessions: Session[]; empty: string }) {
  const { base, getModule, getCoordinator } = useData();
  return (
    <section className="card p-0">
      <h2 className="border-b border-line px-4 py-3 font-semibold">{title} ({sessions.length})</h2>
      {sessions.length === 0 && <p className="px-4 py-6 text-ink-3">{empty}</p>}
      <ul className="divide-y divide-line">
        {sessions.map(({ booking, ticket }) => {
          const coordinator = getCoordinator(booking.coordinatorId);
          return (
            <li key={booking.id}>
              <Link to={`${base}/tickets/${ticket.id}`} className="flex h-12 items-center gap-4 px-4 hover:bg-[var(--row-hover)]">
                <span className="w-44 font-medium">{formatDateTime(booking.startTime)}</span>
                <span className="w-44"><ModuleBadge module={getModule(ticket.moduleId)} /></span>
                <ModePill mode={booking.mode} />
                <span className="w-36 font-medium text-primary">{ticket.ticketNumber}</span>
                <span className="flex-1"><StatusBadge status={ticket.status} /></span>
                {coordinator ? <span title={coordinator.name}><Avatar name={coordinator.name} color={coordinator.color} size="sm" /></span> : <span className="text-ink-3">—</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A client's sessions: upcoming (soonest first) and past (latest first). Cancelled sessions count as past. */
export default function ActivitiesTab({ clientId }: { clientId: string }) {
  const { sessions } = useData();
  const now = new Date();
  const theirs = sessions.filter((s) => s.ticket.clientId === clientId);
  const upcoming = theirs.filter((s) => s.booking.status !== 'cancelled' && new Date(s.booking.endTime) > now);
  const past = theirs.filter((s) => !upcoming.includes(s)).reverse();

  return (
    <div className="space-y-4">
      <SessionList title="Upcoming sessions" sessions={upcoming} empty="No upcoming sessions." />
      <SessionList title="Past sessions" sessions={past} empty="No past sessions yet." />
    </div>
  );
}
