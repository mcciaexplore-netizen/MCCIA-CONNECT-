import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { MIN_REASON_LENGTH } from '../../types';
import Avatar from './Avatar';
import Modal from './Modal';

interface Props {
  currentId: string | null; // the coordinator being replaced, if any
  /** A coordinator belongs to a whole company: say so, because every client from it moves. */
  company?: { name: string; clients: number };
  /** Does the assign/reassign (a PATCH to a ticket, a PUT to a client). Resolves to something truthy on success. */
  onConfirm: (coordinatorId: string, reason: string) => Promise<unknown>;
  onClose: () => void;
}

/** Assign (no coordinator yet) or reassign (a reason of 20+ characters is required). Used for tickets and clients. */
export default function ReassignModal({ currentId, company, onConfirm, onClose }: Props) {
  const { coordinators, getCoordinator } = useData();
  const current = getCoordinator(currentId);
  const [coordinatorId, setCoordinatorId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = Boolean(coordinatorId) && (!current || reason.trim().length >= MIN_REASON_LENGTH);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const done = await onConfirm(coordinatorId, reason.trim());
    setSaving(false);
    if (done) onClose();
  };

  return (
    <Modal title={current ? 'Reassign coordinator' : 'Assign coordinator'} onClose={onClose}>
      <form onSubmit={confirm} className="space-y-4">
        {company && (
          <p role="alert" className="rounded-md border border-gold bg-gold-light px-3 py-2 text-[#8a6d1c]">
            This will reassign all clients from {company.name}{company.clients > 1 ? ` (${company.clients} clients)` : ''}. Are you sure?
          </p>
        )}
        <div>
          <p className="label">Current coordinator</p>
          {current ? (
            <span className="inline-flex items-center gap-2"><Avatar name={current.name} color={current.color} size="sm" />{current.name}</span>
          ) : (
            <span className="text-ink-3">Unassigned</span>
          )}
        </div>
        <div>
          <label className="label">New coordinator *</label>
          <select className="input" required value={coordinatorId} onChange={(e) => setCoordinatorId(e.target.value)}>
            <option value="">Select…</option>
            {coordinators.filter((c) => c.isActive && c.id !== currentId).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {current && (
          <div>
            <label className="label">Reason for reassigning * (at least {MIN_REASON_LENGTH} characters)</label>
            <textarea className="input" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="mt-1 text-xs text-ink-3">{reason.trim().length}/{MIN_REASON_LENGTH}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || saving}>{saving ? 'Saving…' : 'Confirm'}</button>
        </div>
      </form>
    </Modal>
  );
}
