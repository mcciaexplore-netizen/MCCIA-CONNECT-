import { useState } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import CoordinatorForm from '../../components/coordinator/CoordinatorForm';
import CoordinatorPanel from '../../components/coordinator/CoordinatorPanel';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import { cn, isOpen } from '../../lib/utils';
import type { Coordinator } from '../../types';

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

      {adding && <CoordinatorForm onClose={() => setAdding(false)} />}
      {selected && <CoordinatorPanel coordinator={selected} onClose={() => setSelectedId('')} />}
    </div>
  );
}
