import { useState } from 'react';
import { format } from 'date-fns';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import { describeChange, formatDateTime } from '../../lib/utils';
import type { AuditLog } from '../../types';

const NO_FILTERS = { from: '', to: '', action: '', doneBy: '' };
const distinct = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].sort();

export default function AuditLogs() {
  const { auditLogs, tickets, clients, coordinators, modules, exportExcel } = useData();
  const page = usePageData('auditLogs', 'tickets', 'clients');
  const [filters, setFilters] = useState(NO_FILTERS);

  // Entity ids are UUIDs, so one lookup names tickets, clients, coordinators and modules alike.
  const names = new Map<string, string>([
    ...tickets.map((t) => [t.id, t.ticketNumber] as const),
    ...clients.map((c) => [c.id, c.companyName] as const),
    ...coordinators.map((c) => [c.id, c.name] as const),
    ...modules.map((m) => [m.id, m.name] as const),
  ]);
  const entity = (l: AuditLog) => (l.entityId && names.get(l.entityId) ? `${l.entityType}: ${names.get(l.entityId)}` : l.entityType);

  const columns: Column<AuditLog>[] = [
    { header: 'Timestamp', cell: (l) => formatDateTime(l.createdAt), className: 'whitespace-nowrap' },
    { header: 'Action', cell: (l) => <span className="font-mono text-xs">{l.action}</span> },
    { header: 'Entity', cell: entity },
    { header: 'Description', cell: (l) => describeChange(l) || '—' },
    { header: 'Done By', cell: (l) => l.doneByName ?? '—' },
    { header: 'Role', cell: (l) => l.role ?? '—' },
  ];

  const day = (l: AuditLog) => (l.createdAt ? format(new Date(l.createdAt), 'yyyy-MM-dd') : '');
  const rows = auditLogs.filter(
    (l) => (!filters.from || day(l) >= filters.from) && (!filters.to || day(l) <= filters.to) && (!filters.action || l.action === filters.action) && (!filters.doneBy || l.doneByName === filters.doneBy),
  );
  const set = (patch: Partial<typeof NO_FILTERS>) => setFilters({ ...filters, ...patch });

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit logs</h1>
          <p className="page-sub">Showing {rows.length} of the latest {auditLogs.length} changes. The Excel download has every entry.</p>
        </div>
        <button className="btn btn-primary" onClick={() => exportExcel({ audit: true })}>Download Excel</button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <label className="label">From</label>
          <input className="input w-40" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="input w-40" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
        </div>
        <select className="input w-auto" aria-label="Action" value={filters.action} onChange={(e) => set({ action: e.target.value })}>
          <option value="">All actions</option>
          {distinct(auditLogs.map((l) => l.action)).map((action) => <option key={action}>{action}</option>)}
        </select>
        <select className="input w-auto" aria-label="Done by" value={filters.doneBy} onChange={(e) => set({ doneBy: e.target.value })}>
          <option value="">Everyone</option>
          {distinct(auditLogs.map((l) => l.doneByName)).map((name) => <option key={name}>{name}</option>)}
        </select>
        {Object.values(filters).some(Boolean) && <button className="btn" onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
      </div>

      <DataTable columns={columns} data={rows} rowKey={(l) => l.id} empty="No activity found." emptyIcon="filter" emptyAction={Object.values(filters).some(Boolean) ? { label: 'Clear filters', onClick: () => setFilters(NO_FILTERS) } : undefined} />
    </div>
  );
}
