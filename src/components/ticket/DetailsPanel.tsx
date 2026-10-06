import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import { companyNote, confirmCancel, confirmDelete, formatDate, isOpen } from '../../lib/utils';
import { PAYMENT_LABELS, PAYMENT_STATUSES, STATUS_LABELS, TICKET_STATUSES, type Ticket, type TicketStatus } from '../../types';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import ModePill from '../ui/ModePill';
import ModuleBadge from '../ui/ModuleBadge';
import ReassignModal from '../ui/ReassignModal';
import RescheduleModal from './RescheduleModal';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs text-ink-3">{label}</p>
      {children}
    </div>
  );
}

/** Right column: the ticket's own properties. Status and due date are editable; admins can reassign. */
export default function DetailsPanel({ ticket }: { ticket: Ticket }) {
  const { role, base, clients, companies, getClient, getModule, getCoordinator, getSession, mutate } = useData();
  const navigate = useNavigate();
  const [reassigning, setReassigning] = useState(false);
  const [editingDue, setEditingDue] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const coordinator = getCoordinator(ticket.coordinatorId);
  // Whoever has the client already (the ticket's own coordinator, or the client's when the ticket has none): replacing them needs a reason.
  const owner = ticket.coordinatorId ?? getClient(ticket.clientId)?.assignedCoordinatorId ?? null;
  const booking = getSession(ticket.id)?.booking;
  const mode = booking?.mode;

  const update = (patch: { status?: TicketStatus; dueDate?: string | null }) => mutate('/api/tickets', 'PATCH', { id: ticket.id, ...patch }, 'Ticket updated');
  const remove = async () => {
    if (confirmDelete(ticket.ticketNumber) && (await mutate(`/api/tickets?id=${ticket.id}`, 'DELETE', undefined, 'Ticket deleted'))) navigate(`${base}/tickets`);
  };

  return (
    <aside className="w-full space-y-5 border-t border-line bg-white p-4 xl:w-[280px] xl:shrink-0 xl:border-l xl:border-t-0">
      <p className="text-2xl font-semibold text-primary">{ticket.ticketNumber}</p>

      <Field label="Status">
        <select className="input" value={ticket.status} disabled={ticket.status === 'cancelled'} onChange={(e) => (e.target.value !== 'cancelled' || confirmCancel()) && update({ status: e.target.value as TicketStatus })}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </Field>

      <Field label="Module"><ModuleBadge module={getModule(ticket.moduleId)} /></Field>

      <Field label="Payment">
        {role === 'super_admin' ? (
          <select className="input" value={ticket.paymentStatus} onChange={(e) => mutate('/api/tickets', 'PATCH', { id: ticket.id, paymentStatus: e.target.value }, 'Payment updated')}>
            {PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{PAYMENT_LABELS[p]}</option>)}
          </select>
        ) : (
          <span>{PAYMENT_LABELS[ticket.paymentStatus]}</span>
        )}
      </Field>

      <Field label="Coordinator">
        <div className="flex items-center justify-between gap-2">
          {coordinator ? <span className="inline-flex items-center gap-2"><Avatar name={coordinator.name} color={coordinator.color} size="sm" />{coordinator.name}</span> : <span className="text-ink-3">Unassigned</span>}
          {role === 'super_admin' && <button className="btn px-2 py-1 text-xs" onClick={() => setReassigning(true)}>{coordinator ? 'Reassign' : 'Assign'}</button>}
        </div>
      </Field>

      <Field label="Due date">
        {editingDue ? (
          <input
            className="input"
            type="date"
            autoFocus
            defaultValue={ticket.dueDate ? format(new Date(ticket.dueDate), 'yyyy-MM-dd') : ''}
            onBlur={() => setEditingDue(false)}
            onChange={(e) => {
              update({ dueDate: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null });
              setEditingDue(false);
            }}
          />
        ) : (
          <div className="flex items-center justify-between">
            <span>{formatDate(ticket.dueDate)}</span>
            <button title="Change due date" className="rounded p-1 text-ink-2 hover:bg-page hover:text-primary" onClick={() => setEditingDue(true)}><Icon name="pencil" /></button>
          </div>
        )}
      </Field>

      <Field label="Created">{formatDate(ticket.createdAt)}</Field>
      <Field label="Booking mode">{mode ? <ModePill mode={mode} /> : '—'}</Field>
      {booking?.status === 'scheduled' && isOpen(ticket.status) && <button className="btn w-full" onClick={() => setRescheduling(true)}>Reschedule</button>}
      {rescheduling && booking && <RescheduleModal ticket={ticket} booking={booking} onClose={() => setRescheduling(false)} />}
      {role === 'super_admin' && <button className="btn btn-danger w-full" onClick={remove}>Delete ticket</button>}

      {reassigning && (
        <ReassignModal
          currentId={owner}
          company={companyNote(getClient(ticket.clientId), clients, companies)}
          onClose={() => setReassigning(false)}
          onConfirm={(coordinatorId, reason) =>
            mutate('/api/tickets', 'PATCH', { id: ticket.id, coordinatorId, ...(owner && { reason }) }, owner ? 'Coordinator reassigned' : 'Coordinator assigned')
          }
        />
      )}
    </aside>
  );
}
