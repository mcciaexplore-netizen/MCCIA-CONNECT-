import { useState } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import Avatar from '../../components/ui/Avatar';
import DataTable, { type Column } from '../../components/ui/DataTable';
import { formatDate } from '../../lib/utils';
import type { Client } from '../../types';

/** The clients assigned to this coordinator (the API only returns those). Click a row for the read-only profile. */
export default function MyClients() {
  const { clients, tickets, sessions } = useData();
  const page = usePageData('clients', 'tickets', 'bookings');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Each client's latest session that has already started.
  const now = new Date();
  const lastSession = new Map<string, string>();
  for (const { booking, ticket } of sessions) {
    if (booking.status !== 'cancelled' && new Date(booking.startTime) <= now) lastSession.set(ticket.clientId, booking.startTime);
  }

  const query = search.trim().toLowerCase();
  const rows = clients.filter((c) => !query || `${c.companyName} ${c.personName} ${c.phone} ${c.industry}`.toLowerCase().includes(query));

  const columns: Column<Client>[] = [
    { header: 'Company', cell: (c) => c.companyName },
    { header: 'Person', cell: (c) => <span className="inline-flex items-center gap-2"><Avatar name={c.personName} size="sm" />{c.personName}</span> },
    { header: 'Phone', cell: (c) => c.phone },
    { header: 'Industry', cell: (c) => c.industry ?? '—' },
    { header: 'Member', cell: (c) => (c.isMember ? 'Yes' : 'No') },
    { header: 'Total Tickets', cell: (c) => tickets.filter((t) => t.clientId === c.id).length },
    { header: 'Last Session', cell: (c) => (lastSession.has(c.id) ? formatDate(lastSession.get(c.id)!) : '—') },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Clients ({clients.length})</h1>
          <p className="page-sub">Clients assigned to you.</p>
        </div>
      </div>
      <input className="input mb-3 max-w-xs" placeholder="Search company, person, phone, industry…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <DataTable columns={columns} data={rows} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/coordinator/clients/${c.id}`)} empty={query ? 'No clients match your search.' : 'No clients assigned to you yet.'} emptyIcon="users" emptyAction={query ? { label: 'Clear search', onClick: () => setSearch('') } : undefined} />
    </div>
  );
}
