import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import type { AppletRow } from '../../types';
import Modal from '../ui/Modal';

/** The deployment details of one completed Applet Setup ticket: applet name, live link, date deployed, notes. */
export default function AppletForm({ applet, onClose }: { applet: AppletRow; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState({ appletName: applet.appletName ?? '', liveLink: applet.liveLink ?? '', deployedOn: applet.deployedOn ?? '', notes: applet.notes ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof value) => (e: { target: { value: string } }) => setValue({ ...value, [key]: e.target.value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate('/api/applets', 'PUT', { ticketId: applet.ticketId, ...value }, 'Deployment details saved');
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal title={`${applet.companyName} · ${applet.ticketNumber}`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="label" htmlFor="applet-name">Applet name</label>
          <input id="applet-name" className="input" value={value.appletName} onChange={set('appletName')} placeholder="e.g. Quotation generator" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="applet-link">Live link</label>
            <input id="applet-link" className="input" value={value.liveLink} onChange={set('liveLink')} placeholder="https://…" />
          </div>
          <div>
            <label className="label" htmlFor="applet-date">Deployed on</label>
            <input id="applet-date" className="input" type="date" value={value.deployedOn} onChange={set('deployedOn')} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="applet-notes">Notes</label>
          <textarea id="applet-notes" className="input min-h-20" value={value.notes} onChange={set('notes')} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
