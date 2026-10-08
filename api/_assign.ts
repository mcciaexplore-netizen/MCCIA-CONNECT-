import { and, count, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { audit, db, HttpError, loadSettings, type Actor } from './_lib.js';
import { companyOf } from './_companies.js';
import { updateSheet } from './_live_excel.js';
import { sendMail } from './_integrations.js';
import { clientAssigned, clientAutoAssigned, clientReassignedAway, formatWhen, type AssignmentMail } from './_mail.js';
import { inBackground, sendAll } from './_sessions.js';
import { adminNotifications, bookings, clients, companies, coordinatorAssignments, coordinatorReassignments, coordinators, tickets } from './_schema.js';
import { CLOSED_STATUSES, MIN_REASON_LENGTH, type StudioZone } from '../src/types/index.js';

/** The sessions booked with a stand-in because the company's coordinator was busy: they stay with the stand-in when a company is reassigned. */
const standInSessions = () => db.select({ id: tickets.bookingId }).from(tickets).where(isNotNull(tickets.followUpCoordinatorId));

/**
 * The coordinator cannot take on sessions that overlap their own, or each other: a coordinator is never in two places at once.
 * Every upcoming session of the company's clients moves with them, so those are the ones checked (the coordinator's other clients' sessions are theirs already).
 */
async function ensureNoClash(coordinator: { id: string; name: string }, clientIds: string[], zone: StudioZone) {
  const live = and(ne(bookings.status, 'cancelled'), gt(bookings.endTime, new Date()));
  const [moving, theirs] = await Promise.all([
    db.select({ start: bookings.startTime, end: bookings.endTime }).from(bookings).where(and(inArray(bookings.clientId, clientIds), live, notInArray(bookings.id, standInSessions()))),
    db.select({ start: bookings.startTime, end: bookings.endTime }).from(bookings).where(and(eq(bookings.coordinatorId, coordinator.id), notInArray(bookings.clientId, clientIds), live)),
  ]);
  const overlap = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && a.end > b.start;
  const double = moving.find((session, i) => moving.slice(0, i).some((other) => overlap(session, other)));
  if (double) throw new HttpError(409, `This company has two sessions at ${formatWhen(double.start, zone)}, and one coordinator cannot take both. Move or cancel one of them first.`);
  const clash = moving.find((session) => theirs.some((t) => overlap(session, t)));
  if (clash) throw new HttpError(409, `${coordinator.name} already has a session at ${formatWhen(clash.start, zone)}. A coordinator cannot take two sessions at the same time.`);
}

interface AssignOptions {
  /** The booking form gave a brand-new company its coordinator (the one with the fewest sessions that month). `firstBooking`: it was the company's first booking. */
  auto?: { firstBooking: boolean };
}

/**
 * A company belongs to one coordinator, and so does every client in it. Assigning (no coordinator yet) or reassigning (a reason of 20+
 * characters) moves the open tickets and upcoming sessions of ALL the company's clients to the new coordinator, records the history,
 * and emails both coordinators. Every way of assigning goes through here: the client page, a ticket's Assign/Reassign, bulk assign, the
 * dashboard's "Assign Now" and the booking form's automatic assignment, so a company's next booking is assigned to the same coordinator.
 * `ticket` (when assigning from a ticket) is moved too, even if it is closed; its coordinator counts as the previous one when the
 * company had none of its own.
 */
export async function assignClient(
  actor: Actor & { id?: string },
  clientId: string,
  coordinatorId: string,
  reason: string,
  ticket?: { id: string; bookingId: string; coordinatorId: string | null },
  { auto }: AssignOptions = {},
) {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new HttpError(404, 'Client not found');
  const [coordinator] = await db.select().from(coordinators).where(eq(coordinators.id, coordinatorId));
  if (!coordinator?.isActive) throw new HttpError(400, 'Coordinator not found or inactive');

  const company = await companyOf(client);
  const members = await db.select().from(clients).where(eq(clients.companyId, company.id));
  const memberIds = members.map((m) => m.id);
  if (company.assignedCoordinatorId === coordinatorId && client.assignedCoordinatorId === coordinatorId) throw new HttpError(400, 'This coordinator is already assigned');

  const settings = await loadSettings();
  await ensureNoClash(coordinator, memberIds, settings.timezone);

  const previous = company.assignedCoordinatorId ?? client.assignedCoordinatorId ?? ticket?.coordinatorId ?? null;
  if (previous && !auto && reason.length < MIN_REASON_LENGTH) throw new HttpError(400, `Give a reason of at least ${MIN_REASON_LENGTH} characters to reassign a client`);

  const pending = sql`case when ${tickets.status} = 'new' then 'pending' else ${tickets.status} end`;
  await db.batch([
    db.update(coordinatorAssignments).set({ isCurrent: false }).where(and(inArray(coordinatorAssignments.clientId, memberIds), eq(coordinatorAssignments.isCurrent, true))),
    db.insert(coordinatorAssignments).values(memberIds.map((id) => ({ clientId: id, coordinatorId, assignedBy: actor.id ?? null }))),
    ...(previous ? [db.insert(coordinatorReassignments).values({ clientId, companyId: company.id, fromCoordinatorId: previous, toCoordinatorId: coordinatorId, reason, doneBy: actor.id ?? null })] : []),
    db.update(companies).set({ assignedCoordinatorId: coordinatorId }).where(eq(companies.id, company.id)),
    db.update(clients).set({ assignedCoordinatorId: coordinatorId }).where(inArray(clients.id, memberIds)),
    // Open tickets of every client in the company move now (except a stand-in's: that session stays with them).
    db
      .update(tickets)
      .set({ coordinatorId, status: pending })
      .where(and(inArray(tickets.clientId, memberIds), notInArray(tickets.status, [...CLOSED_STATUSES]), isNull(tickets.followUpCoordinatorId))),
    // Tickets still waiting to go back to the old coordinator (a stand-in held the session) will go back to the new one instead.
    db.update(tickets).set({ followUpCoordinatorId: coordinatorId }).where(and(inArray(tickets.clientId, memberIds), sql`${tickets.followUpCoordinatorId} is not null`)),
    // Bookings follow their tickets: upcoming sessions, and the sessions of every open ticket (a session that took place but
    // whose notes are still due belongs to the new coordinator too, or they could not see it).
    db
      .update(bookings)
      .set({ coordinatorId })
      .where(
        and(
          inArray(bookings.clientId, memberIds),
          or(
            and(eq(bookings.status, 'scheduled'), gt(bookings.startTime, new Date())),
            inArray(bookings.id, db.select({ id: tickets.bookingId }).from(tickets).where(and(inArray(tickets.clientId, memberIds), notInArray(tickets.status, [...CLOSED_STATUSES])))),
          ),
          notInArray(bookings.id, standInSessions()),
        ),
      ),
    ...(ticket
      ? [db.update(tickets).set({ coordinatorId, followUpCoordinatorId: null, status: pending }).where(eq(tickets.id, ticket.id)), db.update(bookings).set({ coordinatorId }).where(eq(bookings.id, ticket.bookingId))]
      : []),
  ]);

  updateSheet((await db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.clientId, memberIds))).map((t) => t.id)); // the company's rows in the Excel sheet (their coordinator)
  const [from] = previous ? await db.select().from(coordinators).where(eq(coordinators.id, previous)) : [];
  if (auto) {
    await audit(actor, 'client.auto_assigned', 'client', clientId, undefined, {
      message: `Auto-assigned to ${coordinator.name} (least bookings this month)`,
      company: company.name,
      coordinator: coordinator.name,
    });
    await db.insert(adminNotifications).values({
      message: `${company.name} auto-assigned to ${coordinator.name} (${auto.firstBooking ? 'first booking from this company' : 'the company had no coordinator'})`,
      companyId: company.id,
    });
  } else {
    await audit(actor, previous ? 'client.reassigned' : 'client.assigned', 'client', clientId, { coordinator: from?.name ?? 'Unassigned' }, {
      coordinator: coordinator.name,
      company: company.name,
      ...(members.length > 1 && { clients: members.length }),
      ...(reason && { reason }),
    });
  }

  // Tell the coordinator who has the company now, and the one who had it (not someone assigning themselves).
  const [{ open }] = await db.select({ open: count() }).from(tickets).where(and(inArray(tickets.clientId, memberIds), eq(tickets.coordinatorId, coordinatorId), notInArray(tickets.status, [...CLOSED_STATUSES])));
  const mail: Omit<AssignmentMail, 'coordinatorName'> = {
    brand: settings.brand.name,
    clientName: client.personName,
    companyName: company.name,
    email: client.email,
    phone: client.phone,
    openTickets: open,
    by: actor.name,
    reason: reason || undefined,
  };
  inBackground(`Emailing about ${company.name}'s new coordinator`, () =>
    sendAll([
      ...(actor.id && actor.id === coordinator.authUserId
        ? []
        : [sendMail('internal', { to: coordinator.email, ...(auto ? clientAutoAssigned({ ...mail, coordinatorName: coordinator.name }) : clientAssigned({ ...mail, coordinatorName: coordinator.name, otherCoordinator: from?.name })) })]),
      ...(from?.email ? [sendMail('internal', { to: from.email, ...clientReassignedAway({ ...mail, coordinatorName: from.name, otherCoordinator: coordinator.name }) })] : []),
    ]),
  );
  return { previous: from?.name ?? null, coordinator: coordinator.name };
}
