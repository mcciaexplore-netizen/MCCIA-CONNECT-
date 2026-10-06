import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import CoordinatorsView from '../../components/slots/CoordinatorsView';
import { badDay, DateOverrides, WeeklyHours } from '../../components/slots/HoursEditors';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import ModuleTabs from '../../components/ui/ModuleTabs';
import { cn } from '../../lib/utils';
import type { DateOverride, SlotConfig, WeeklyRule } from '../../types';

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

function ConfigEditor({ moduleId, config }: { moduleId: string; config?: SlotConfig }) {
  const { mutate, settings } = useData();
  const [draft, setDraft] = useState({ ...DEFAULTS, ...config });

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
        <p className="mb-4 text-ink-2">Switch a day on and set its hours, in {settings.timezone.label} ({settings.timezone.offset}, set in Settings). Add a second range for a lunch break.</p>
        <WeeklyHours rules={draft.weeklyRules} onChange={(weeklyRules) => setDraft({ ...draft, weeklyRules })} />
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
        <DateOverrides overrides={draft.dateOverrides} onChange={(dateOverrides) => setDraft({ ...draft, dateOverrides })} />
      </section>

      <button className="btn btn-primary">Save availability</button>
    </form>
  );
}

export default function SlotManager() {
  const { modules, slotConfigs } = useData();
  const navigate = useNavigate();
  const page = usePageData('slotConfigs');
  const [view, setView] = useState<'services' | 'coordinators'>('services');
  const [moduleId, setModuleId] = useState('');

  const selected = modules.find((m) => m.id === moduleId) ?? modules[0];
  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  const config = selected && slotConfigs.find((c) => c.moduleId === selected.id);

  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Slot manager</h1>
          <p className="page-sub">
            {view === 'coordinators'
              ? "Each coordinator's own hours, and which of their slots are free or booked. Bookings from every account show up here."
              : `Slots are generated from these rules, minus what is already booked. ${selected && !config ? 'This module has no availability yet, so nothing can be booked.' : ''}`}
          </p>
        </div>
      </div>
      <div className="mb-4 flex gap-2" role="tablist">
        {(['services', 'coordinators'] as const).map((tab) => (
          <button key={tab} role="tab" aria-selected={view === tab} onClick={() => setView(tab)} className={cn('btn', view === tab && 'border-primary bg-primary-light text-primary-dark')}>
            {tab === 'services' ? 'Services' : 'Coordinators'}
          </button>
        ))}
      </div>

      {view === 'coordinators' ? (
        <CoordinatorsView />
      ) : !selected ? (
        <div className="card">
          <EmptyState icon="calendar" message="No modules yet" hint="Availability is set per module." action={{ label: 'Add a module in Settings', onClick: () => navigate('/admin/settings') }} />
        </div>
      ) : (
        <>
          <ModuleTabs modules={modules} selectedId={selected.id} onSelect={setModuleId} />
          <ConfigEditor key={`${selected.id}-${config?.id ?? 'new'}`} moduleId={selected.id} config={config} />
        </>
      )}
    </div>
  );
}
