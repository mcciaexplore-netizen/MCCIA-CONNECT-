import { useState, type FormEvent } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import { WORKSHOP_KIND_LABELS, WORKSHOP_KINDS, WORKSHOP_STATUS_LABELS, WORKSHOP_STATUSES, type Workshop } from '../../types';
import Modal from '../ui/Modal';

const blank = { kind: 'workshop', title: '', heldOn: '', startTime: '', endTime: '', mode: 'offline', venue: '', trainer: '', organisation: '', participants: '', status: 'scheduled', notes: '' };

/** Adds a workshop or mini session (its W- / M- number comes from the server), or edits one. The type cannot change later: it is the number's series. */
export default function WorkshopForm({ workshop, onClose }: { workshop?: Workshop; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState(() =>
    workshop ? Object.fromEntries(Object.entries(blank).map(([key, fallback]) => [key, String(workshop[key as keyof Workshop] ?? fallback)])) as typeof blank : blank,
  );
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setValue({ ...value, [key]: e.target.value });
  const field = (key: keyof typeof blank, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`ws-${key}`}>{label}</label>
      <input id={`ws-${key}`} className="input" value={value[key]} onChange={set(key)} {...props} />
    </div>
  );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate<Workshop>('/api/workshops', workshop ? 'PATCH' : 'POST', { ...value, id: workshop?.id }, workshop ? 'Workshop saved' : undefined);
    setSaving(false);
    if (saved && !workshop) toast.success(`${saved.ticketNumber} created`);
    if (saved) onClose();
  };

  return (
    <Modal title={workshop ? `Edit ${workshop.ticketNumber}` : 'Add workshop'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="ws-kind">Type *</label>
            <select id="ws-kind" className="input" value={value.kind} onChange={set('kind')} disabled={Boolean(workshop)}>
              {WORKSHOP_KINDS.map((k) => <option key={k} value={k}>{WORKSHOP_KIND_LABELS[k]} ({k === 'workshop' ? 'W' : 'M'}-…)</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">{field('title', 'Title *', { required: true, placeholder: 'e.g. AI for MSMEs' })}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field('heldOn', 'Date *', { type: 'date', required: true })}
          {field('startTime', 'Start time', { type: 'time' })}
          {field('endTime', 'End time', { type: 'time' })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="ws-mode">Mode</label>
            <select id="ws-mode" className="input" value={value.mode} onChange={set('mode')}>
              <option value="offline">Offline</option>
              <option value="online">Online</option>
            </select>
          </div>
          <div className="sm:col-span-2">{field('venue', value.mode === 'online' ? 'Meeting link' : 'Venue')}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field('trainer', 'Trainer / speaker')}
          {field('organisation', 'Organisation / host')}
          {field('participants', 'Participants', { type: 'number', min: 0 })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="ws-status">Status</label>
            <select id="ws-status" className="input" value={value.status} onChange={set('status')}>
              {WORKSHOP_STATUSES.map((s) => <option key={s} value={s}>{WORKSHOP_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ws-notes">Notes</label>
            <textarea id="ws-notes" className="input min-h-[34px]" value={value.notes} onChange={set('notes')} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{workshop ? 'Save' : 'Add workshop'}</button>
        </div>
      </form>
    </Modal>
  );
}
