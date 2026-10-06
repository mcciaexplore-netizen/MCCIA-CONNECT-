import type { DateOverride, WeeklyRule } from '../../types';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** The first day whose ranges end before they start or overlap, if any. */
export function badDay(rules: WeeklyRule[]) {
  for (const day of WEEK) {
    const ranges = rules.filter((r) => r.day === day).sort((a, b) => a.start.localeCompare(b.start));
    if (ranges.some((r, i) => r.end <= r.start || (i > 0 && r.start < ranges[i - 1].end))) return DAYS[day];
  }
}

/** Switch a weekday on and set its ranges (a second range makes a lunch break). Used for a service's hours and for a coordinator's own. */
export function WeeklyHours({ rules, onChange }: { rules: WeeklyRule[]; onChange: (rules: WeeklyRule[]) => void }) {
  const setRule = (index: number, patch: Partial<WeeklyRule>) => onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const addRange = (day: number, start = '10:00', end = '17:00') => onChange([...rules, { day, start, end }]);
  const toggleDay = (day: number, on: boolean) => (on ? addRange(day) : onChange(rules.filter((r) => r.day !== day)));

  return (
    <div className="divide-y divide-line">
      {WEEK.map((day) => {
        const ranges = rules.flatMap((rule, index) => (rule.day === day ? [{ rule, index }] : []));
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
                    <button type="button" aria-label={`Remove ${DAYS[day]} range`} className="btn btn-danger px-2" onClick={() => onChange(rules.filter((_, i) => i !== index))}>×</button>
                  </div>
                ))}
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => addRange(day, '14:00')}>+ Add range</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Blocked dates (a holiday, leave) or dates with different hours. An override replaces the weekly hours for that date. */
export function DateOverrides({ overrides, onChange }: { overrides: DateOverride[]; onChange: (overrides: DateOverride[]) => void }) {
  const setOverride = (index: number, patch: Partial<DateOverride>) => onChange(overrides.map((o, i) => (i === index ? { ...o, ...patch } : o)));

  return (
    <>
      <div className="space-y-2">
        {overrides.map((override, index) => (
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
            <button type="button" className="btn btn-danger" onClick={() => onChange(overrides.filter((_, i) => i !== index))}>Remove</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn mt-3" onClick={() => onChange([...overrides, { date: '', closed: true, start: '10:00', end: '17:00' }])}>+ Block a date</button>
    </>
  );
}
