import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { PARTICIPANT_SUGGESTIONS, type Participant } from '../../types';
import Modal from '../ui/Modal';

/** The workshop sheet's columns, in its order (Workshop ID is the page the person is on). */
const FIELDS: { key: Exclude<keyof Participant, 'id' | 'workshopId' | 'createdAt' | 'updatedAt'>; label: string; type?: string }[] = [
  { key: 'companyName', label: 'Company Name' },
  { key: 'udyamNo', label: 'UDYAM No' },
  { key: 'personName', label: 'Name *' },
  { key: 'phone', label: 'Tel. / Mobile', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'designation', label: 'Designation' },
  { key: 'mode', label: 'Mode' },
  { key: 'month', label: 'Month' },
  { key: 'sessionDate', label: 'Date', type: 'date' },
  { key: 'timeSlot', label: 'Time Slot' },
  { key: 'confirmationStatus', label: 'Confirmation Status' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'deploymentStatus', label: 'Deployment Status' },
  { key: 'allocation', label: 'Allocation' },
  { key: 'consStatus', label: 'Cons-Status' },
  { key: 'calling', label: 'Calling' },
];
type Key = (typeof FIELDS)[number]['key'];

/** Adds a participant to a workshop, or edits one. The status columns take any text; the usual answers are offered. */
export default function ParticipantForm({ workshopId, participant, onClose }: { workshopId: string; participant?: Participant; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState(() => Object.fromEntries(FIELDS.map(({ key }) => [key, participant?.[key] ?? ''])) as Record<Key, string>);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate('/api/participants', participant ? 'PATCH' : 'POST', { ...value, id: participant?.id, workshopId }, participant ? 'Participant saved' : 'Participant added');
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal title={participant ? `Edit ${participant.personName}` : 'Add participant'} onClose={onClose} wide>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FIELDS.map(({ key, label, type }) => {
            const options = PARTICIPANT_SUGGESTIONS[key as keyof typeof PARTICIPANT_SUGGESTIONS];
            return (
              <div key={key}>
                <label className="label" htmlFor={`p-${key}`}>{label}</label>
                <input id={`p-${key}`} className="input" type={type ?? 'text'} required={key === 'personName'} list={options && `p-${key}-list`} value={value[key]} onChange={(e) => setValue({ ...value, [key]: e.target.value })} />
                {options && <datalist id={`p-${key}-list`}>{options.map((o) => <option key={o} value={o} />)}</datalist>}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{participant ? 'Save' : 'Add participant'}</button>
        </div>
      </form>
    </Modal>
  );
}
