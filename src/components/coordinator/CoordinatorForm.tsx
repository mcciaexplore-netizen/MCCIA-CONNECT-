import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import Modal from '../ui/Modal';
import { MIN_PASSWORD_LENGTH, type Coordinator } from '../../types';

const BLANK = { name: '', email: '', phone: '', color: '#0157b3', password: '' };

/**
 * Add a coordinator, or (given one) edit them: name, email (their login), phone, colour and a new password.
 * Adding creates the login as well; when editing, an empty password keeps the current one.
 */
export default function CoordinatorForm({ coordinator, onClose }: { coordinator?: Coordinator; onClose: () => void }) {
  const { mutate } = useData();
  const start = coordinator ? { name: coordinator.name, email: coordinator.email, phone: coordinator.phone ?? '', color: coordinator.color, password: '' } : BLANK;
  const [form, setForm] = useState(start);
  const [show, setShow] = useState(false);
  const set = (patch: Partial<typeof BLANK>) => setForm({ ...form, ...patch });
  const changed = !coordinator || JSON.stringify(form) !== JSON.stringify(start);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const done = coordinator ? await mutate('/api/coordinators', 'PATCH', { id: coordinator.id, ...form }, 'Coordinator updated') : await mutate('/api/coordinators', 'POST', form, 'Coordinator added');
    if (done) onClose();
  };

  return (
    <Modal title={coordinator ? 'Edit coordinator' : 'Add coordinator'} onClose={onClose}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Name *</label>
          <input className="input" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <label className="label">Email (login) *</label>
          <input className="input" type="email" required value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </div>
        <div>
          <label className="label">{coordinator ? 'New password (empty keeps the current one)' : `Temporary password * (min ${MIN_PASSWORD_LENGTH} characters)`}</label>
          <div className="flex gap-2">
            <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required={!coordinator} value={form.password} onChange={(e) => set({ password: e.target.value })} />
            <button type="button" className="btn shrink-0" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <div>
          <label className="label">Colour</label>
          <input className="h-9 w-20 cursor-pointer rounded-md border border-line-strong bg-white p-1" type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!changed}>{coordinator ? 'Save changes' : 'Add coordinator'}</button>
        </div>
      </form>
    </Modal>
  );
}
