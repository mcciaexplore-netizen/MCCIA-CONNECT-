import { useState } from 'react';
import { Link } from 'react-router';
import { useData } from '../../context/DataContext';
import { useEntityLogs } from '../../lib/useEntityLogs';
import { formatDate } from '../../lib/utils';
import type { Ticket } from '../../types';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';

/** Left column: the client's contact panel and (for admins) their coordinator history. */
export default function ClientPanel({ ticket }: { ticket: Ticket }) {
  const { role, tickets, getClient, getCoordinator } = useData();
  const [historyOpen, setHistoryOpen] = useState(true);
  const client = getClient(ticket.clientId);
  const ownTickets = tickets.filter((t) => t.clientId === ticket.clientId);
  const auditLogs = useEntityLogs([ticket.clientId, ...ownTickets.map((t) => t.id)], role === 'super_admin' && historyOpen, tickets);
  if (!client) return null;

  const fields: [string, string][] = [
    ['Contact Owner', getCoordinator(client.assignedCoordinatorId)?.name ?? '—'],
    ['Email', client.email],
    ['Phone', client.phone],
    ['Company', client.companyName],
    ['Industry', client.industry ?? '—'],
    ['Scale', client.scale ?? '—'],
    ['UDYAM', client.udyamNo ?? '—'],
    ['Member status', client.isMember ? `Member${client.membershipId ? ` · ${client.membershipId}` : ''}` : 'Not a member'],
    ['Acquisition', client.acquisitionFrom ?? '—'],
    ['Created', formatDate(client.createdAt)],
  ];
  // Every coordinator change for this client is in the audit log (newest first): the client's own assignments
  // and changes made on one of their tickets.
  const numbers = new Map(tickets.filter((t) => t.clientId === client.id).map((t) => [t.id, t.ticketNumber]));
  const history = auditLogs.filter(
    (l) =>
      (l.entityType === 'client' && l.entityId === client.id && (l.action === 'client.assigned' || l.action === 'client.reassigned')) ||
      (l.entityType === 'ticket' && l.entityId && numbers.has(l.entityId) && l.newValue && 'coordinator' in l.newValue),
  );

  return (
    <aside className="w-full border-b border-line bg-white p-4 xl:w-[260px] xl:shrink-0 xl:border-b-0 xl:border-r">
      <div className="flex flex-col items-center text-center">
        <Avatar name={client.personName} size="lg" />
        <h2 className="mt-3 text-lg font-bold">{client.personName}</h2>
        <p className="text-sm text-ink-2">{client.companyName}</p>
      </div>
      <hr className="my-4 border-line" />

      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Contact Properties</h3>
        {role === 'super_admin' && (
          <Link to={`/admin/clients/${client.id}`} title="Edit contact" className="rounded p-1 text-ink-2 hover:bg-page hover:text-primary"><Icon name="pencil" /></Link>
        )}
      </div>
      <dl className="space-y-3">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>

      {role === 'super_admin' && (
        <>
          <hr className="my-4 border-line" />
          <button className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-2" onClick={() => setHistoryOpen(!historyOpen)}>
            Coordinator history <span>{historyOpen ? '▾' : '▸'}</span>
          </button>
          {historyOpen && (
            <ul className="mt-3 space-y-3">
              {history.length === 0 && <li className="text-ink-3">No coordinator yet.</li>}
              {history.map((log) => (
                <li key={log.id}>
                  <p className="font-medium">{String(log.newValue?.coordinator ?? '—')}</p>
                  <p className="text-xs text-ink-3">
                    {log.oldValue?.coordinator && log.oldValue.coordinator !== 'Unassigned' ? `from ${String(log.oldValue.coordinator)} · ` : ''}
                    {formatDate(log.createdAt)}
                    {log.entityType === 'ticket' && log.entityId ? ` · ${numbers.get(log.entityId)}` : ''}
                  </p>
                  {log.newValue?.reason != null && <p className="mt-0.5 text-xs text-ink-2">“{String(log.newValue.reason)}”</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
