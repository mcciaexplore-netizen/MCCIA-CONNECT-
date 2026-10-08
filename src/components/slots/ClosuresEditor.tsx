import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useData, usePageData } from '../../context/DataContext';
import { cn, studioDay } from '../../lib/utils';
import type { AppSettings, Booking, Closures, Holiday, StudioBreak } from '../../types';
import DataState from '../ui/DataState';

const WEEK = [{ day: 1, name: 'Mon' }, { day: 2, name: 'Tue' }, { day: 3, name: 'Wed' }, { day: 4, name: 'Thu' }, { day: 5, name: 'Fri' }, { day: 6, name: 'Sat' }, { day: 0, name: 'Sun' }];
const FESTIVALS = ['Republic Day', 'Holi', 'Gudi Padwa', 'Ram Navami', 'Eid', 'Maharashtra Day', 'Independence Day', 'Ganesh Chaturthi', 'Dussehra', 'Diwali', 'Gurunanak Jayanti', 'Christmas'];

/** The problem with the breaks and holidays being saved, if any (the server checks again). */
function problem({ breaks, holidays }: Closures) {
  for (const b of breaks) {
    if (!b.days.length) return `Choose at least one day for "${b.label || 'the break'}"`;
    if (!b.start || !b.end || b.end <= b.start) return `"${b.label || 'A break'}" must end after it starts`;
  }
  for (const h of holidays) {
    if (!h.name.trim() || !h.from) return 'Give every holiday a name and a date';
    if (h.to && h.to < h.from) return `"${h.name}" ends before it starts`;
  }
}

/** The weekly breaks: a name, the days it applies to and its hours. */
function Breaks({ breaks, onChange }: { breaks: StudioBreak[]; onChange: (breaks: StudioBreak[]) => void }) {
  const set = (index: number, patch: Partial<StudioBreak>) => onChange(breaks.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  const toggle = (index: number, day: number) => set(index, { days: breaks[index].days.includes(day) ? breaks[index].days.filter((d) => d !== day) : [...breaks[index].days, day] });

  return (
    <>
      <div className="divide-y divide-line">
        {breaks.map((b, index) => (
          <div key={index} className="space-y-2 py-3" data-break={b.label}>
            <div className="flex flex-wrap items-center gap-2">
              <input className="input w-48" aria-label="Break name" placeholder="Break name" value={b.label} onChange={(e) => set(index, { label: e.target.value })} />
              <input className="input w-32" type="time" required aria-label={`${b.label} starts`} value={b.start} onChange={(e) => set(index, { start: e.target.value })} />
              <span className="text-ink-3">to</span>
              <input className="input w-32" type="time" required aria-label={`${b.label} ends`} value={b.end} onChange={(e) => set(index, { end: e.target.value })} />
              <button type="button" className="btn btn-danger" onClick={() => onChange(breaks.filter((_, i) => i !== index))}>Remove</button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${b.label} days`}>
              {WEEK.map(({ day, name }) => (
                <button type="button" key={day} aria-pressed={b.days.includes(day)} onClick={() => toggle(index, day)} className={cn('rounded-full border px-3 py-1 text-xs', b.days.includes(day) ? 'border-primary bg-primary-light font-semibold text-primary-dark' : 'border-line text-ink-2')}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn mt-3" onClick={() => onChange([...breaks, { label: '', days: [1, 2, 3, 4, 5], start: '13:00', end: '14:00' }])}>+ Add a break</button>
    </>
  );
}

/** How many sessions are still booked on the days of a holiday (they stay booked: a person moves them). */
const bookedOn = (bookings: Booking[], { from, to }: Holiday) =>
  bookings.filter((b) => b.status === 'scheduled' && new Date(b.startTime) > new Date() && studioDay(b.startTime) >= from && studioDay(b.startTime) <= (to || from)).length;

/** The festival and holiday leaves: a name and one date, or a first and last date. */
function Holidays({ holidays, bookings, onChange }: { holidays: Holiday[]; bookings: Booking[]; onChange: (holidays: Holiday[]) => void }) {
  const set = (index: number, patch: Partial<Holiday>) => onChange(holidays.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  const today = studioDay(new Date().toISOString());

  return (
    <>
      <datalist id="festival-names">{FESTIVALS.map((name) => <option key={name} value={name} />)}</datalist>
      <div className="space-y-2">
        {holidays.map((h, index) => {
          const booked = h.from ? bookedOn(bookings, h) : 0;
          return (
            <div key={index} className={cn('flex flex-wrap items-center gap-2', (h.to || h.from) && (h.to || h.from) < today && 'opacity-60')} data-holiday={h.name}>
              <input className="input w-56" list="festival-names" aria-label="Holiday name" placeholder="Festival or leave" value={h.name} onChange={(e) => set(index, { name: e.target.value })} />
              <input className="input w-40" type="date" required aria-label={`${h.name} first day`} value={h.from} onChange={(e) => set(index, { from: e.target.value, ...(h.to === h.from && { to: '' }) })} />
              <span className="text-ink-3">to</span>
              <input className="input w-40" type="date" min={h.from} aria-label={`${h.name} last day`} title="Leave empty for a single day" value={h.to === h.from ? '' : h.to} onChange={(e) => set(index, { to: e.target.value })} />
              <button type="button" className="btn btn-danger" onClick={() => onChange(holidays.filter((_, i) => i !== index))}>Remove</button>
              {booked > 0 && <span className="w-full text-xs text-[#8a6d1c]">{booked} {booked === 1 ? 'session is' : 'sessions are'} already booked on these days. They stay booked: reschedule them from the ticket.</span>}
            </div>
          );
        })}
        {holidays.length === 0 && <p className="text-ink-3">No holidays added yet.</p>}
      </div>
      <button type="button" className="btn mt-3" onClick={() => onChange([...holidays, { name: '', from: '', to: '' }])}>+ Add a holiday</button>
    </>
  );
}

/** Slot manager > Breaks & holidays: when the studio is closed, for every service and every coordinator. */
export default function ClosuresEditor() {
  const { settings, bookings, mutate } = useData();
  const page = usePageData('bookings');
  const [draft, setDraft] = useState<Closures>(settings.closures);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const bad = problem(draft);
    if (bad) return toast.error(bad);
    const saved = await mutate<AppSettings>('/api/settings', 'PUT', { closures: draft }, 'Breaks and holidays saved');
    if (saved) setDraft(saved.closures); // the server puts the holidays in date order
  };

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  return (
    <form onSubmit={save} className="space-y-6">
      <section className="card">
        <h2 className="mb-1 font-semibold">Daily breaks</h2>
        <p className="mb-2 text-ink-2">No session can be booked in these hours, for any service or coordinator, in {settings.timezone.label} ({settings.timezone.offset}). A slot that would overlap a break is not offered.</p>
        <Breaks breaks={draft.breaks} onChange={(breaks) => setDraft({ ...draft, breaks })} />
      </section>
      <section className="card">
        <h2 className="mb-1 font-semibold">Festival and holiday leaves</h2>
        <p className="mb-4 text-ink-2">The studio is closed on these dates: nothing can be booked, by clients or by staff. Leave the second date empty for a single day.</p>
        <Holidays holidays={draft.holidays} bookings={bookings} onChange={(holidays) => setDraft({ ...draft, holidays })} />
      </section>
      <button className="btn btn-primary">Save breaks and holidays</button>
    </form>
  );
}
