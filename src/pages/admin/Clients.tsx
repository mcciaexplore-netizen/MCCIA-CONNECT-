import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import Avatar from '../../components/ui/Avatar';
import ClientFields from '../../components/ui/ClientFields';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import { formatDate } from '../../lib/utils';
import { BLANK_CLIENT, type Client } from '../../types';

export default function Clients() {
  const { clients, tickets, getCoordinator, mutate } = useData();
  const page = usePageData('clients', 'tickets');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>(); // counted once for everyone, not once per row
    for (const t of tickets) counts.set(t.clientId, (counts.get(t.clientId) ?? 0) + 1);
    return counts;
  }, [tickets]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(BLANK_CLIENT);

  const query = search.trim().toLowerCase();
  const rows = clients.filter((c) => !query || `${c.companyName} ${c.personName} ${c.email} ${c.phone}`.toLowerCase().includes(query));

  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<Client>[] = [
    {
      header: 'Contact',
      cell: (c) => (
        <div className="flex items-center gap-2">
          <Avatar name={c.personName} size="sm" />
          <div>
            <p className="font-medium">{c.personName}</p>
            <p className="text-xs text-ink-2">{c.jobTitle}</p>
          </div>
        </div>
      ),
    },
    { header: 'Company', cell: (c) => c.companyName },
    { header: 'Email', cell: (c) => c.email },
    { header: 'Phone', cell: (c) => c.phone },
    { header: 'Coordinator', cell: (c) => getCoordinator(c.assignedCoordinatorId)?.name ?? <span className="text-ink-3">Unassigned</span> },
    { header: 'Tickets', cell: (c) => ticketCounts.get(c.id) ?? 0 },
    { header: 'Added', cell: (c) => formatDate(c.createdAt) },
  ];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate('/api/clients', 'POST', { client: form }, 'Client added')) {
      setForm(BLANK_CLIENT);
      setAdding(false);
    }
  };

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="page-sub">{clients.length} clients</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add client'}</button>
      </div>

      {adding && (
        <form onSubmit={add} className="card mb-6 space-y-4">
          <ClientFields value={form} onChange={setForm} />
          <button className="btn btn-primary">Save client</button>
        </form>
      )}

      <input className="input mb-4 max-w-xs" placeholder="Search company, contact, email…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />

      <DataTable columns={columns} data={shown} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/clients/${c.id}`)} onEdit={(c) => navigate(`/admin/clients/${c.id}`)} empty="No clients found." emptyIcon="users" emptyAction={clients.length === 0 ? { label: 'Add client', onClick: () => setAdding(true) } : query ? { label: 'Clear search', onClick: () => setSearch('') } : undefined} />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
    </div>
  );
}
