import { useState } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import { formatDate } from '../../lib/utils';
import type { CompanyRow } from '../../types';

/** Every company with its coordinator and its numbers. A company's clients all share its coordinator; click one to see them. */
export default function Companies() {
  const { companies, getCoordinator } = useData();
  const page = usePageData('companies');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);

  const query = search.trim().toLowerCase();
  const rows = companies.filter((c) => !query || c.name.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<CompanyRow>[] = [
    { header: 'Company Name', cell: (c) => <span className="font-medium">{c.name}</span> },
    {
      header: 'Coordinator',
      cell: (c) => {
        const coordinator = getCoordinator(c.assignedCoordinatorId);
        return coordinator ? <span className="inline-flex items-center gap-2"><Avatar name={coordinator.name} color={coordinator.color} size="sm" />{coordinator.name}</span> : <span className="text-danger">Unassigned</span>;
      },
    },
    { header: 'Total Clients', cell: (c) => c.clientCount },
    { header: 'Total Bookings', cell: (c) => c.bookingCount },
    { header: 'Last Booking', cell: (c) => (c.lastBooking ? formatDate(c.lastBooking) : <span className="text-ink-3">—</span>) },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-sub">{companies.length} companies. Everyone from a company shares its coordinator.</p>
        </div>
      </div>
      <input className="input mb-4 max-w-xs" placeholder="Search company…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      <DataTable columns={columns} data={shown} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/companies/${c.id}`)} empty="No companies found." emptyIcon="users" />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
    </div>
  );
}
