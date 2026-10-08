import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import CompanyCard from '../../components/client/CompanyCard';
import Avatar from '../../components/ui/Avatar';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import ModePill from '../../components/ui/ModePill';
import ModuleBadge from '../../components/ui/ModuleBadge';
import Pager, { pageOf } from '../../components/ui/Pager';
import ReassignModal from '../../components/ui/ReassignModal';
import StatusBadge from '../../components/ui/StatusBadge';
import { formatDate, formatDateTime } from '../../lib/utils';
import type { Client, Ticket } from '../../types';

/**
 * /admin/companies/:companyId: one company, its coordinator (changing it moves every client), all the clients from it and every ticket it ever
 * had. Each booking is its own ticket with its own number; the company (its name) is what keeps them together.
 */
export default function CompanyDetail() {
  const { companyId } = useParams();
  const { companies, clients, tickets, getClient, getCoordinator, getModule, getSession, mutate } = useData();
  const page = usePageData('companies', 'clients', 'tickets', 'bookings');
  const navigate = useNavigate();
  const [reassigning, setReassigning] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  const company = companies.find((c) => c.id === companyId);
  if (!company) {
    return (
      <div className="card">
        <EmptyState icon="alert" message="Company not found" action={{ label: 'All companies', onClick: () => navigate('/admin/companies') }} />
      </div>
    );
  }

  const members = clients.filter((c) => c.companyId === company.id);
  const coordinator = getCoordinator(company.assignedCoordinatorId);
  // The company's tickets, the latest session first.
  const history = tickets
    .filter((t) => members.some((m) => m.id === t.clientId))
    .sort((a, b) => (getSession(b.id)?.booking.startTime ?? b.createdAt).localeCompare(getSession(a.id)?.booking.startTime ?? a.createdAt));
  const historyColumns: Column<Ticket>[] = [
    { header: 'Ticket ID', cell: (t) => t.ticketNumber, isId: true },
    { header: 'Session', cell: (t) => { const booking = getSession(t.id)?.booking; return booking ? formatDateTime(booking.startTime) : '—'; }, className: 'whitespace-nowrap' },
    { header: 'Module', cell: (t) => <ModuleBadge module={getModule(t.moduleId)} /> },
    { header: 'Mode', cell: (t) => { const mode = getSession(t.id)?.booking.mode; return mode ? <ModePill mode={mode} /> : '—'; } },
    { header: 'Client', cell: (t) => getClient(t.clientId)?.personName ?? '—' },
    {
      header: 'Coordinator',
      cell: (t) => {
        const c = getCoordinator(t.coordinatorId);
        return c ? <span className="inline-flex items-center gap-2"><Avatar name={c.name} color={c.color} size="sm" />{c.name}</span> : <span className="text-danger">Unassigned</span>;
      },
    },
    { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
  ];
  const columns: Column<Client>[] = [
    { header: 'Contact', cell: (c) => <span className="font-medium">{c.personName}<span className="block text-xs font-normal text-ink-2">{c.jobTitle}</span></span> },
    { header: 'Email', cell: (c) => c.email },
    { header: 'Phone', cell: (c) => c.phone },
    { header: 'Tickets', cell: (c) => tickets.filter((t) => t.clientId === c.id).length },
    { header: 'Added', cell: (c) => formatDate(c.createdAt) },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="text-xs text-ink-3"><Link to="/admin/companies" className="hover:underline">Companies</Link> ›</p>
          <h1 className="page-title">{company.name}</h1>
          <p className="page-sub">{company.clientCount} clients · {company.bookingCount} bookings{company.lastBooking ? ` · last ${formatDate(company.lastBooking)}` : ''}</p>
        </div>
      </div>

      <CompanyCard company={company} members={members} />

      <section className="card mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">Coordinator</p>
          {coordinator ? <span className="inline-flex items-center gap-2"><Avatar name={coordinator.name} color={coordinator.color} size="sm" />{coordinator.name}</span> : <span className="text-danger">Unassigned</span>}
        </div>
        {members.length > 0 && <button className="btn" onClick={() => setReassigning(true)}>{coordinator ? 'Reassign' : 'Assign'}</button>}
      </section>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Clients</h2>
      <DataTable columns={columns} data={members} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/clients/${c.id}`)} empty="No clients in this company yet." emptyIcon="users" />

      <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Ticket history ({history.length})</h2>
      <DataTable columns={historyColumns} data={pageOf(history, historyPage).rows} rowKey={(t) => t.id} onRowClick={(t) => navigate(`/admin/tickets/${t.id}`)} empty="No tickets yet." emptyIcon="ticket" />
      <Pager total={history.length} page={historyPage} onPage={setHistoryPage} />

      {reassigning && members[0] && (
        <ReassignModal
          currentId={company.assignedCoordinatorId}
          company={{ name: company.name, clients: members.length }}
          onClose={() => setReassigning(false)}
          onConfirm={(coordinatorId, reason) =>
            mutate('/api/clients', 'PUT', { clientId: members[0].id, coordinatorId, reason }, company.assignedCoordinatorId ? 'Company reassigned' : 'Coordinator assigned')
          }
        />
      )}
    </div>
  );
}
