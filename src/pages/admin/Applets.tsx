import { useState } from 'react';
import { useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import AppletForm from '../../components/sections/AppletForm';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import StatCard from '../../components/ui/StatCard';
import { cn, formatDate } from '../../lib/utils';
import type { AppletRow } from '../../types';

const FILTERS = { all: 'All', deployed: 'Deployed', awaiting: 'Awaiting details' } as const;
const deployed = (a: AppletRow) => Boolean(a.liveLink || a.deployedOn);

/** Every company whose Applet Setup ticket is completed, with the applet's live link and deploy date (added here by an admin). */
export default function Applets() {
  const { applets, getCoordinator } = useData();
  const page = usePageData('applets');
  const navigate = useNavigate();
  const [filter, setFilter] = useState<keyof typeof FILTERS>('all');
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [editing, setEditing] = useState<AppletRow | null>(null);

  const query = search.trim().toLowerCase();
  const rows = applets
    .filter((a) => filter === 'all' || (filter === 'deployed') === deployed(a))
    .filter((a) => !query || `${a.companyName} ${a.personName} ${a.ticketNumber} ${a.appletName ?? ''}`.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);
  const live = applets.filter(deployed).length;

  const columns: Column<AppletRow>[] = [
    { header: 'Ticket', isId: true, cell: (a) => a.ticketNumber },
    { header: 'Company', cell: (a) => <span className="font-medium">{a.companyName}</span> },
    { header: 'Contact', cell: (a) => a.personName },
    { header: 'Applet', cell: (a) => a.appletName || <span className="text-ink-3">—</span> },
    {
      header: 'Live link',
      cell: (a) => (a.liveLink ? <a className="text-primary hover:underline" href={a.liveLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{a.liveLink.replace(/^https?:\/\//, '')}</a> : <span className="text-ink-3">—</span>),
    },
    { header: 'Deployed on', cell: (a) => (a.deployedOn ? formatDate(`${a.deployedOn}T12:00:00Z`) : <span className="text-gold">Awaiting details</span>) },
    { header: 'Session', cell: (a) => formatDate(a.sessionAt) },
    { header: 'Coordinator', cell: (a) => getCoordinator(a.coordinatorId)?.name ?? <span className="text-ink-3">—</span> },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applets</h1>
          <p className="page-sub">Companies whose Applet Setup is completed. Use the pencil to add the live link and deploy date.</p>
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard icon="check" label="Completed" value={applets.length} />
        <StatCard icon="package" label="Deployed" value={live} />
        <StatCard icon="clock" label="Awaiting details" value={applets.length - live} highlight={applets.length - live > 0} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => (
          <button key={key} className={cn('btn', filter === key && 'border-primary bg-primary-light text-primary-dark')} onClick={() => { setFilter(key); setPageNo(1); }}>{FILTERS[key]}</button>
        ))}
        <input className="input ml-auto max-w-xs" placeholder="Search company, ticket, applet…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      </div>
      <DataTable columns={columns} data={shown} rowKey={(a) => a.ticketId} onRowClick={(a) => navigate(`/admin/tickets/${a.ticketId}`)} onEdit={setEditing} empty="No completed Applet Setup tickets yet." emptyIcon="package" />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
      {editing && <AppletForm applet={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
