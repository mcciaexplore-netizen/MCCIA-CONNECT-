import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import type { Application } from '../../types';
import Modal from '../ui/Modal';

/** Adds an application link, or edits one (admins). */
export default function ApplicationForm({ application, onClose }: { application?: Application; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState({ name: application?.name ?? '', url: application?.url ?? '', description: application?.description ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof value) => (e: { target: { value: string } }) => setValue({ ...value, [key]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate('/api/applications', application ? 'PATCH' : 'POST', { ...value, id: application?.id }, application ? 'Application saved' : 'Application added');
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal title={application ? `Edit ${application.name}` : 'Add application'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="app-name">Name *</label>
          <input id="app-name" className="input" required value={value.name} onChange={set('name')} placeholder="e.g. MCCIA App Hub" />
        </div>
        <div>
          <label className="label" htmlFor="app-url">Link *</label>
          <input id="app-url" className="input" required value={value.url} onChange={set('url')} placeholder="https://…" />
        </div>
        <div>
          <label className="label" htmlFor="app-description">Description</label>
          <textarea id="app-description" className="input min-h-24" value={value.description} onChange={set('description')} placeholder="What it is for and who uses it" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{application ? 'Save' : 'Add application'}</button>
        </div>
      </form>
    </Modal>
  );
}
