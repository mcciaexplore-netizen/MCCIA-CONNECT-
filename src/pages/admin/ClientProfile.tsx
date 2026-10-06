import { Suspense, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import { useEntityLogs } from '../../lib/useEntityLogs';
import ActivitiesTab from '../../components/client/ActivitiesTab';
import ContactPanel from '../../components/client/ContactPanel';
import TicketsSection from '../../components/client/TicketsSection';
import ActivityList from '../../components/ui/ActivityList';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import Avatar from '../../components/ui/Avatar';
import ClientStatCards from '../../components/ui/ClientStatCards';
import { MonthlyBookings } from '../../lib/pages';
import { cn } from '../../lib/utils';

type Tab = 'overview' | 'history' | 'activities';
const ALL_TABS: [Tab, string][] = [['overview', 'Overview'], ['history', 'History'], ['activities', 'Activities']];

/**
 * Client-focused twin of the ticket page: contact panel | header + tabs (Overview, History, Activities).
 * Admins can edit; coordinators get a read-only view of their own clients (no history, no Add Ticket).
 * Data comes from the context (clients, tickets, bookings, and audit logs for admins, loaded when the page opens); the coordinator history table
 * is fetched from GET /api/clients?history=<id> by the contact panel.
 */
export default function ClientProfile() {
  const { clientId } = useParams();
  const { clients, tickets, bookings, role, base } = useData();
  const admin = role === 'super_admin';
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const page = usePageData('clients', 'tickets', 'bookings', ...(admin ? (['companies'] as const) : []));

  const client = clients.find((c) => c.id === clientId);
  const auditLogs = useEntityLogs(client ? [client.id, ...tickets.filter((t) => t.clientId === client.id).map((t) => t.id)] : [], admin && tab === 'history', tickets);
  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  if (!client) {
    return (
      <div className="card">
        <EmptyState icon="users" message="Client not found." hint="They may not exist, or they are not assigned to you." action={{ label: admin ? 'Back to clients' : 'Back to my clients', onClick: () => navigate(`${base}/clients`) }} />
      </div>
    );
  }

  // Coordinators get a read-only view without the history tab (audit logs are admin-only).
  const tabs = admin ? ALL_TABS : ALL_TABS.filter(([key]) => key !== 'history');
  const theirs = tickets.filter((t) => t.clientId === client.id);
  const ticketNumbers = new Map(theirs.map((t) => [t.id, t.ticketNumber]));
  // Everything that happened to the client or to any of their tickets (newest first).
  const history = auditLogs.filter(
    (log) => (log.entityType === 'client' && log.entityId === client.id) || (log.entityType === 'ticket' && log.entityId && ticketNumbers.has(log.entityId)),
  );

  return (
    // -m-6 lets the columns reach the edges of the padded content area
    <div className="-m-4 flex min-h-[calc(100vh-var(--topbar-height))] flex-col md:-m-6 xl:flex-row">
      <ContactPanel key={client.id} client={client} readOnly={!admin} />

      <div className="min-w-0 flex-1 p-4 md:p-6">
        <Link to={`${base}/clients`} className="text-primary hover:underline">← {admin ? 'All clients' : 'My clients'}</Link>
        <div className="mb-4 mt-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={client.personName} size="lg" />
            <div>
              <h1 className="page-title">{client.personName}</h1>
              <p className="text-ink-2">{client.companyName}</p>
            </div>
          </div>
          {admin && <button className="btn btn-primary" onClick={() => navigate('/admin/create-booking', { state: { clientId: client.id } })}>+ Add Ticket</button>}
        </div>

        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={cn('-mb-px border-b-2 px-4 py-2 font-medium', tab === key ? 'border-primary text-primary' : 'border-transparent text-ink-2 hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            <ClientStatCards tickets={theirs} />
            <TicketsSection tickets={theirs} />
            <Suspense fallback={<section className="card h-[290px]" />}>
              <MonthlyBookings bookings={bookings.filter((b) => b.clientId === client.id)} />
            </Suspense>
          </div>
        )}
        {tab === 'history' && admin && (
          <section className="card">
            <ActivityList logs={history} ticketNumbers={ticketNumbers} />
          </section>
        )}
        {tab === 'activities' && <ActivitiesTab clientId={client.id} />}
      </div>
    </div>
  );
}
