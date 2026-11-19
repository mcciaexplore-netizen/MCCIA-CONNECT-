import type { ReactNode } from 'react';
import { formatDate } from '../../lib/utils';
import type { Applet } from '../../types';
import Modal from '../ui/Modal';

const dash = <span className="text-ink-3">—</span>;
/** "a; b; c" (several contacts in one cell, as the studio writes them) as one line each. */
const list = (value: string | null, render: (v: string) => ReactNode = (v) => v) => {
  const items = (value ?? '').split(';').map((v) => v.trim()).filter(Boolean);
  return items.length ? <ul className="space-y-0.5">{items.map((v, i) => <li key={i}>{render(v)}</li>)}</ul> : dash;
};

function Item({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-1 break-words text-[14px]">{children}</dd>
    </div>
  );
}

/** Everything kept about one applet, read only, with Edit. */
export default function AppletDetail({ applet: a, onEdit, onClose }: { applet: Applet; onEdit: () => void; onClose: () => void }) {
  return (
    <Modal title={a.companyName} onClose={onClose} wide>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Item label="Company" full><span className="font-medium">{a.companyName}</span></Item>
        <Item label="Membership">{a.membership || dash}</Item>
        <Item label="Membership ID">{a.membershipNo || dash}</Item>
        <Item label="Contact person">{list(a.contactName)}</Item>
        <Item label="Phone">{list(a.phone, (v) => <a className="text-primary hover:underline" href={`tel:${v.replace(/\s/g, '')}`}>{v}</a>)}</Item>
        <Item label="Email" full>{list(a.email, (v) => <a className="text-primary hover:underline" href={`mailto:${v}`}>{v}</a>)}</Item>
        <Item label="Applet name">{a.appletName || dash}</Item>
        <Item label="Deployed on">{a.deployedOn ? formatDate(`${a.deployedOn}T12:00:00Z`) : dash}</Item>
        <Item label="Live link" full>{a.liveLink ? <a className="text-primary hover:underline" href={a.liveLink} target="_blank" rel="noreferrer">{a.liveLink}</a> : dash}</Item>
        <Item label="Notes" full>{a.notes ? <span className="whitespace-pre-wrap">{a.notes}</span> : dash}</Item>
      </dl>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={onEdit}>Edit</button>
      </div>
    </Modal>
  );
}
