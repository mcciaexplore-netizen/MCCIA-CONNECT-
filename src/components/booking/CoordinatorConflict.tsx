import { useState } from 'react';
import type { BookingConflict } from '../../types';

interface Props {
  conflict: BookingConflict;
  busy: boolean;
  onBook: (coordinatorId: string) => void;
  onOtherTime: () => void;
}

/** Shown on the confirm step when the client's own coordinator is busy then: book with someone who is free (this once), or pick another time. */
export default function CoordinatorConflict({ conflict, busy, onBook, onOtherTime }: Props) {
  const { assignedCoordinator, availableCoordinators: free } = conflict;
  const [pick, setPick] = useState(free[0]?.id ?? '');
  const chosen = free.find((c) => c.id === pick) ?? free[0];

  return (
    <div role="alert" className="space-y-3 rounded-md border border-gold bg-gold-light p-4 text-[#8a6d1c]">
      <p className="font-medium">{assignedCoordinator.name} is unavailable at this time slot.</p>
      {free.length > 1 && (
        <div>
          <label htmlFor="other-coordinator" className="label">Book with</label>
          <select id="other-coordinator" className="input" value={chosen?.id} onChange={(e) => setPick(e.target.value)}>
            {free.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
      {chosen && <p className="text-xs">This is for this booking only. {assignedCoordinator.name} stays your coordinator.</p>}
      <div className="flex flex-wrap gap-3">
        {chosen && <button className="btn btn-primary h-11" disabled={busy} onClick={() => onBook(chosen.id)}>{busy ? 'Booking…' : `Book with ${chosen.name}`}</button>}
        <button className="btn h-11 bg-white" disabled={busy} onClick={onOtherTime}>Choose a different time</button>
      </div>
      {!chosen && <p className="text-xs">No other coordinator is free at this time.</p>}
    </div>
  );
}
