import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { addDays, format } from 'date-fns';
import { useData } from '../../context/DataContext';
import { api, errorMessage, formatDate, formatTime } from '../../lib/utils';
import type { CoordinatorSlot } from '../../types';
import EmptyState from '../ui/EmptyState';
import ModePill from '../ui/ModePill';

const DAYS = 7;

const badge = (state: CoordinatorSlot['state']) => {
  const tone = state === 'available' ? 'completed' : 'new';
  return (
    <span className="w-20 rounded-full px-2 py-0.5 text-center text-[11px] font-medium" style={{ background: `var(--status-${tone}-bg)`, color: `var(--status-${tone}-text)` }}>
      {state === 'available' ? 'Available' : 'Booked'}
    </span>
  );
};

/** A coordinator's week, slot by slot: free slots (with the services that can still be booked in them) and booked sessions (with the client). */
export default function SlotCalendar({ coordinatorId, version }: { coordinatorId: string; version: unknown }) {
  const { role } = useData();
  const [week, setWeek] = useState(0);
  const [slots, setSlots] = useState<CoordinatorSlot[] | null>(null);
  const [error, setError] = useState('');
  const first = addDays(new Date(), week * DAYS);

  const load = useCallback(() => {
    setError('');
    setSlots(null);
    api<CoordinatorSlot[]>(`/api/slots?coordinator=${coordinatorId}&from=${format(addDays(new Date(), week * DAYS), 'yyyy-MM-dd')}&days=${DAYS}`)
      .then(setSlots)
      .catch((e) => setError(errorMessage(e)));
  }, [coordinatorId, week]);
  useEffect(load, [load, version]); // a new set of hours reloads it

  const byDay = new Map<string, CoordinatorSlot[]>();
  for (const slot of slots ?? []) byDay.set(formatDate(slot.startsAt), [...(byDay.get(formatDate(slot.startsAt)) ?? []), slot]);
  const free = (slots ?? []).filter((s) => s.state === 'available').length;
  const prefix = role === 'super_admin' ? '/admin' : '/coordinator';

  return (
    <section className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{format(first, 'd MMM')} – {format(addDays(first, DAYS - 1), 'd MMM yyyy')}</h2>
          {slots && <p className="text-ink-2">{free} free · {slots.length - free} booked</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn" disabled={week === 0} onClick={() => setWeek(week - 1)}>‹ Earlier</button>
          <button className="btn" onClick={() => setWeek(week + 1)}>Later ›</button>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>
      {error ? (
        <EmptyState icon="alert" message="Could not load the calendar" hint={error} action={{ label: 'Retry', onClick: load }} />
      ) : !slots ? (
        <div role="status" aria-label="Loading" className="h-40 animate-pulse rounded bg-line" />
      ) : slots.length === 0 ? (
        <EmptyState icon="calendar" message="No slots this week" hint="Nothing is open for booking in these days, or the hours above leave no free time." />
      ) : (
        [...byDay].map(([day, rows]) => (
          <div key={day} className="mb-3 last:mb-0">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">{day}</h3>
            <ul className="divide-y divide-line">
              {rows.map((slot) => (
                <li key={slot.startsAt + slot.state} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="w-36 font-medium tabular-nums">{formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}</span>
                  {badge(slot.state)}
                  {slot.booking ? (
                    <>
                      <Link to={`${prefix}/tickets/${slot.booking.ticketId}`} className="font-medium text-primary hover:underline">{slot.booking.clientName} · {slot.booking.companyName}</Link>
                      <span className="text-ink-2">{slot.booking.moduleName}</span>
                      <ModePill mode={slot.booking.mode} />
                    </>
                  ) : (
                    <span className="text-ink-2">{slot.services.join(', ')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
