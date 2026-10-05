import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import { describeChange, errorMessage, formatDateTime, roleLabel } from '../../lib/utils';
import type { AuditLog, AuditPage } from '../../types';

const NO_FILTERS = { from: '', to: '', action: '', doneBy: '' };

export default function AuditLogs() {
  const { get, tickets, clients, coordinators, modules, exportExcel } = useData();
  const page = usePageData('tickets', 'clients');
  const [filters, setFilters] = useState(NO_FILTERS);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [lists, setLists] = useState({ actions: [] as string[], people: [] as string[] });
  const [state, setState] = useState<'loading' | 'more' | 'done'>('loading');
  const [error, setError] = useState('');
  const latest = useRef(0); // only the newest request may change the list

  // The server filters and pages: 50 entries at a time, newest first, from the whole log.
  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++latest.current;
      if (!cursor) setNext(null); // a fresh first page is on its way: the old "Load more" no longer applies
      setState(cursor ? 'more' : 'loading');
      setError('');
      const query = new URLSearchParams(Object.entries({ ...filters, cursor: cursor ?? '' }).filter(([, v]) => v));
      try {
        const result = await get<AuditPage>(`/api/audit-logs?${query}`);
        if (mine !== latest.current) return;
        setLogs((current) => (cursor ? [...current, ...result.logs] : result.logs));
        setNext(result.nextCursor);
        setLists({ actions: result.actions, people: result.people });
      } catch (e) {
        if (mine !== latest.current) return;
        setError(errorMessage(e));
      }
      setState('done');
    },
    [get, filters],
  );
  useEffect(() => {
    load();
  }, [load]);

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
    { header: 'Role', cell: (l) => (l.role ? roleLabel(l.role) : '—') },
  ];

  const set = (patch: Partial<typeof NO_FILTERS>) => setFilters({ ...filters, ...patch });
  const filtered = Object.values(filters).some(Boolean);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit logs</h1>
          <p className="page-sub">{state === 'loading' ? 'Loading…' : `Showing ${logs.length} ${next ? 'of more' : 'matching'} changes, newest first.`} The Excel download has every entry.</p>
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
          {lists.actions.map((action) => <option key={action}>{action}</option>)}
        </select>
        <select className="input w-auto" aria-label="Done by" value={filters.doneBy} onChange={(e) => set({ doneBy: e.target.value })}>
          <option value="">Everyone</option>
          {lists.people.map((name) => <option key={name}>{name}</option>)}
        </select>
        {filtered && <button className="btn" onClick={() => setFilters(NO_FILTERS)}>Clear</button>}
      </div>

      {error && (
        <p role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-md bg-danger-light px-4 py-2.5 text-danger-dark">
          {error}
          <button className="btn" onClick={() => load()}>Retry</button>
        </p>
      )}
      <DataTable columns={columns} data={logs} rowKey={(l) => l.id} empty={state === 'loading' ? 'Loading…' : 'No activity found.'} emptyIcon="filter" emptyAction={filtered ? { label: 'Clear filters', onClick: () => setFilters(NO_FILTERS) } : undefined} />
      {next && (
        <div className="mt-3 flex justify-center">
          <button className="btn" disabled={state === 'more'} onClick={() => load(next)}>{state === 'more' ? 'Loading…' : 'Load 50 more'}</button>
        </div>
      )}
    </div>
  );
}
