import { useState } from 'react';
import { useNavigate } from 'react-router';
import { addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import { moduleColor } from '../../components/ui/ModuleBadge';
import { cn, formatTime } from '../../lib/utils';
import type { Session } from '../../types';

const WEEK = { weekStartsOn: 1 } as const; // Monday first
const MAX_PER_DAY = 3; // in the month view; the rest are behind "+N more"

/** The coordinator's sessions as a month or week calendar. Each session is a block coloured by its module. */
export default function MySchedule() {
  const { sessions, base, getClient, getModule } = useData();
  const page = usePageData('tickets', 'bookings', 'clients');
  const navigate = useNavigate();
  const [view, setView] = useState<'month' | 'week'>('month');
  const [anchor, setAnchor] = useState(new Date()); // any day inside the month / week on show

  const live = sessions.filter((s) => s.booking.status !== 'cancelled'); // already sorted by start time
  const days = eachDayOfInterval(
    view === 'month'
      ? { start: startOfWeek(startOfMonth(anchor), WEEK), end: endOfWeek(endOfMonth(anchor), WEEK) }
      : { start: startOfWeek(anchor, WEEK), end: endOfWeek(anchor, WEEK) },
  );
  const eventsOn = (day: Date) => live.filter((s) => isSameDay(new Date(s.booking.startTime), day));
  const step = (direction: 1 | -1) => setAnchor(view === 'month' ? addMonths(anchor, direction) : addWeeks(anchor, direction));
  const title = view === 'month' ? format(anchor, 'MMMM yyyy') : `${format(days[0], 'd MMM')} – ${format(days[6], 'd MMM yyyy')}`;

  const visible = days.flatMap(eventsOn);
  const legend = [...new Map(visible.map((s) => [s.ticket.moduleId, getModule(s.ticket.moduleId)])).values()].filter(Boolean);

  const block = ({ booking, ticket }: Session, detailed: boolean) => {
    const module = getModule(ticket.moduleId);
    const client = getClient(ticket.clientId);
    const color = module ? moduleColor(module) : 'var(--text-secondary)';
    return (
      <button
        key={booking.id}
        title={`${formatTime(booking.startTime)} · ${client?.personName} · ${module?.name}`}
        onClick={() => navigate(`${base}/tickets/${ticket.id}`)}
        className="block w-full truncate rounded px-1.5 py-1 text-left text-[11px] hover:brightness-95"
        style={{ background: `color-mix(in srgb, ${color} 14%, white)`, borderLeft: `3px solid ${color}` }}
      >
        <span className="font-semibold">{formatTime(booking.startTime)}</span> {client?.personName}
        {detailed && <span className="block truncate text-ink-2">{module?.name} · {booking.mode}</span>}
      </button>
    );
  };

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  const header = (
    <div className="page-header">
      <div>
        <h1 className="page-title">My Schedule</h1>
        <p className="page-sub">Click a session to open its ticket.</p>
      </div>
    </div>
  );
  if (sessions.length === 0) {
    return (
      <div>
        {header}
        <div className="card">
          <EmptyState icon="calendar" message="No sessions scheduled" hint="Sessions booked with your clients will appear on this calendar." action={{ label: 'View my tickets', onClick: () => navigate('/coordinator/tickets') }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn px-2" aria-label="Previous" onClick={() => step(-1)}>‹</button>
          <button className="btn" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="btn px-2" aria-label="Next" onClick={() => step(1)}>›</button>
          <h2 className="ml-2 text-base font-semibold">{title}</h2>
        </div>
        <div className="flex">
          {(['month', 'week'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn('btn rounded-none capitalize first:rounded-l-md last:rounded-r-md', view === v && 'border-primary bg-primary text-white hover:bg-primary-dark')}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-line bg-white">
        <div className="grid grid-cols-7 border-b border-line bg-page text-center text-[11px] font-semibold uppercase tracking-wide text-ink-2">
          {days.slice(0, 7).map((day) => (
            <div key={day.toISOString()} className="py-2">{format(day, 'EEE')}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const events = eventsOn(day);
            const shown = view === 'month' ? events.slice(0, MAX_PER_DAY) : events;
            const isToday = isSameDay(day, new Date());
            return (
              <div key={day.toISOString()} className={cn('border-b border-r border-line p-1.5', view === 'month' ? 'min-h-[112px]' : 'min-h-[320px]', view === 'month' && !isSameMonth(day, anchor) && 'bg-page')}>
                <p className={cn('mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs', isToday ? 'bg-primary font-semibold text-white' : view === 'month' && !isSameMonth(day, anchor) ? 'text-ink-3' : 'text-ink-2')}>
                  {format(day, view === 'month' ? 'd' : 'd MMM')}
                </p>
                <div className="space-y-1">
                  {shown.map((s) => block(s, view === 'week'))}
                  {events.length > shown.length && (
                    <button className="px-1 text-[11px] font-medium text-primary hover:underline" onClick={() => { setView('week'); setAnchor(day); }}>
                      +{events.length - shown.length} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {legend.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-4 text-ink-2">
          {legend.map((module) => (
            <span key={module!.id} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: moduleColor(module!) }} />
              {module!.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
