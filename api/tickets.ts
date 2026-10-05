import { desc, eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, loadPostQuestions, needString, optString, ownedBy, readBody, requireUser, type AuthUser } from './_lib.js';
import { bookings, coordinatorReassignments, coordinators, tickets } from './_schema.js';
import { MIN_REASON_LENGTH, TICKET_STATUSES, type TicketStatus } from '../src/types/index.js';

const MAX_BULK = 100;

/**
 * Applies status / coordinatorId (+ reason) / dueDate / note / postConsultation to one ticket (checking this user may),
 * logs it, returns the ticket. Changing one coordinator for another needs a reason, which is also recorded in
 * coordinator_reassignments.
 */
async function updateTicket(user: AuthUser, id: string, body: Record<string, unknown>) {
  const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
  if (!ticket) throw new HttpError(404, 'Ticket not found');
  if (user.role !== 'super_admin' && ticket.coordinatorId !== user.coordinatorId) throw new HttpError(403, 'This ticket is not assigned to you');

  const patch: Partial<typeof tickets.$inferInsert> = {};
  const bookingPatch: Partial<typeof bookings.$inferInsert> = {};
  let reassignment: typeof coordinatorReassignments.$inferInsert | undefined;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (body.status !== undefined && body.status !== ticket.status) {
    if (!TICKET_STATUSES.includes(body.status as TicketStatus)) throw new HttpError(400, 'Invalid status');
    if (ticket.status === 'cancelled') throw new HttpError(400, 'A cancelled ticket cannot be reopened');
    patch.status = body.status as TicketStatus;
    before.status = ticket.status;
    after.status = patch.status;
    // Cancelling frees the booked time; completing marks the session done.
    if (patch.status === 'cancelled' || patch.status === 'completed') bookingPatch.status = patch.status;
  }

  if (body.coordinatorId !== undefined) {
    if (user.role !== 'super_admin') throw new HttpError(403, 'Only admins can assign tickets');
    const newId = typeof body.coordinatorId === 'string' && body.coordinatorId ? body.coordinatorId : null;
    if (newId !== ticket.coordinatorId) {
      const names = new Map((await db.select({ id: coordinators.id, name: coordinators.name, isActive: coordinators.isActive }).from(coordinators)).map((c) => [c.id, c]));
      if (newId && !names.get(newId)?.isActive) throw new HttpError(400, 'Coordinator not found or inactive');
      if (newId && ticket.coordinatorId) {
        const reason = optString(body.reason);
        if (reason.length < MIN_REASON_LENGTH) throw new HttpError(400, `Give a reason of at least ${MIN_REASON_LENGTH} characters to reassign a ticket that already has a coordinator`);
        reassignment = { clientId: ticket.clientId, fromCoordinatorId: ticket.coordinatorId, toCoordinatorId: newId, reason, doneBy: user.id };
        after.reason = reason;
      }
      patch.coordinatorId = newId;
      bookingPatch.coordinatorId = newId;
      before.coordinator = (ticket.coordinatorId && names.get(ticket.coordinatorId)?.name) || 'Unassigned';
      after.coordinator = (newId && names.get(newId)?.name) || 'Unassigned';
      if (newId && ticket.status === 'new' && !patch.status) {
        patch.status = 'pending';
        before.status = ticket.status;
        after.status = 'pending';
      }
    }
  }

  if (body.dueDate !== undefined) {
    const due = body.dueDate ? new Date(String(body.dueDate)) : null;
    if (due && Number.isNaN(due.getTime())) throw new HttpError(400, 'Invalid due date');
    patch.dueDate = due;
    before.dueDate = ticket.dueDate?.toISOString() ?? null;
    after.dueDate = due?.toISOString() ?? null;
  }

  if (body.note !== undefined) {
    const text = needString(body.note, 'Note');
    patch.internalNotes = [...ticket.internalNotes, { text, author: user.name, at: new Date().toISOString() }];
    after.note = text;
  }

  if (body.postConsultation !== undefined) {
    // Keep only the module's own questions, enforce required ones, and check select / radio / number values.
    const given = (body.postConsultation ?? {}) as Record<string, unknown>;
    const answers: Record<string, string> = {};
    for (const q of (await loadPostQuestions())(ticket.moduleId)) {
      const value = optString(given[q.id]);
      if (q.required && !value) throw new HttpError(400, `"${q.label}" is required`);
      if (value && (q.type === 'select' || q.type === 'radio') && !q.options.includes(value)) throw new HttpError(400, `"${q.label}": choose one of the listed options`);
      if (value && q.type === 'number' && Number.isNaN(Number(value))) throw new HttpError(400, `"${q.label}" must be a number`);
      if (value) answers[q.id] = value;
    }
    patch.postConsultationData = answers;
    before.postConsultation = Object.keys(ticket.postConsultationData).length ? 'filled' : 'empty';
    after.postConsultation = 'saved';
  }

  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');

  const update = db.update(tickets).set(patch).where(eq(tickets.id, id)).returning();
  const syncBooking = Object.keys(bookingPatch).length > 0;
  const [[updated]] = await db.batch([
    update,
    ...(syncBooking ? [db.update(bookings).set(bookingPatch).where(eq(bookings.id, ticket.bookingId))] : []),
    ...(reassignment ? [db.insert(coordinatorReassignments).values(reassignment)] : []),
  ]);

  await audit(user, after.postConsultation ? 'ticket.post_consultation' : 'ticket.updated', 'ticket', id, before, after);
  return updated;
}

export default handler({
  // Admins see every ticket, coordinators only the ones assigned to them.
  GET: async (req) => {
    const user = await requireUser(req);
    return await db.select().from(tickets).where(ownedBy(user, tickets.coordinatorId)).orderBy(desc(tickets.createdAt));
  },

  // One ticket: { id, status?, coordinatorId?, reason?, dueDate?, note?, postConsultation? } returns the ticket.
  // (reason is needed when a ticket's coordinator is replaced by another one.)
  // Many tickets: { ids: [...], status?, coordinatorId? } returns { updated, failed: [{ id, error }] };
  // a ticket that cannot be changed (not yours, cancelled, nothing to change) is skipped, not fatal.
  PATCH: async (req) => {
    const user = await requireUser(req);
    const body = await readBody(req);
    if (!Array.isArray(body.ids)) return await updateTicket(user, needString(body.id, 'Ticket'), body);

    if (!body.ids.length || body.ids.length > MAX_BULK) throw new HttpError(400, `Choose between 1 and ${MAX_BULK} tickets`);
    if (body.dueDate !== undefined || body.note !== undefined) throw new HttpError(400, 'Bulk updates only change status or coordinator');
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    for (const id of body.ids.map(String)) {
      try {
        await updateTicket(user, id, body);
        updated++;
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        failed.push({ id, error: e.message });
      }
    }
    return { updated, failed };
  },
});
