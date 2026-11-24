import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { addDays, format, isSameDay } from 'date-fns';
import { usePageData, useData } from '../../context/DataContext';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import { studioDay, studioHourMinute } from '../../lib/utils';
import type { Session } from '../../types';

const START_HOUR = 11; // 11 AM
const END_HOUR = 17; // 5 PM
const SLOT_MINUTES = 30;
const ROWS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES; // 12 half-hour rows

const timeLabel = (row: number) => {
  const minutes = START_HOUR * 60 + row * SLOT_MINUTES;
  const hour24 = Math.floor(minutes / 60);
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${(minutes % 60).toString().padStart(2, '0')} ${hour24 < 12 ? 'AM' : 'PM'}`;
};

/** This session's first and last row in the grid (clipped to 11 AM-5 PM), or null if it doesn't touch that window at all. */
function rowRange(session: Session): [number, number] | null {
  const start = studioHourMinute(session.booking.startTime);
  const end = studioHourMinute(session.booking.endTime);
  const startMin = start.hour * 60 + start.minute;
  const endMin = end.hour * 60 + end.minute;
  const windowStart = START_HOUR * 60;
  const windowEnd = END_HOUR * 60;
  if (endMin <= windowStart || startMin >= windowEnd) return null;
  const first = Math.max(0, Math.floor((startMin - windowStart) / SLOT_MINUTES));
  const last = Math.min(ROWS - 1, Math.ceil((Math.min(endMin, windowEnd) - windowStart) / SLOT_MINUTES) - 1);
  return first <= last ? [first, last] : null;
}

/**
 * Every active coordinator's sessions for one day, as a grid: rows are the half-hour slots from 11 AM to 5 PM, columns are
 * coordinators. Each session is a block in the coordinator's own colour, filling every half-hour cell its duration covers.
 */
export default function Calendar() {
  const { sessions, coordinators, getClient, getModule, base } = useData();
  const page = usePageData('tickets', 'bookings', 'clients');
  const navigate = useNavigate();
  const [day, setDay] = useState(new Date());

  const active = coordinators.filter((c) => c.isActive);
  const dayKey = format(day, 'yyyy-MM-dd');
  const onDay = sessions.filter((s) => s.booking.status !== 'cancelled' && studioDay(s.booking.startTime) === dayKey);

  // coordinatorId -> row index -> the session occupying it (a session fills every row of its own span).
  const byCoordinator = useMemo(() => {
    const grid = new Map<string, (Session | undefined)[]>();
    for (const c of active) grid.set(c.id, Array.from({ length: ROWS }));
    for (const session of onDay) {
      const coordinatorId = session.ticket.coordinatorId;
      if (!coordinatorId || !grid.has(coordinatorId)) continue;
      const range = rowRange(session);
      if (!range) continue;
      const rows = grid.get(coordinatorId)!;
      for (let row = range[0]; row <= range[1]; row++) rows[row] = session;
    }
    return grid;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.map((c) => c.id).join(','), onDay]);

  const isToday = isSameDay(day, new Date());

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">Every consultant's sessions for one day, 11 AM to 5 PM. Click a block to open its ticket.</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn px-2" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
        <button className="btn" onClick={() => setDay(new Date())}>Today</button>
        <button className="btn px-2" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>›</button>
        <h2 className="ml-2 text-base font-semibold">{format(day, 'EEEE, d MMMM yyyy')}{isToday && ' (today)'}</h2>
      </div>

      {active.length === 0 ? (
        <div className="card">
          <EmptyState icon="calendar" message="No active consultants" hint="Add or activate a coordinator to see their schedule here." />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <div
            className="grid"
            style={{ gridTemplateColumns: `88px repeat(${active.length}, minmax(150px, 1fr))`, gridTemplateRows: `40px repeat(${ROWS}, 48px)`, minWidth: `${88 + active.length * 150}px` }}
          >
            <div className="sticky left-0 z-10 border-b border-r border-line bg-page" style={{ gridColumn: 1, gridRow: 1 }} />
            {active.map((c, i) => (
              <div key={c.id} className="flex items-center gap-1.5 border-b border-l border-line bg-page px-2" style={{ gridColumn: i + 2, gridRow: 1 }}>
                <Avatar name={c.name} color={c.color} size="sm" />
                <span className="truncate text-xs font-semibold">{c.name}</span>
              </div>
            ))}

            {Array.from({ length: ROWS }).map((_, row) => (
              <div key={`t-${row}`} className="border-b border-r border-line px-2 py-1 text-[11px] text-ink-3" style={{ gridColumn: 1, gridRow: row + 2 }}>
                {timeLabel(row)}
              </div>
            ))}

            {active.flatMap((c, i) => {
              const rows = byCoordinator.get(c.id) ?? [];
              return Array.from({ length: ROWS }).map((_, row) => {
                const session = rows[row];
                const first = row === 0 || rows[row - 1] !== session;
                if (!session) return <div key={`${c.id}-${row}`} className="border-b border-l border-line" style={{ gridColumn: i + 2, gridRow: row + 2 }} />;
                const client = getClient(session.ticket.clientId);
                const module = getModule(session.ticket.moduleId);
                return (
                  <button
                    key={`${c.id}-${row}`}
                    title={`${client?.personName ?? ''} · ${module?.name ?? ''} · ${client?.companyName ?? ''}`}
                    onClick={() => navigate(`${base}/tickets/${session.ticket.id}`)}
                    className="overflow-hidden truncate border-l border-line px-1.5 text-left text-[11px] text-white hover:brightness-95"
                    style={{ gridColumn: i + 2, gridRow: row + 2, background: c.color, borderTop: first ? undefined : 'none' }}
                  >
                    {first && (
                      <span className="block truncate pt-1 font-semibold">
                        {client?.personName}
                        <span className="block truncate font-normal opacity-90">{module?.name}</span>
                      </span>
                    )}
                  </button>
                );
              });
            })}
          </div>
        </div>
      )}
    </div>
  );
}
