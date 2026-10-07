import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import Avatar from '../../components/ui/Avatar';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import { formatDate } from '../../lib/utils';
import type { Client } from '../../types';

/** The clients assigned to this coordinator (the API only returns those). Click a row for the read-only profile. */
export default function MyClients() {
  const { clients, tickets, sessions } = useData();
  const page = usePageData('clients', 'tickets', 'bookings');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const ticketCounts = useMemo(() => {
    const counts = new Map<string, number>(); // counted once for everyone, not once per row
    for (const t of tickets) counts.set(t.clientId, (counts.get(t.clientId) ?? 0) + 1);
    return counts;
  }, [tickets]);

  // Each client's latest session that has already started.
  const now = new Date();
  const lastSession = new Map<string, string>();
  for (const { booking, ticket } of sessions) {
    if (booking.status !== 'cancelled' && new Date(booking.startTime) <= now) lastSession.set(ticket.clientId, booking.startTime);
  }

  const query = search.trim().toLowerCase();
  const rows = clients.filter((c) => !query || `${c.companyName} ${c.personName} ${c.phone} ${c.industry}`.toLowerCase().includes(query));

  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<Client>[] = [
    { header: 'Company', cell: (c) => c.companyName },
    { header: 'Person', cell: (c) => <span className="inline-flex items-center gap-2"><Avatar name={c.personName} size="sm" />{c.personName}</span> },
    { header: 'Phone', cell: (c) => c.phone },
    { header: 'Sector', cell: (c) => c.industry ?? '—' },
    { header: 'Member', cell: (c) => (c.isMember ? 'Yes' : 'No') },
    { header: 'Total Tickets', cell: (c) => ticketCounts.get(c.id) ?? 0 },
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
      <input className="input mb-3 max-w-xs" placeholder="Search company, person, phone, sector…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      <DataTable columns={columns} data={shown} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/coordinator/clients/${c.id}`)} empty={query ? 'No clients match your search.' : 'No clients assigned to you yet.'} emptyIcon="users" emptyAction={query ? { label: 'Clear search', onClick: () => setSearch('') } : undefined} />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
    </div>
  );
}
