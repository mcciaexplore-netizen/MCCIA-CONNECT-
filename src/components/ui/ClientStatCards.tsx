import { clientStats } from '../../lib/utils';
import type { Ticket } from '../../types';
import StatCard from './StatCard';

/** All Tickets / Open / Overdue / Rating for one client's tickets. */
export default function ClientStatCards({ tickets }: { tickets: Ticket[] }) {
  const stats = clientStats(tickets);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="All Tickets" value={stats.total} />
      <StatCard label="Open" value={stats.open} />
      <StatCard label="Overdue" value={stats.overdue} />
      <StatCard label="Rating" value={stats.rating} />
    </div>
  );
}
