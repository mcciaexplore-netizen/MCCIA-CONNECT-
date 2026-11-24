import { useEffect, useState } from 'react';
import { addMonths, differenceInCalendarDays, endOfMonth, format, getDate, getDay, isBefore, startOfDay, startOfMonth } from 'date-fns';
import { api, cn, formatTime } from '../../lib/utils';
import { type BookingMode, type SlotInfo } from '../../types';
import Icon from './Icon';

interface Props {
  slug: string;
  venue: string; // shown on the Offline card
  mode: BookingMode;
  onModeChange: (mode: BookingMode) => void;
  startsAt: string; // the chosen slot ('' = none)
  onSelect: (startsAt: string) => void;
  lockMode?: boolean; // the mode is fixed (rescheduling a session): no online / offline cards
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TITLES = { past: 'Past date', closed: 'Not available', full: 'Fully booked', open: '' };
const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

/** Mode cards, a calendar for this month and next, and the times of the chosen day. Taken times stay visible but greyed. */
export default function SlotPicker({ slug, venue, mode, onModeChange, startsAt, onSelect, lockMode }: Props) {
  const [slots, setSlots] = useState<SlotInfo[] | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);
  const [date, setDate] = useState(startsAt ? dayKey(new Date(startsAt)) : '');
  const today = startOfDay(new Date());

  // Everything from today to the end of next month, in one request.
  useEffect(() => {
    const days = differenceInCalendarDays(endOfMonth(addMonths(new Date(), 1)), new Date()) + 1;
    api<SlotInfo[]>(`/api/slots?module=${encodeURIComponent(slug)}&days=${days}`).then(setSlots).catch(() => setSlots([]));
  }, [slug]);

  const byDay = new Map<string, SlotInfo[]>();
  for (const slot of slots ?? []) byDay.set(dayKey(new Date(slot.startsAt)), [...(byDay.get(dayKey(new Date(slot.startsAt))) ?? []), slot]);
  const offered = (m: BookingMode) => (slots ?? []).some((s) => s.modes.includes(m));

  // If the chosen mode has no openings at all but the other one does, start on that one.
  useEffect(() => {
    const other = mode === 'online' ? 'offline' : 'online';
    if (slots && !offered(mode) && offered(other)) onModeChange(other);
  }, [slots]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = (next: BookingMode) => {
    onModeChange(next);
    if (startsAt && !(slots ?? []).some((s) => s.startsAt === startsAt && s.modes.includes(next))) onSelect('');
  };
  const dayState = (day: Date) => {
    if (isBefore(day, today)) return 'past';
    const list = byDay.get(dayKey(day));
    return !list ? 'closed' : list.some((s) => s.modes.includes(mode)) ? 'open' : 'full';
  };

  const month = addMonths(startOfMonth(today), monthOffset);
  const blanks = (getDay(month) + 6) % 7; // Monday first
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: getDate(endOfMonth(month)) }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))] as (Date | null)[];
  const times = byDay.get(date) ?? [];

  if (!slots) return <p className="text-ink-2">Loading availability…</p>;

  return (
    <div className="space-y-6">
      {!lockMode && <div>
        <p className="label">How would you like to meet? *</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['online', 'offline'] as const).map((m) => (
            <button
              type="button"
              key={m}
              disabled={!offered(m)}
              onClick={() => changeMode(m)}
              className={cn('rounded-md border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50', mode === m ? 'border-primary bg-primary-light' : 'border-line bg-white hover:border-primary')}
            >
              <Icon name={m === 'online' ? 'video' : 'location'} className="mb-2 h-6 w-6 text-primary" />
              <p className="font-semibold">{m === 'online' ? 'Online' : 'Offline'}</p>
              <p className="text-xs text-ink-2">{!offered(m) ? 'No openings right now' : m === 'online' ? 'Google Meet link auto-generated' : venue || 'In person at the studio'}</p>
            </button>
          ))}
        </div>
      </div>}

      {slots.length === 0 ? (
        <p className="rounded-md bg-page px-4 py-3 text-ink-2">No slots are open right now. Please check back later.</p>
      ) : (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="label mb-0">Pick a date *</p>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous month" className="btn px-2 py-0.5" disabled={monthOffset === 0} onClick={() => setMonthOffset(0)}>‹</button>
                <span className="w-32 text-center font-semibold">{format(month, 'MMMM yyyy')}</span>
                <button type="button" aria-label="Next month" className="btn px-2 py-0.5" disabled={monthOffset === 1} onClick={() => setMonthOffset(1)}>›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAYS.map((d) => (
                <span key={d} className="py-1 text-[11px] font-semibold uppercase text-ink-3">{d}</span>
              ))}
              {cells.map((day, i) => {
                if (!day) return <span key={`blank-${i}`} />;
                const state = dayState(day);
                const key = dayKey(day);
                return (
                  <button
                    type="button"
                    key={key}
                    disabled={state !== 'open'}
                    title={TITLES[state]}
                    onClick={() => {
                      setDate(key);
                      onSelect('');
                    }}
                    className={cn(
                      'h-10 rounded-md border text-sm transition',
                      state !== 'open' && 'cursor-not-allowed border-transparent bg-page text-ink-3',
                      state === 'open' && date !== key && 'border-line bg-white hover:border-primary hover:text-primary',
                      state === 'open' && date === key && 'border-primary bg-primary font-semibold text-white',
                    )}
                  >
                    {getDate(day)}
                  </button>
                );
              })}
            </div>
          </div>

          {date && (
            <div>
              <p className="label">Pick a time on {format(new Date(`${date}T00:00:00`), 'EEEE, d MMM')} *</p>
              <div className="flex flex-wrap gap-2">
                {times.map((slot) => {
                  const open = slot.modes.includes(mode);
                  return (
                    <button
                      type="button"
                      key={slot.startsAt}
                      disabled={!open}
                      title={open ? '' : 'Taken'}
                      onClick={() => onSelect(slot.startsAt)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-sm transition',
                        !open && 'cursor-not-allowed border-transparent bg-page text-ink-3 line-through',
                        open && startsAt !== slot.startsAt && 'border-line bg-white hover:border-primary hover:text-primary',
                        open && startsAt === slot.startsAt && 'border-primary bg-primary font-semibold text-white',
                      )}
                    >
                      {formatTime(slot.startsAt)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
