import { useState } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import WorkshopForm from '../../components/sections/WorkshopForm';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import StatCard from '../../components/ui/StatCard';
import { cn, formatDate } from '../../lib/utils';
import { WORKSHOP_STATUS_LABELS, type Workshop, type WorkshopStatus } from '../../types';

const TABS = { all: 'All', workshop: 'Workshops (W)', mini: 'Mini Sessions (M)' } as const;
/** Status colours borrowed from the ticket statuses (index.css). */
const STATUS_COLOR: Record<WorkshopStatus, string> = { scheduled: 'new', completed: 'completed', cancelled: 'cancelled' };
const when = (w: Workshop) => `${formatDate(`${w.heldOn}T12:00:00Z`)}${w.startTime ? ` · ${w.startTime}${w.endTime ? `–${w.endTime}` : ''}` : ''}`;
const dash = <span className="text-ink-3">—</span>;

/** Every workshop event: W-0001... for a major workshop, M-0001... for a mini session. */
export default function Workshops() {
  const { workshops, mutate } = useData();
  const page = usePageData('workshops');
  const [tab, setTab] = useState<keyof typeof TABS>('all');
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [editing, setEditing] = useState<Workshop | 'new' | null>(null);

  const query = search.trim().toLowerCase();
  const rows = workshops
    .filter((w) => tab === 'all' || w.kind === tab)
    .filter((w) => !query || `${w.ticketNumber} ${w.title} ${w.trainer ?? ''} ${w.organisation ?? ''} ${w.venue ?? ''}`.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);
  const done = workshops.filter((w) => w.status === 'completed');

  const columns: Column<Workshop>[] = [
    { header: 'Number', isId: true, cell: (w) => w.ticketNumber },
    { header: 'Title', cell: (w) => <span className="font-medium">{w.title}</span> },
    { header: 'Date', cell: when },
    { header: 'Mode', cell: (w) => (w.mode === 'online' ? 'Online' : 'Offline') },
    { header: 'Venue / link', cell: (w) => w.venue || dash },
    { header: 'Trainer', cell: (w) => w.trainer || dash },
    { header: 'Organisation', cell: (w) => w.organisation || dash },
    { header: 'Participants', cell: (w) => w.participants ?? dash },
    {
      header: 'Status',
      cell: (w) => (
        <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `var(--status-${STATUS_COLOR[w.status]}-bg)`, color: `var(--status-${STATUS_COLOR[w.status]}-text)` }}>
          {WORKSHOP_STATUS_LABELS[w.status]}
        </span>
      ),
    },
  ];

  const remove = (w: Workshop) => window.confirm(`Delete ${w.ticketNumber} (${w.title})? Its number is not reused.`) && mutate('/api/workshops', 'DELETE', { id: w.id }, `${w.ticketNumber} deleted`);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workshops</h1>
          <p className="page-sub">W = Workshop (Major), M = Mini Session. Each has its own number series.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add workshop</button>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <StatCard icon="presentation" label="Workshops (W)" value={workshops.filter((w) => w.kind === 'workshop').length} />
        <StatCard icon="presentation" label="Mini Sessions (M)" value={workshops.filter((w) => w.kind === 'mini').length} />
        <StatCard icon="check" label="Completed" value={done.length} />
        <StatCard icon="users" label="Participants (completed)" value={done.reduce((n, w) => n + (w.participants ?? 0), 0)} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(TABS) as (keyof typeof TABS)[]).map((key) => (
          <button key={key} className={cn('btn', tab === key && 'border-primary bg-primary-light text-primary-dark')} onClick={() => { setTab(key); setPageNo(1); }}>{TABS[key]}</button>
        ))}
        <input className="input ml-auto max-w-xs" placeholder="Search number, title, trainer…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      </div>
      <DataTable columns={columns} data={shown} rowKey={(w) => w.id} onRowClick={setEditing} onEdit={setEditing} onDelete={remove} empty="No workshops yet." emptyIcon="presentation" emptyAction={workshops.length ? undefined : { label: '+ Add workshop', onClick: () => setEditing('new') }} />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
      {editing && <WorkshopForm workshop={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
