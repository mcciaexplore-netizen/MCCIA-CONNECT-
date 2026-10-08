import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import Avatar from '../../components/ui/Avatar';
import DataTable, { type Column } from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Pager, { pageOf } from '../../components/ui/Pager';
import Icon, { type IconName } from '../../components/ui/Icon';
import ImportModal from '../../components/ticket/ImportModal';
import ModePill from '../../components/ui/ModePill';
import ModuleBadge from '../../components/ui/ModuleBadge';
import StatusBadge from '../../components/ui/StatusBadge';
import { awaitingNotes } from '../../lib/dashboard';
import { confirmCancel, formatDate, isOpen, studioDay } from '../../lib/utils';
import { BOOKING_MODES, STATUS_LABELS, TICKET_STATUSES, type Ticket, type TicketStatus } from '../../types';

const NO_FILTERS = { search: '', status: '', moduleId: '', coordinatorId: '', mode: '', notes: '', dateFrom: '', dateTo: '' };

/** Zoho Desk style ticket list. Shared by admins (all tickets) and coordinators (MyTickets): the API already scopes the list. */
export default function Tickets() {
  const { tickets, modules, coordinators, role, base, getClient, getModule, getCoordinator, getSession, mutate, exportExcel } = useData();
  const load = usePageData('tickets', 'clients', 'bookings');
  const navigate = useNavigate();
  const admin = role === 'super_admin';
  // The dashboard's alerts link here with ?coordinator=none (unassigned) or ?notes=pending (post-consultation not filled).
  // ?date_from= and ?date_to= (YYYY-MM-DD) keep tickets whose session starts in that range; the address follows the date boxes.
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ ...NO_FILTERS, coordinatorId: params.get('coordinator') ?? '', notes: params.get('notes') ?? '', dateFrom: params.get('date_from') ?? '', dateTo: params.get('date_to') ?? '' });
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tableKey, setTableKey] = useState(0); // remounting the table clears its checkboxes
  const [importing, setImporting] = useState(false);

  const clearSelection = () => {
    setSelectedIds([]);
    setTableKey((key) => key + 1);
  };
  const filter = (patch: Partial<typeof NO_FILTERS>) => {
    setFilters({ ...filters, ...patch });
    if ('dateFrom' in patch || 'dateTo' in patch) {
      const next = { dateFrom: 'date_from', dateTo: 'date_to' } as const;
      setParams((current) => {
        for (const [key, name] of Object.entries(next)) if (key in patch) (patch[key as keyof typeof next] ? current.set(name, patch[key as keyof typeof next]!) : current.delete(name));
        return current;
      }, { replace: true });
    }
    setPage(1);
    clearSelection();
  };
  const goTo = (next: number) => {
    setPage(next);
    clearSelection();
  };

  const active = Object.values(filters).some(Boolean);
  const query = filters.search.trim().toLowerCase();
  const now = new Date();
  const rows = tickets.filter((t) => {
    const client = getClient(t.clientId);
    const session = getSession(t.id);
    const day = session ? studioDay(session.booking.startTime) : '';
    const text = [t.ticketNumber, client?.companyName, client?.personName, client?.phone, client?.email].join(' ').toLowerCase();
    return (
      (!query || text.includes(query)) &&
      (!filters.status || t.status === filters.status) &&
      (!filters.moduleId || t.moduleId === filters.moduleId) &&
      (!filters.coordinatorId || (filters.coordinatorId === 'none' ? !t.coordinatorId && isOpen(t.status) : t.coordinatorId === filters.coordinatorId)) &&
      (!filters.mode || session?.booking.mode === filters.mode) &&
      (!filters.dateFrom || (day !== '' && day >= filters.dateFrom)) &&
      (!filters.dateTo || (day !== '' && day <= filters.dateTo)) &&
      (!filters.notes || Boolean(session && awaitingNotes(session, now)))
    );
  });

  const { rows: shown, start } = pageOf(rows, page);

  const bulk = async (patch: { status?: TicketStatus; coordinatorId?: string }) => {
    const result = await mutate<{ updated: number; failed: { error: string }[] }>('/api/tickets', 'PATCH', { ids: selectedIds, ...patch });
    if (!result) return;
    const skipped = result.failed.length;
    const message = `${result.updated} ticket${result.updated === 1 ? '' : 's'} updated${skipped ? `, ${skipped} skipped (${result.failed[0].error})` : ''}`;
    if (skipped) toast.error(message);
    else toast.success(message);
    clearSelection();
  };

  const iconLink = (href: string | null | undefined, title: string, icon: IconName) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" title={title} className="inline-flex text-primary" onClick={(e) => e.stopPropagation()}><Icon name={icon} /></a>
    ) : (
      <span className="text-ink-3">—</span>
    );
  const columns: Column<Ticket>[] = [
    { header: '#', cell: (t) => start + shown.indexOf(t) + 1, className: 'w-10 text-ink-3', desktopOnly: true },
    { header: 'Ticket ID', cell: (t) => t.ticketNumber, isId: true },
    { header: 'Company', cell: (t) => getClient(t.clientId)?.companyName ?? '—' },
    { header: 'Person', cell: (t) => getClient(t.clientId)?.personName ?? '—' },
    { header: 'Phone', cell: (t) => getClient(t.clientId)?.phone ?? '—' },
    ...(admin
      ? [{
          header: 'Coordinator',
          cell: (t: Ticket) => {
            const c = getCoordinator(t.coordinatorId);
            return c ? <span className="inline-flex items-center gap-2"><Avatar name={c.name} color={c.color} size="sm" />{c.name}</span> : <span className="text-ink-3">Unassigned</span>;
          },
        }]
      : []),
    { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
    { header: 'Due Date', cell: (t) => formatDate(t.dueDate) },
    { header: 'Email', cell: (t) => getClient(t.clientId)?.email ?? '—' },
    { header: 'Mode', cell: (t) => { const mode = getSession(t.id)?.booking.mode; return mode ? <ModePill mode={mode} /> : '—'; } },
    { header: 'Module', cell: (t) => <ModuleBadge module={getModule(t.moduleId)} /> },
    { header: 'Meet Link', cell: (t) => iconLink(getSession(t.id)?.booking.meetingLink, 'Open meeting link', 'link') },
    { header: 'Recording', cell: (t) => iconLink(getSession(t.id)?.booking.recordingLink, 'Open Fireflies recording', 'video') },
    { header: 'UDYAM', cell: (t) => getClient(t.clientId)?.udyamNo ?? '—' },
    { header: 'Sector', cell: (t) => getClient(t.clientId)?.industry ?? '—' },
  ];

  if (load.loading || load.error) return <DataState {...load}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center gap-3">
          <h1 className="page-title">
            {admin ? 'All Tickets' : 'My Tickets'} <span className="font-normal text-ink-2">({tickets.length})</span>
          </h1>
          <button title="Filters" className="btn relative h-8 w-8 p-0" onClick={() => setShowFilters(!showFilters)}>
            <Icon name="filter" />
            {active && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />}
          </button>
        </div>
        {admin && (
          <div className="flex gap-2">
            <button className="btn" onClick={() => setImporting(true)}>Import tickets</button>
            <button className="btn" onClick={() => exportExcel()}>Export all to Excel</button>
            <button className="btn btn-primary" onClick={() => navigate('/admin/create-booking')}>+ Create Booking</button>
          </div>
        )}
      </div>

      {tickets.length === 0 ? (
        <div className="card">
          <EmptyState icon="calendar" message="No tickets yet" hint={admin ? undefined : 'Tickets assigned to you will show up here.'} action={admin ? { label: 'Create the first booking', onClick: () => navigate('/admin/create-booking') } : undefined} />
        </div>
      ) : (
        <>
          {showFilters && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input className="input w-72" placeholder="Search ticket ID, company, person, phone, email…" value={filters.search} onChange={(e) => filter({ search: e.target.value })} />
              <select className="input w-auto" value={filters.status} onChange={(e) => filter({ status: e.target.value })}>
                <option value="">All statuses</option>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              <select className="input w-auto" value={filters.moduleId} onChange={(e) => filter({ moduleId: e.target.value })}>
                <option value="">All modules</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {admin && (
                <select className="input w-auto" value={filters.coordinatorId} onChange={(e) => filter({ coordinatorId: e.target.value })}>
                  <option value="">All coordinators</option>
                  <option value="none">Unassigned</option>
                  {coordinators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
              <select className="input w-auto" value={filters.mode} onChange={(e) => filter({ mode: e.target.value })}>
                <option value="">All modes</option>
                {BOOKING_MODES.map((m) => <option key={m} value={m}>{m === 'online' ? 'Online' : 'Offline'}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                From
                <input type="date" aria-label="Session from" className="input w-auto" value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(e) => filter({ dateFrom: e.target.value })} />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                To
                <input type="date" aria-label="Session to" className="input w-auto" value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(e) => filter({ dateTo: e.target.value })} />
              </label>
              <select className="input w-auto" value={filters.notes} onChange={(e) => filter({ notes: e.target.value })}>
                <option value="">All post-consultation</option>
                <option value="pending">Post-consultation not filled</option>
              </select>
              {active && <button className="btn" onClick={() => filter({ ...NO_FILTERS })}>Clear</button>}
            </div>
          )}

          {selectedIds.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary bg-primary-light px-3 py-2">
              <span className="mr-2 font-medium text-primary-dark">{selectedIds.length} selected</span>
              <select className="input w-auto" value="" onChange={(e) => e.target.value && (e.target.value !== 'cancelled' || confirmCancel(selectedIds.length)) && bulk({ status: e.target.value as TicketStatus })}>
                <option value="">Change Status</option>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
              {admin && (
                <>
                  <select className="input w-auto" value="" onChange={(e) => e.target.value && bulk({ coordinatorId: e.target.value })}>
                    <option value="">Assign Coordinator</option>
                    {coordinators.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button className="btn" onClick={() => exportExcel({ ids: selectedIds })}>Export Excel</button>
                </>
              )}
            </div>
          )}

          <DataTable
            key={tableKey}
            columns={columns}
            data={shown}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`${base}/tickets/${t.id}`)}
            selectable
            onSelectionChange={(selected) => setSelectedIds(selected.map((t) => t.id))}
            empty="No tickets match these filters." emptyIcon="filter" emptyAction={active ? { label: 'Clear filters', onClick: () => filter({ ...NO_FILTERS }) } : undefined}
          />

          <Pager total={rows.length} page={page} onPage={goTo} always />
        </>
      )}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
    </div>
  );
}
