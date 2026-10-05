import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { format } from 'date-fns';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import Avatar from '../../components/ui/Avatar';
import BookingLink from '../../components/ui/BookingLink';
import DataTable, { type Column } from '../../components/ui/DataTable';
import ModuleBadge, { moduleColor } from '../../components/ui/ModuleBadge';
import ModePill from '../../components/ui/ModePill';
import StatCard from '../../components/ui/StatCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { awaitingNotes, dayStats } from '../../lib/dashboard';
import { cn, formatTime, isOpen } from '../../lib/utils';
import type { Session } from '../../types';

const DAY = 24 * 60 * 60 * 1000;

/** The most common value and how many times it appears. */
function top(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0];
}

function Alert({ tone, children, action, onAction }: { tone: 'red' | 'amber'; children: ReactNode; action: string; onAction: () => void }) {
  return (
    <div role="alert" className={cn('mb-3 flex items-center justify-between gap-3 rounded-md border px-4 py-2.5', tone === 'red' ? 'border-danger bg-danger-light text-danger-dark' : 'border-gold bg-gold-light text-[#8a6d1c]')}>
      <span className="font-medium">{children}</span>
      <button className="btn" onClick={onAction}>{action}</button>
    </div>
  );
}

/** The studio at a glance. Everything is computed here from the sessions and tickets already loaded (no separate stats request). */
export default function Dashboard() {
  const { tickets, modules, sessions, getClient, getModule, getCoordinator } = useData();
  const page = usePageData('tickets', 'bookings', 'clients');
  const navigate = useNavigate();

  const now = new Date();
  const { live, today, pending, upcoming, completedThisMonth, noShowToday, rescheduledToday } = dayStats(sessions, now);
  const at = (s: Session) => new Date(s.booking.startTime);
  const sameAsNow = (s: Session, pattern: string) => format(at(s), pattern) === format(now, pattern);

  const busiestDay = top(live.filter((s) => at(s) <= now && now.getTime() - at(s).getTime() <= 30 * DAY).map((s) => format(at(s), 'EEEE')));
  const mostBooked = top(live.map((s) => getModule(s.ticket.moduleId)?.name ?? '').filter(Boolean));
  const unassigned = tickets.filter((t) => !t.coordinatorId && isOpen(t.status)).length;

  const scheduleColumns: Column<Session>[] = [
    { header: 'Time', cell: (s) => `${formatTime(s.booking.startTime)} – ${formatTime(s.booking.endTime)}`, className: 'whitespace-nowrap' },
    { header: 'Client', cell: (s) => getClient(s.ticket.clientId)?.personName ?? '—' },
    { header: 'Company', cell: (s) => getClient(s.ticket.clientId)?.companyName ?? '—' },
    { header: 'Module', cell: (s) => <ModuleBadge module={getModule(s.ticket.moduleId)} /> },
    {
      header: 'Coordinator',
      cell: (s) => {
        const c = getCoordinator(s.ticket.coordinatorId);
        return c ? <span className="inline-flex items-center gap-2"><Avatar name={c.name} color={c.color} size="sm" />{c.name}</span> : <span className="text-danger">Unassigned</span>;
      },
    },
    { header: 'Mode', cell: (s) => <ModePill mode={s.booking.mode} /> },
    { header: 'Status', cell: (s) => <StatusBadge status={s.ticket.status} /> },
    { header: 'Action', cell: (s) => <button className="btn px-2 py-0.5 text-xs" onClick={() => navigate(`/admin/tickets/${s.ticket.id}`)}>View</button> },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <button className="btn btn-primary" onClick={() => navigate('/admin/create-booking')}>+ Create Booking</button>
      </div>

      {unassigned > 0 && (
        <Alert tone="red" action="Assign Now" onAction={() => navigate('/admin/tickets?coordinator=none')}>
          {unassigned} ticket{unassigned === 1 ? '' : 's'} unassigned
        </Alert>
      )}
      {pending.length > 0 && (
        <Alert tone="amber" action="View" onAction={() => navigate('/admin/tickets?notes=pending')}>
          {pending.length} form{pending.length === 1 ? '' : 's'} not filled
        </Alert>
      )}

      <h2 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">At a Glance</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard icon="calendar" label="Upcoming 7 days" value={upcoming} />
        <StatCard icon="clock" label="Today's Sessions" value={today.length} />
        <StatCard icon="grid" label="Total This Week" value={live.filter((s) => sameAsNow(s, 'RRRR-II')).length} />
        <StatCard icon="calendar" label="Total This Month" value={live.filter((s) => sameAsNow(s, 'yyyy-MM')).length} />
        <StatCard icon="check" label="Completed This Month" value={completedThisMonth} />
        <StatCard icon="refresh" label="Rescheduled Today" value={rescheduledToday} />
        <StatCard icon="user-x" label="No Show Today" value={noShowToday} />
        <StatCard icon="bar-chart" label="Busiest Day (Last 30d)" value={busiestDay?.[0] ?? '—'} hint={busiestDay ? `${busiestDay[1]} session${busiestDay[1] === 1 ? '' : 's'}` : undefined} />
        <StatCard icon="star" label="Most Booked Module" value={mostBooked?.[0] ?? '—'} hint={mostBooked ? `${mostBooked[1]} booking${mostBooked[1] === 1 ? '' : 's'}` : undefined} />
      </div>

      <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Modules</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => {
          const own = live.filter((s) => s.ticket.moduleId === module.id);
          const figures = [
            ['Total bookings', own.length],
            ['Completed', own.filter((s) => s.ticket.status === 'completed').length],
            ['Pending post-consult', own.filter((s) => awaitingNotes(s, now)).length],
          ] as const;
          return (
            <div key={module.id} className="card min-w-0 border-t-4" style={{ borderTopColor: moduleColor(module) }}>
              <p className="mb-3 font-semibold">{module.name}</p>
              <dl className="space-y-1.5">
                {figures.map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <dt className="text-ink-2">{label}</dt>
                    <dd className="font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1 text-xs text-ink-3">Booking link for clients</p>
                <BookingLink module={module} />
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Today's Schedule</h2>
      <DataTable columns={scheduleColumns} data={today} rowKey={(s) => s.booking.id} empty="No sessions today" emptyAction={{ label: '+ Create Booking', onClick: () => navigate('/admin/create-booking') }} />
    </div>
  );
}
