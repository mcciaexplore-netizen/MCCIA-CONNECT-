import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { formatDateTime } from '../../lib/utils';
import type { Booking, Ticket } from '../../types';
import Modal from '../ui/Modal';
import SlotPicker from '../ui/SlotPicker';

/** Move a session to another open time of the same module and mode. The client and the coordinator are emailed and the calendar event is replaced. */
export default function RescheduleModal({ ticket, booking, onClose }: { ticket: Ticket; booking: Booking; onClose: () => void }) {
  const { getModule, settings, mutate } = useData();
  const module = getModule(ticket.moduleId);
  const [startsAt, setStartsAt] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const done = await mutate(`/api/bookings/${booking.id}/reschedule`, 'POST', { newStartTime: startsAt, reason }, 'Session rescheduled');
    setSaving(false);
    if (done) onClose();
    else setStartsAt(''); // the time may have just been taken
  };

  return (
    <Modal title="Reschedule session" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-ink-2">Now: <span className="font-medium text-ink">{formatDateTime(booking.startTime)}</span> ({booking.mode}). Pick a new time; the client and the coordinator are emailed.</p>
        {module && <SlotPicker slug={module.slug} venue={settings.venue.address} mode={booking.mode} onModeChange={() => {}} startsAt={startsAt} onSelect={setStartsAt} lockMode />}
        <div>
          <label className="label">Reason *</label>
          <textarea className="input" rows={3} required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!startsAt || !reason.trim() || saving}>{saving ? 'Rescheduling…' : 'Reschedule'}</button>
        </div>
      </form>
    </Modal>
  );
}
