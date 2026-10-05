import { useState, type FormEvent } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import CoordinatorPanel from '../../components/coordinator/CoordinatorPanel';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import { cn, isOpen } from '../../lib/utils';
import type { Coordinator } from '../../types';

const BLANK = { name: '', email: '', phone: '', color: '#0157b3', password: '' };

function AddCoordinator({ onClose }: { onClose: () => void }) {
  const { mutate } = useData();
  const [form, setForm] = useState(BLANK);
  const set = (patch: Partial<typeof BLANK>) => setForm({ ...form, ...patch });

  const add = async (e: FormEvent) => {
    e.preventDefault();
    // Creates their login (a users row with the coordinator role) and the coordinator record.
    if (await mutate('/api/coordinators', 'POST', form, 'Coordinator added')) onClose();
  };

  return (
    <Modal title="Add coordinator" onClose={onClose}>
      <form onSubmit={add} className="grid gap-4 sm:grid-cols-2">
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
          <label className="label">Temporary password * (min 8 characters)</label>
          <input className="input" type="password" minLength={8} required value={form.password} onChange={(e) => set({ password: e.target.value })} />
        </div>
        <div>
          <label className="label">Colour</label>
          <input className="h-9 w-20 cursor-pointer rounded-md border border-line-strong bg-white p-1" type="color" value={form.color} onChange={(e) => set({ color: e.target.value })} />
        </div>
        <div className="flex items-end justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Add coordinator</button>
        </div>
      </form>
    </Modal>
  );
}

export default function Coordinators() {
  const { coordinators, tickets, clients } = useData();
  const page = usePageData('tickets', 'clients', 'bookings');
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const selected = coordinators.find((c) => c.id === selectedId);

  const columns: Column<Coordinator>[] = [
    { header: '', cell: (c) => <Avatar name={c.name} color={c.color} size="sm" />, className: 'w-10' },
    { header: 'Name', cell: (c) => <span className="font-medium">{c.name}</span> },
    { header: 'Email', cell: (c) => c.email },
    { header: 'Phone', cell: (c) => c.phone || '—' },
    { header: 'Active Clients', cell: (c) => clients.filter((client) => client.assignedCoordinatorId === c.id).length },
    { header: 'Open Tickets', cell: (c) => tickets.filter((t) => t.coordinatorId === c.id && isOpen(t.status)).length },
    { header: 'Completed', cell: (c) => tickets.filter((t) => t.coordinatorId === c.id && t.status === 'completed').length },
    {
      header: 'Status',
      cell: (c) => <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', c.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-ink-2')}>{c.isActive ? 'Active' : 'Inactive'}</span>,
    },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Coordinators</h1>
          <p className="page-sub">Staff who run sessions and handle tickets. Click a row for their numbers.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add Coordinator</button>
      </div>

      <DataTable columns={columns} data={coordinators} rowKey={(c) => c.id} onRowClick={(c) => setSelectedId(c.id)} empty="No coordinators yet." emptyIcon="user-group" emptyAction={{ label: '+ Add Coordinator', onClick: () => setAdding(true) }} />

      {adding && <AddCoordinator onClose={() => setAdding(false)} />}
      {selected && <CoordinatorPanel coordinator={selected} onClose={() => setSelectedId('')} />}
    </div>
  );
}
