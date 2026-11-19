import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import type { Applet } from '../../types';
import Modal from '../ui/Modal';

const FIELDS = ['companyName', 'membership', 'membershipNo', 'contactName', 'phone', 'email', 'appletName', 'liveLink', 'deployedOn', 'notes'] as const;

/** Adds a deployed applet, or edits one: company, membership, contact (name, phone, email), applet name, live link, date deployed, notes. */
export default function AppletForm({ applet, onClose }: { applet?: Applet; onClose: () => void }) {
  const { mutate } = useData();
  const [value, setValue] = useState(() => Object.fromEntries(FIELDS.map((key) => [key, applet?.[key] ?? ''])) as Record<(typeof FIELDS)[number], string>);
  const [saving, setSaving] = useState(false);
  const field = (key: (typeof FIELDS)[number], label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`applet-${key}`}>{label}</label>
      <input id={`applet-${key}`} className="input" value={value[key]} onChange={(e) => setValue({ ...value, [key]: e.target.value })} {...props} />
    </div>
  );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const saved = await mutate('/api/applets', applet ? 'PATCH' : 'POST', { ...value, id: applet?.id }, applet ? 'Applet saved' : 'Applet added');
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <Modal title={applet ? `Edit ${applet.appletName || applet.companyName}` : 'Add applet'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {field('companyName', 'Company *', { required: true })}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="applet-membership">Membership</label>
            <select id="applet-membership" className="input" value={value.membership} onChange={(e) => setValue({ ...value, membership: e.target.value })}>
              <option value="">—</option>
              {['Member', 'Non Member'].concat(value.membership && !['Member', 'Non Member'].includes(value.membership) ? [value.membership] : []).map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          {field('membershipNo', 'Membership ID', { placeholder: 'e.g. IA-14984' })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {field('contactName', 'Contact person')}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('email', 'Email')}
        </div>
        {field('appletName', 'Applet name', { placeholder: 'e.g. Quotation generator' })}
        <div className="grid gap-4 sm:grid-cols-2">
          {field('liveLink', 'Live link', { placeholder: 'https://…' })}
          {field('deployedOn', 'Deployed on', { type: 'date' })}
        </div>
        <div>
          <label className="label" htmlFor="applet-notes">Notes</label>
          <textarea id="applet-notes" className="input min-h-20" value={value.notes} onChange={(e) => setValue({ ...value, notes: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{applet ? 'Save' : 'Add applet'}</button>
        </div>
      </form>
    </Modal>
  );
}
