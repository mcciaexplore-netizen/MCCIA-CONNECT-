import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import ModuleTabs from '../../components/ui/ModuleTabs';
import type { DateOverride, SlotConfig, WeeklyRule } from '../../types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const DEFAULTS = {
  weeklyRules: [] as WeeklyRule[],
  dateOverrides: [] as DateOverride[],
  bufferBefore: 0,
  bufferAfter: 0,
  minNotice: 60,
  slotIncrement: 60,
  maxParallel: 1,
  onlineCapacity: 1,
  offlineCapacity: 1,
};

type NumberKey = 'slotIncrement' | 'minNotice' | 'bufferBefore' | 'bufferAfter' | 'maxParallel' | 'onlineCapacity' | 'offlineCapacity';
interface NumberField {
  key: NumberKey;
  label: string;
  hint: string;
}

const TIMING: NumberField[] = [
  { key: 'slotIncrement', label: 'Duration (min)', hint: 'How long a session is, and the gap between slot start times' },
  { key: 'bufferBefore', label: 'Buffer before (min)', hint: 'Kept free before each booking' },
  { key: 'bufferAfter', label: 'Buffer after (min)', hint: 'Kept free after each booking' },
  { key: 'minNotice', label: 'Minimum notice (min)', hint: 'How soon before a slot it can still be booked' },
];
const CAPACITY: NumberField[] = [
  { key: 'maxParallel', label: 'Max parallel bookings', hint: 'At the same time, online and offline together' },
  { key: 'onlineCapacity', label: 'Online capacity', hint: 'Parallel online bookings (0 turns online off)' },
  { key: 'offlineCapacity', label: 'Offline capacity', hint: 'Parallel offline bookings (0 turns offline off)' },
];

/** The first day whose ranges end before they start or overlap, if any. */
function badDay(rules: WeeklyRule[]) {
  for (const day of WEEK) {
    const ranges = rules.filter((r) => r.day === day).sort((a, b) => a.start.localeCompare(b.start));
    if (ranges.some((r, i) => r.end <= r.start || (i > 0 && r.start < ranges[i - 1].end))) return DAYS[day];
  }
}

function ConfigEditor({ moduleId, config }: { moduleId: string; config?: SlotConfig }) {
  const { mutate } = useData();
  const [draft, setDraft] = useState({ ...DEFAULTS, ...config });

  const setRule = (index: number, patch: Partial<WeeklyRule>) =>
    setDraft({ ...draft, weeklyRules: draft.weeklyRules.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const addRange = (day: number, start = '10:00', end = '17:00') => setDraft({ ...draft, weeklyRules: [...draft.weeklyRules, { day, start, end }] });
  const toggleDay = (day: number, on: boolean) => (on ? addRange(day) : setDraft({ ...draft, weeklyRules: draft.weeklyRules.filter((r) => r.day !== day) }));
  const setOverride = (index: number, patch: Partial<DateOverride>) =>
    setDraft({ ...draft, dateOverrides: draft.dateOverrides.map((o, i) => (i === index ? { ...o, ...patch } : o)) });

  const save = (e: FormEvent) => {
    e.preventDefault();
    const bad = badDay(draft.weeklyRules);
    if (bad) return toast.error(`${bad}: each range must end after it starts and ranges cannot overlap`);
    mutate('/api/slots', 'PUT', { moduleId, ...draft }, 'Availability saved');
  };

  const numbers = (fields: NumberField[]) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map(({ key, label, hint }) => (
        <div key={key}>
          <label className="label">{label}</label>
          <input className="input" type="number" min={key === 'slotIncrement' ? 5 : key === 'maxParallel' ? 1 : 0} required value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })} />
          <p className="mt-1 text-xs text-ink-3">{hint}</p>
        </div>
      ))}
    </div>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="card">
        <h2 className="mb-1 font-semibold">Weekly availability</h2>
        <p className="mb-4 text-ink-2">Switch a day on and set its hours, in Pune time. Add a second range for a lunch break.</p>
        <div className="divide-y divide-line">
          {WEEK.map((day) => {
            const ranges = draft.weeklyRules.flatMap((rule, index) => (rule.day === day ? [{ rule, index }] : []));
            return (
              <div key={day} className="flex flex-wrap items-start gap-4 py-2.5" data-day={DAYS[day]}>
                <label className="flex w-36 items-center gap-2 py-1.5 font-medium">
                  <input type="checkbox" checked={ranges.length > 0} onChange={(e) => toggleDay(day, e.target.checked)} />
                  {DAYS[day]}
                </label>
                {ranges.length === 0 ? (
                  <span className="py-1.5 text-ink-3">Closed</span>
                ) : (
                  <div className="space-y-2">
                    {ranges.map(({ rule, index }) => (
                      <div key={index} className="flex items-center gap-2">
                        <input className="input w-32" type="time" required value={rule.start} onChange={(e) => setRule(index, { start: e.target.value })} />
                        <span className="text-ink-3">to</span>
                        <input className="input w-32" type="time" required value={rule.end} onChange={(e) => setRule(index, { end: e.target.value })} />
                        <button type="button" aria-label={`Remove ${DAYS[day]} range`} className="btn btn-danger px-2" onClick={() => setDraft({ ...draft, weeklyRules: draft.weeklyRules.filter((_, i) => i !== index) })}>×</button>
                      </div>
                    ))}
                    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => addRange(day, '14:00')}>+ Add range</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold">Buffers and timing</h2>
        {numbers(TIMING)}
      </section>

      <section className="card">
        <h2 className="mb-4 font-semibold">Capacity</h2>
        {numbers(CAPACITY)}
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold">Date overrides</h2>
        <p className="mb-4 text-ink-2">Block a date (a holiday), or give it different hours. An override replaces the weekly hours for that date.</p>
        <div className="space-y-2">
          {draft.dateOverrides.map((override, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input className="input w-44" type="date" required value={override.date} onChange={(e) => setOverride(index, { date: e.target.value })} />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={override.closed} onChange={(e) => setOverride(index, { closed: e.target.checked })} />
                Blocked all day
              </label>
              {!override.closed && (
                <>
                  <input className="input w-32" type="time" required value={override.start} onChange={(e) => setOverride(index, { start: e.target.value })} />
                  <span className="text-ink-3">to</span>
                  <input className="input w-32" type="time" required value={override.end} onChange={(e) => setOverride(index, { end: e.target.value })} />
                </>
              )}
              <button type="button" className="btn btn-danger" onClick={() => setDraft({ ...draft, dateOverrides: draft.dateOverrides.filter((_, i) => i !== index) })}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" className="btn mt-3" onClick={() => setDraft({ ...draft, dateOverrides: [...draft.dateOverrides, { date: '', closed: true, start: '10:00', end: '17:00' }] })}>+ Block a date</button>
      </section>

      <button className="btn btn-primary">Save availability</button>
    </form>
  );
}

export default function SlotManager() {
  const { modules, slotConfigs } = useData();
  const navigate = useNavigate();
  const page = usePageData('slotConfigs');
  const [moduleId, setModuleId] = useState('');

  const selected = modules.find((m) => m.id === moduleId) ?? modules[0];
  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  if (!selected) {
    return (
      <div className="card">
        <EmptyState icon="calendar" message="No modules yet" hint="Availability is set per module." action={{ label: 'Add a module in Settings', onClick: () => navigate('/admin/settings') }} />
      </div>
    );
  }
  const config = slotConfigs.find((c) => c.moduleId === selected.id);

  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Slot manager</h1>
          <p className="page-sub">Slots are generated from these rules, minus what is already booked. {!config && 'This module has no availability yet, so nothing can be booked.'}</p>
        </div>
      </div>
      <ModuleTabs modules={modules} selectedId={selected.id} onSelect={setModuleId} />
      <ConfigEditor key={`${selected.id}-${config?.id ?? 'new'}`} moduleId={selected.id} config={config} />
    </div>
  );
}
