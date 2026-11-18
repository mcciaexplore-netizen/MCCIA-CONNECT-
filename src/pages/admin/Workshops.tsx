import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import SectionExcel from '../../components/sections/SectionExcel';
import WorkshopForm from '../../components/sections/WorkshopForm';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import StatCard from '../../components/ui/StatCard';
import { workshopDate, WorkshopStatusPill } from '../../lib/workshops';
import { cn } from '../../lib/utils';
import { WORKSHOP_KIND_LABELS, type Workshop } from '../../types';

const TABS = { all: 'All', workshop: 'Workshops (W)', mini: 'Mini Sessions (M)' } as const;
const dash = <span className="text-ink-3">—</span>;

/** Every workshop batch (W-… Workshop, M-… Mini Session). Its participants are on its own page (click the Workshop ID). */
export default function Workshops() {
  const { workshops, mutate } = useData();
  const page = usePageData('workshops');
  const navigate = useNavigate();
  const [tab, setTab] = useState<keyof typeof TABS>('all');
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [editing, setEditing] = useState<Workshop | 'new' | null>(null);

  const query = search.trim().toLowerCase();
  const rows = workshops
    .filter((w) => tab === 'all' || w.kind === tab)
    .filter((w) => !query || `${w.code} ${w.title} ${w.trainer ?? ''} ${w.organisation ?? ''} ${w.venue ?? ''}`.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<Workshop>[] = [
    { header: 'Workshop ID', isId: true, cell: (w) => <Link to={`/admin/workshops/${w.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{w.code}</Link> },
    { header: 'Type', cell: (w) => WORKSHOP_KIND_LABELS[w.kind] },
    { header: 'Title', cell: (w) => <span className="font-medium">{w.title}</span> },
    { header: 'Date', cell: (w) => workshopDate(w) || dash },
    { header: 'Trainer', cell: (w) => w.trainer || dash },
    { header: 'Mode', cell: (w) => (w.mode === 'online' ? 'Online' : 'Offline') },
    { header: 'Venue / link', cell: (w) => w.venue || dash },
    { header: 'Status', cell: (w) => <WorkshopStatusPill status={w.status} /> },
  ];

  const remove = (w: Workshop) =>
    window.confirm(`Delete ${w.code} and all its participants? This cannot be undone.`) && mutate('/api/workshops', 'DELETE', { id: w.id }, `${w.code} deleted`);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workshops</h1>
          <p className="page-sub">W = Workshop (Major), M = Mini Session. Click a Workshop ID to see who registered and who attended.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SectionExcel section="workshops" noun="workshop participants" />
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add workshop</button>
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard icon="presentation" label="Workshops (W)" value={workshops.filter((w) => w.kind === 'workshop').length} />
        <StatCard icon="presentation" label="Mini Sessions (M)" value={workshops.filter((w) => w.kind === 'mini').length} />
        <StatCard icon="check" label="Completed" value={workshops.filter((w) => w.status === 'completed').length} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((key) => (
          <button key={key} className={cn('btn', tab === key && 'border-primary bg-primary-light text-primary-dark')} onClick={() => { setTab(key); setPageNo(1); }}>{TABS[key]}</button>
        ))}
        <input className="input ml-auto max-w-xs" placeholder="Search ID, title, trainer…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      </div>
      <DataTable columns={columns} data={shown} rowKey={(w) => w.id} onRowClick={(w) => navigate(`/admin/workshops/${w.id}`)} onEdit={setEditing} onDelete={remove} empty="No workshops yet. Add one, or import your workshop sheet." emptyIcon="presentation" />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
      {editing && <WorkshopForm workshop={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
