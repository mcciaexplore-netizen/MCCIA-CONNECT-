import { useState } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import AppletForm from '../../components/sections/AppletForm';
import SectionExcel from '../../components/sections/SectionExcel';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Pager, { pageOf } from '../../components/ui/Pager';
import StatCard from '../../components/ui/StatCard';
import { formatDate } from '../../lib/utils';
import type { Applet } from '../../types';

const dash = <span className="text-ink-3">—</span>;

/** The companies that have their applet completed and deployed, kept by hand by the admins. */
export default function Applets() {
  const { applets, mutate } = useData();
  const page = usePageData('applets');
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [editing, setEditing] = useState<Applet | 'new' | null>(null);

  const query = search.trim().toLowerCase();
  const rows = applets.filter((a) => !query || `${a.companyName} ${a.contactName ?? ''} ${a.phone ?? ''} ${a.email ?? ''} ${a.appletName ?? ''} ${a.liveLink ?? ''}`.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<Applet>[] = [
    { header: 'Company', cell: (a) => <span className="font-medium">{a.companyName}</span> },
    { header: 'Membership', cell: (a) => a.membership || dash },
    { header: 'Contact', cell: (a) => a.contactName || dash },
    { header: 'Phone', cell: (a) => a.phone || dash },
    { header: 'Email', cell: (a) => (a.email ? <span className="break-all">{a.email}</span> : dash) },
    { header: 'Applet', cell: (a) => a.appletName || dash },
    {
      header: 'Live link',
      cell: (a) => (a.liveLink ? <a className="text-primary hover:underline" href={a.liveLink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{a.liveLink.replace(/^https?:\/\//, '')}</a> : dash),
    },
    { header: 'Deployed on', cell: (a) => (a.deployedOn ? formatDate(`${a.deployedOn}T12:00:00Z`) : dash) },
  ];

  const remove = (a: Applet) => window.confirm(`Remove ${a.appletName ? `${a.appletName} (${a.companyName})` : a.companyName}?`) && mutate('/api/applets', 'DELETE', { id: a.id }, 'Applet removed');

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applets</h1>
          <p className="page-sub">Companies whose applet is completed and deployed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SectionExcel
            section="applets"
            noun="applets"
            pdf={() => ({ title: 'Applets', subtitle: query ? `Search: ${search.trim()}` : 'Deployed applets', headers: ['Company', 'Membership', 'Contact', 'Phone', 'Email', 'Applet', 'Live link', 'Deployed on', 'Notes'], rows: rows.map((a) => [a.companyName, a.membership, a.contactName, a.phone, a.email, a.appletName, a.liveLink, a.deployedOn && formatDate(`${a.deployedOn}T12:00:00Z`), a.notes]) })}
          />
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add applet</button>
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard icon="package" label="Applets deployed" value={applets.length} />
        <StatCard icon="users" label="Companies" value={new Set(applets.map((a) => a.companyName.trim().toLowerCase())).size} />
        <StatCard icon="check" label="Members" value={applets.filter((a) => a.membership?.trim().toLowerCase() === 'member').length} />
      </div>
      <input className="input mb-4 max-w-xs" placeholder="Search company, contact, applet…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      <DataTable columns={columns} data={shown} rowKey={(a) => a.id} onRowClick={setEditing} onEdit={setEditing} onDelete={remove} empty="No applets added yet." emptyIcon="package" emptyAction={applets.length ? undefined : { label: '+ Add applet', onClick: () => setEditing('new') }} />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
      {editing && <AppletForm applet={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
