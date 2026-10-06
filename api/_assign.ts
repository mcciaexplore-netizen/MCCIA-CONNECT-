import { and, count, eq, gt, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import { audit, db, HttpError, loadSettings, type AuthUser } from './_lib.js';
import { sendMail } from './_integrations.js';
import { clientAssigned, clientReassignedAway, formatWhen, type AssignmentMail } from './_mail.js';
import { sendAll } from './_sessions.js';
import { bookings, clients, coordinatorAssignments, coordinatorReassignments, coordinators, tickets } from './_schema.js';
import { CLOSED_STATUSES, MIN_REASON_LENGTH, type StudioZone } from '../src/types/index.js';

/**
 * The coordinator cannot take on sessions that overlap their own, or each other: a coordinator is never in two places at once.
 * Every upcoming session of the client moves with them, so those are the ones checked (the coordinator's other clients' sessions are theirs already).
 */
async function ensureNoClash(coordinator: { id: string; name: string }, clientId: string, zone: StudioZone) {
  const live = and(ne(bookings.status, 'cancelled'), gt(bookings.endTime, new Date()));
  const [moving, theirs] = await Promise.all([
    db.select({ start: bookings.startTime, end: bookings.endTime }).from(bookings).where(and(eq(bookings.clientId, clientId), live)),
    db.select({ start: bookings.startTime, end: bookings.endTime }).from(bookings).where(and(eq(bookings.coordinatorId, coordinator.id), ne(bookings.clientId, clientId), live)),
  ]);
  const overlap = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && a.end > b.start;
  const clash = moving.find((session, i) => theirs.some((t) => overlap(session, t)) || moving.slice(0, i).some((other) => overlap(session, other)));
  if (clash) throw new HttpError(409, `${coordinator.name} already has a session at ${formatWhen(clash.start, zone)}. A coordinator cannot take two sessions at the same time.`);
}

/**
 * A client belongs to one coordinator. Assigning (no coordinator yet) or reassigning (a reason of 20+ characters) moves the
 * client's open tickets and upcoming sessions to the new coordinator, records the history, and emails both coordinators.
 * Every way of assigning goes through here: the client page, a ticket's Assign/Reassign, bulk assign and the dashboard's
 * "Assign Now", so the client's next booking is assigned to the same coordinator automatically.
 * `ticket` (when assigning from a ticket) is moved too, even if it is closed; its coordinator counts as the previous one when the
 * client had none of their own.
 */
export async function assignClient(user: AuthUser, clientId: string, coordinatorId: string, reason: string, ticket?: { id: string; bookingId: string; coordinatorId: string | null }) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new HttpError(404, 'Client not found');
  const [coordinator] = await db.select().from(coordinators).where(eq(coordinators.id, coordinatorId));
  if (!coordinator?.isActive) throw new HttpError(400, 'Coordinator not found or inactive');
  if (client.assignedCoordinatorId === coordinatorId) throw new HttpError(400, 'This coordinator is already assigned');

  const settings = await loadSettings();
  await ensureNoClash(coordinator, clientId, settings.timezone);

  const previous = client.assignedCoordinatorId ?? ticket?.coordinatorId ?? null;
  if (previous && reason.length < MIN_REASON_LENGTH) throw new HttpError(400, `Give a reason of at least ${MIN_REASON_LENGTH} characters to reassign a client`);

  const pending = sql`case when ${tickets.status} = 'new' then 'pending' else ${tickets.status} end`;
  await db.batch([
    db.update(coordinatorAssignments).set({ isCurrent: false }).where(and(eq(coordinatorAssignments.clientId, clientId), eq(coordinatorAssignments.isCurrent, true))),
    db.insert(coordinatorAssignments).values({ clientId, coordinatorId, assignedBy: user.id }),
    ...(previous ? [db.insert(coordinatorReassignments).values({ clientId, fromCoordinatorId: previous, toCoordinatorId: coordinatorId, reason, doneBy: user.id })] : []),
    db.update(clients).set({ assignedCoordinatorId: coordinatorId }).where(eq(clients.id, clientId)),
    db
      .update(tickets)
      .set({ coordinatorId, status: pending })
      .where(and(eq(tickets.clientId, clientId), notInArray(tickets.status, [...CLOSED_STATUSES]))),
    // Bookings follow their tickets: upcoming sessions, and the sessions of every open ticket (a session that took place but
    // whose notes are still due belongs to the new coordinator too, or they could not see it).
    db
      .update(bookings)
      .set({ coordinatorId })
      .where(
        and(
          eq(bookings.clientId, clientId),
          or(
            and(eq(bookings.status, 'scheduled'), gt(bookings.startTime, new Date())),
            inArray(bookings.id, db.select({ id: tickets.bookingId }).from(tickets).where(and(eq(tickets.clientId, clientId), notInArray(tickets.status, [...CLOSED_STATUSES])))),
          ),
        ),
      ),
    ...(ticket
      ? [db.update(tickets).set({ coordinatorId, status: pending }).where(eq(tickets.id, ticket.id)), db.update(bookings).set({ coordinatorId }).where(eq(bookings.id, ticket.bookingId))]
      : []),
  ]);

  const [from] = previous ? await db.select().from(coordinators).where(eq(coordinators.id, previous)) : [];
  await audit(user, previous ? 'client.reassigned' : 'client.assigned', 'client', clientId, { coordinator: from?.name ?? 'Unassigned' }, { coordinator: coordinator.name, ...(reason && { reason }) });

  // Tell the coordinator who has the client now, and the one who had them.
  const [{ open }] = await db.select({ open: count() }).from(tickets).where(and(eq(tickets.clientId, clientId), eq(tickets.coordinatorId, coordinatorId), notInArray(tickets.status, [...CLOSED_STATUSES])));
  const mail: Omit<AssignmentMail, 'coordinatorName'> = {
    brand: settings.brand.name,
    clientName: client.personName,
    companyName: client.companyName,
    email: client.email,
    phone: client.phone,
    openTickets: open,
    by: user.name,
    reason: reason || undefined,
  };
  await sendAll([
    sendMail('internal', { to: coordinator.email, ...clientAssigned({ ...mail, coordinatorName: coordinator.name, otherCoordinator: from?.name }) }),
    ...(from?.email ? [sendMail('internal', { to: from.email, ...clientReassignedAway({ ...mail, coordinatorName: from.name, otherCoordinator: coordinator.name }) })] : []),
  ]);
  return { previous: from?.name ?? null, coordinator: coordinator.name };
}
