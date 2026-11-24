import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import type { Availability, Coordinator } from '../../types';
import { badDay, DateOverrides, WeeklyHours } from './HoursEditors';

const NONE: Availability = { weeklyRules: [], dateOverrides: [] };

/** A coordinator's own hours: no personal limit (bookable whenever a service is open), or only the ranges and days set here. */
export default function AvailabilityForm({ coordinator }: { coordinator: Coordinator }) {
  const { mutate, settings } = useData();
  const [limited, setLimited] = useState(Boolean(coordinator.availability));
  const [draft, setDraft] = useState<Availability>(coordinator.availability ?? NONE);

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (limited && !draft.weeklyRules.length) return toast.error('Switch on at least one day, or choose "Whenever a service is open"');
    const bad = limited && badDay(draft.weeklyRules);
    if (bad) return toast.error(`${bad}: each range must end after it starts and ranges cannot overlap`);
    mutate('/api/coordinators', 'PUT', { coordinatorId: coordinator.id, availability: limited ? draft : null }, 'Hours saved');
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-2">
        <label className="flex items-start gap-2">
          <input type="radio" name="hours" className="mt-1" checked={!limited} onChange={() => setLimited(false)} />
          <span><b>Whenever a service is open</b><span className="block text-ink-2">No personal limit. Only one session at a time.</span></span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="hours" className="mt-1" checked={limited} onChange={() => setLimited(true)} />
          <span><b>Only during these hours</b><span className="block text-ink-2">Clients can be booked with this coordinator only inside the hours below.</span></span>
        </label>
      </div>
      {limited && (
        <>
          <div>
            <h3 className="mb-1 font-semibold">Weekly hours</h3>
            <p className="mb-3 text-ink-2">In {settings.timezone.label} ({settings.timezone.offset}). Add a second range for a lunch break.</p>
            <WeeklyHours rules={draft.weeklyRules} onChange={(weeklyRules) => setDraft({ ...draft, weeklyRules })} />
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Days off</h3>
            <p className="mb-3 text-ink-2">Block a date (leave, a holiday), or give it different hours.</p>
            <DateOverrides overrides={draft.dateOverrides} onChange={(dateOverrides) => setDraft({ ...draft, dateOverrides })} />
          </div>
        </>
      )}
      <button className="btn btn-primary">Save hours</button>
    </form>
  );
}
