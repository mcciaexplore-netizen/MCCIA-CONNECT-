import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { kindOfCode, WORKSHOP_CODE, WORKSHOP_KIND_LABELS, WORKSHOP_STATUS_LABELS, WORKSHOP_STATUSES, type Workshop } from '../../types';
import Modal from '../ui/Modal';

const blank = { code: '', title: '', heldOn: '', startTime: '', endTime: '', mode: 'offline', venue: '', trainer: '', organisation: '', status: 'scheduled', notes: '' };

/** Adds a workshop (its Workshop ID: W-… for a Workshop, M-… for a Mini Session) or edits one. */
export default function WorkshopForm({ workshop, onClose }: { workshop?: Workshop; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState(() =>
    workshop ? (Object.fromEntries(Object.entries(blank).map(([key, fallback]) => [key, String(workshop[key as keyof Workshop] ?? fallback)])) as typeof blank) : blank,
  );
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) => setValue({ ...value, [key]: e.target.value });
  const field = (key: keyof typeof blank, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`ws-${key}`}>{label}</label>
      <input id={`ws-${key}`} className="input" value={value[key]} onChange={set(key)} {...props} />
    </div>
  );
  const codeOk = WORKSHOP_CODE.test(value.code.trim());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate('/api/workshops', workshop ? 'PATCH' : 'POST', { ...value, id: workshop?.id }, workshop ? 'Workshop saved' : `${value.code.trim()} added`);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal title={workshop ? `Edit ${workshop.code}` : 'Add workshop'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            {field('code', 'Workshop ID *', { required: true, placeholder: 'W-0001 or M-0001' })}
            <p className="mt-1 text-xs text-ink-3">{codeOk ? WORKSHOP_KIND_LABELS[kindOfCode(value.code)] : 'Starts with W (Workshop, Major) or M (Mini Session), e.g. W21 or M-01'}</p>
          </div>
          <div className="sm:col-span-2">{field('title', 'Workshop name', { placeholder: 'e.g. AI for MSMEs' })}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field('heldOn', 'Date', { type: 'date' })}
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
          <div>
            <label className="label" htmlFor="ws-status">Status</label>
            <select id="ws-status" className="input" value={value.status} onChange={set('status')}>
              {WORKSHOP_STATUSES.map((s) => <option key={s} value={s}>{WORKSHOP_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ws-notes">Notes</label>
          <textarea id="ws-notes" className="input min-h-16" value={value.notes} onChange={set('notes')} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving || !codeOk}>{workshop ? 'Save' : 'Add workshop'}</button>
        </div>
      </form>
    </Modal>
  );
}
