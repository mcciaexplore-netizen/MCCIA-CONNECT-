import { describeChange, formatDateTime } from '../../lib/utils';
import type { AuditLog } from '../../types';

const LABELS: Record<string, string> = {
  'booking.created': 'Booking created',
  'ticket.updated': 'Ticket updated',
  'ticket.post_consultation': 'Post-consultation notes saved',
  'email.sent': 'Email sent to client',
  'client.assigned': 'Coordinator assigned',
  'client.reassigned': 'Client reassigned',
  'client.updated': 'Client updated',
  'client.created': 'Client created',
};

/** green = created, red = cancelled, orange = reassigned, blue = anything else. */
export function logColor(log: AuditLog) {
  if (log.action.endsWith('.created')) return '#16a34a';
  if (log.newValue?.status === 'cancelled') return 'var(--primary)';
  if (log.action.includes('reassigned') || (log.newValue && 'coordinator' in log.newValue)) return '#ea580c';
  return '#2563eb';
}

/** Audit log entries as a timeline, newest first. Pass ticketNumbers to label which ticket an entry belongs to. */
export default function ActivityList({ logs, ticketNumbers }: { logs: AuditLog[]; ticketNumbers?: Map<string, string> }) {
  if (logs.length === 0) return <p className="text-ink-2">No activity yet.</p>;
  return (
    <ol className="relative ml-1.5 space-y-4 border-l border-line pl-5">
      {logs.map((log) => (
        <li key={log.id} className="relative">
          <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-white" style={{ background: logColor(log) }} />
          <p className="font-medium">
            {LABELS[log.action] ?? log.action}
            {log.entityType === 'ticket' && log.entityId && ticketNumbers?.has(log.entityId) && <span className="font-normal text-primary"> · {ticketNumbers.get(log.entityId)}</span>}
          </p>
          {describeChange(log) && <p className="text-ink-2">{describeChange(log)}</p>}
          <p className="text-xs text-ink-3">
            {log.doneByName} ({log.role}) · {formatDateTime(log.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
