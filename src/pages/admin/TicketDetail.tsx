import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageData, useData, type Slice } from '../../context/DataContext';
import ActivityList from '../../components/ui/ActivityList';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import ClientPanel from '../../components/ticket/ClientPanel';
import DetailsPanel from '../../components/ticket/DetailsPanel';
import NotesTab from '../../components/ticket/NotesTab';
import OverviewTab from '../../components/ticket/OverviewTab';
import { cn } from '../../lib/utils';

type Tab = 'overview' | 'notes' | 'audit';

/**
 * Three columns: client panel | tabs (Overview, Internal Notes, Audit Log) | ticket properties.
 * Shared by admins and coordinators; the audit log, reassigning and contact editing are admin-only.
 * Data comes from the context: tickets, clients and bookings (plus the audit log for admins) are loaded when the page opens.
 */
export default function TicketDetail() {
  const { ticketId } = useParams();
  const { tickets, auditLogs, role, base } = useData();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const page = usePageData('tickets', 'clients', 'bookings', ...(role === 'super_admin' ? (['auditLogs'] as Slice[]) : []));

  const ticket = tickets.find((t) => t.id === ticketId);
  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  if (!ticket) {
    return (
      <div className="card">
        <EmptyState icon="ticket" message="Ticket not found." hint="It may not exist, or it is not assigned to you." action={{ label: 'Back to tickets', onClick: () => navigate(`${base}/tickets`) }} />
      </div>
    );
  }

  const tabs: [Tab, string][] = [
    ['overview', 'Overview'],
    ['notes', `Internal Notes (${ticket.internalNotes.length})`],
    ...(role === 'super_admin' ? ([['audit', 'Audit Log']] as [Tab, string][]) : []),
  ];

  return (
    // -m-6 lets the three columns reach the edges of the padded content area
    <div className="-m-4 flex min-h-[calc(100vh-var(--topbar-height))] flex-col md:-m-6 xl:flex-row">
      <ClientPanel ticket={ticket} />

      <div className="min-w-0 flex-1 p-4 md:p-6">
        <Link to={`${base}/tickets`} className="text-primary hover:underline">← All tickets</Link>
        <div className="mb-4 mt-3 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={cn('-mb-px border-b-2 px-4 py-2 font-medium', tab === key ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab ticket={ticket} />}
        {tab === 'notes' && <NotesTab ticket={ticket} />}
        {tab === 'audit' && role === 'super_admin' && (
          <section className="card">
            <ActivityList logs={auditLogs.filter((log) => log.entityType === 'ticket' && log.entityId === ticket.id)} />
          </section>
        )}
      </div>

      <DetailsPanel ticket={ticket} />
    </div>
  );
}
