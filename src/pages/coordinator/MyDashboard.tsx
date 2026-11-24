import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import ModePill from '../../components/ui/ModePill';
import ModuleBadge from '../../components/ui/ModuleBadge';
import StatCard from '../../components/ui/StatCard';
import StatusBadge from '../../components/ui/StatusBadge';
import PostConsultationModal from '../../components/ticket/PostConsultationModal';
import { dayStats } from '../../lib/dashboard';
import { cn, formatDate, formatDateTime, formatTime } from '../../lib/utils';
import type { Session, Ticket } from '../../types';

const DAY = 24 * 60 * 60 * 1000;
const RECENT_CLIENTS = 8;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
      {children}
    </section>
  );
}

/** The coordinator's day at a glance. Everything is computed from their own tickets and bookings (the API only returns those). */
export default function MyDashboard() {
  const { sessions, getClient, getModule } = useData();
  const page = usePageData('tickets', 'bookings', 'clients');
  const navigate = useNavigate();
  const [fillFor, setFillFor] = useState<Ticket | null>(null);

  const now = new Date();
  const { live, today, pending, upcoming, completedThisMonth, noShowToday, rescheduledToday } = dayStats(sessions, now);
  const start = (s: Session) => new Date(s.booking.startTime);
  const end = (s: Session) => new Date(s.booking.endTime);

  // The latest past session of each client, most recent first.
  const lastByClient = new Map<string, Session>();
  for (const s of live) if (start(s) <= now) lastByClient.set(s.ticket.clientId, s);
  const recent = [...lastByClient.values()].sort((a, b) => start(b).getTime() - start(a).getTime()).slice(0, RECENT_CLIENTS);

  const todayColumns: Column<Session>[] = [
    { header: 'Time', cell: (s) => `${formatTime(s.booking.startTime)} – ${formatTime(s.booking.endTime)}`, className: 'whitespace-nowrap' },
    { header: 'Client', cell: (s) => getClient(s.ticket.clientId)?.personName ?? '—' },
    { header: 'Company', cell: (s) => getClient(s.ticket.clientId)?.companyName ?? '—' },
    { header: 'Module', cell: (s) => <ModuleBadge module={getModule(s.ticket.moduleId)} /> },
    { header: 'Mode', cell: (s) => <ModePill mode={s.booking.mode} /> },
    {
      header: 'Meet Link',
      cell: (s) =>
        s.booking.meetingLink ? (
          <a className="btn btn-primary px-2 py-0.5 text-xs" href={s.booking.meetingLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Join</a>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
  ];
  const recentColumns: Column<Session>[] = [
    { header: 'Company', cell: (s) => getClient(s.ticket.clientId)?.companyName ?? '—' },
    { header: 'Person', cell: (s) => getClient(s.ticket.clientId)?.personName ?? '—' },
    { header: 'Module', cell: (s) => <ModuleBadge module={getModule(s.ticket.moduleId)} /> },
    { header: 'Last Session', cell: (s) => formatDate(s.booking.startTime) },
    { header: 'Status', cell: (s) => <StatusBadge status={s.ticket.status} /> },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <p className="page-sub">Your sessions and what needs doing.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="My Upcoming (Next 7 days)" value={upcoming} />
        <StatCard label="Today's Sessions" value={today.length} />
        <StatCard label="Completed This Month" value={completedThisMonth} />
        <StatCard label="Pending Post-Consultation" value={pending.length} highlight={pending.length > 0} />
        <StatCard label="No Shows Today" value={noShowToday} />
        <StatCard label="Rescheduled Today" value={rescheduledToday} />
      </div>

      <Section title="Today's schedule">
        <DataTable columns={todayColumns} data={today} rowKey={(s) => s.booking.id} onRowClick={(s) => navigate(`/coordinator/tickets/${s.ticket.id}`)} empty="No sessions today" emptyAction={{ label: 'View my schedule', onClick: () => navigate('/coordinator/schedule') }} />
      </Section>

      <Section title="Pending post-consultation">
        {pending.length === 0 && <p className="card text-ink-3">Nothing pending. All finished sessions have their notes.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pending.map((s) => {
            const client = getClient(s.ticket.clientId);
            const overdue = now.getTime() - end(s).getTime() > DAY;
            return (
              <div key={s.booking.id} className={cn('card flex flex-col gap-2', overdue && 'border-2 border-amber-400')}>
                <div>
                  <p className="font-semibold">{client?.personName}</p>
                  <p className="text-ink-2">{client?.companyName}</p>
                </div>
                <div className="flex items-center justify-between gap-2 text-ink-2">
                  <span>{formatDateTime(s.booking.startTime)}</span>
                  <ModuleBadge module={getModule(s.ticket.moduleId)} />
                </div>
                {overdue && <p className="text-xs font-medium text-amber-600">Over 24 hours ago</p>}
                <button className="btn btn-primary mt-1 self-start" onClick={() => setFillFor(s.ticket)}>Fill Now</button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="My recent clients">
        <DataTable
          columns={recentColumns}
          data={recent}
          rowKey={(s) => s.ticket.clientId}
          onRowClick={(s) => navigate(`/coordinator/clients/${s.ticket.clientId}`)}
          empty="No sessions with clients yet."
        />
      </Section>

      {fillFor && <PostConsultationModal ticket={fillFor} onClose={() => setFillFor(null)} />}
    </div>
  );
}
