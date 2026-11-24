import { useState } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { usePageData, useData } from '../../context/DataContext';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import SelectionBar from '../../components/ui/SelectionBar';
import { useBulk } from '../../lib/useBulk';
import { confirmDeleteCompanies, formatDate } from '../../lib/utils';
import type { CompanyRow } from '../../types';

/** Every company with its coordinator and its numbers. A company's clients all share its coordinator; click one to see them. */
export default function Companies() {
  const { companies, getCoordinator, mutate } = useData();
  const page = usePageData('companies');
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);

  const query = search.trim().toLowerCase();
  const rows = companies.filter((c) => !query || c.name.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);
  const bulk = useBulk(rows, shown, 50);

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

  const removeSelected = async () => {
    const chosen = companies.filter((c) => bulk.ids.includes(c.id));
    if (!confirmDeleteCompanies(chosen.length, chosen.reduce((n, c) => n + c.clientCount, 0), chosen.reduce((n, c) => n + c.bookingCount, 0))) return;
    const results = await bulk.eachChunk((chunk) => mutate<{ companyIds: string[] }>('/api/clients', 'DELETE', { companyIds: chunk }));
    const deleted = results.reduce((n, r) => n + r.companyIds.length, 0);
    if (deleted) toast.success(`${deleted} ${deleted === 1 ? 'company' : 'companies'} deleted`);
    bulk.clear();
  };

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Companies</h1>
          <p className="page-sub">{companies.length} companies. Everyone from a company shares its coordinator.</p>
        </div>
      </div>
      <input className="input mb-4 max-w-xs" placeholder="Search company…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); bulk.clear(); }} />
      {bulk.ids.length > 0 && (
        <SelectionBar count={bulk.ids.length} noun="companies" allMatching={bulk.allMatching} total={rows.length} canSelectAll={bulk.canSelectAll} onSelectAll={bulk.selectAll}>
          <button className="btn btn-danger" onClick={removeSelected}>Delete</button>
        </SelectionBar>
      )}
      <DataTable key={bulk.tableKey} selectable onSelectionChange={bulk.onSelectionChange} columns={columns} data={shown} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/companies/${c.id}`)} empty="No companies found." emptyIcon="users" />
      <Pager total={rows.length} page={pageNo} onPage={(next) => { setPageNo(next); bulk.clear(); }} />
    </div>
  );
}
