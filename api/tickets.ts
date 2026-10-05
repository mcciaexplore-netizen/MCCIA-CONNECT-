import { and, desc, eq, gt } from 'drizzle-orm';
import { assignClient } from './_assign.js';
import { audit, db, handler, HttpError, loadPostQuestions, loadSettings, needString, optString, ownedBy, readBody, requireUser, UUID, type AuthUser } from './_lib.js';
import { cancelSession } from './_sessions.js';
import { bookings, clients, coordinators, feedbackTokens, modules, tickets } from './_schema.js';
import { FEEDBACK_COMMENTS, FEEDBACK_FIELDS, MAX_FEEDBACK_COMMENTS, MIN_REASON_LENGTH, TICKET_STATUSES, type FeedbackForm, type TicketStatus } from '../src/types/index.js';

const MAX_BULK = 100;
const NOTHING = 'Nothing to update';

/**
 * Applies status / coordinatorId (+ reason) / dueDate / note / postConsultation to one ticket (checking this user may),
 * logs it, returns the ticket. A coordinator is assigned to the ticket's CLIENT (see _assign.ts): their open tickets and
 * future bookings follow, and so will their next booking. Replacing one coordinator with another needs a reason.
 * Cancelling removes the Calendar event and tells the client and the coordinator.
 */
async function updateTicket(user: AuthUser, id: string, body: Record<string, unknown>) {
  const [ticket] = UUID.test(id) ? await db.select().from(tickets).where(eq(tickets.id, id)) : [];
  if (!ticket) throw new HttpError(404, 'Ticket not found');
  if (user.role !== 'super_admin' && ticket.coordinatorId !== user.coordinatorId) throw new HttpError(403, 'This ticket is not assigned to you');

  const patch: Partial<typeof tickets.$inferInsert> = {};
  const bookingPatch: Partial<typeof bookings.$inferInsert> = {};
  let toClient: { coordinatorId: string; reason: string } | undefined; // assign the ticket's client (after the ticket's own changes)
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
      const [client] = await db.select({ assignedCoordinatorId: clients.assignedCoordinatorId }).from(clients).where(eq(clients.id, ticket.clientId));
      const reason = optString(body.reason);
      // Someone else already had this ticket or this client: say why they are replaced.
      const replacing = Boolean(ticket.coordinatorId) || Boolean(newId && client?.assignedCoordinatorId && client.assignedCoordinatorId !== newId);
      if (newId && replacing && reason.length < MIN_REASON_LENGTH) throw new HttpError(400, `Give a reason of at least ${MIN_REASON_LENGTH} characters to reassign a ticket that already has a coordinator`);
      if (newId && client?.assignedCoordinatorId !== newId) {
        toClient = { coordinatorId: newId, reason };
      } else {
        // Unassigning, or handing the ticket to the coordinator the client already has: only this ticket changes.
        patch.coordinatorId = newId;
        bookingPatch.coordinatorId = newId;
        if (newId && ticket.status === 'new' && !patch.status) {
          patch.status = 'pending';
          before.status = ticket.status;
          after.status = 'pending';
        }
      }
      before.coordinator = (ticket.coordinatorId && names.get(ticket.coordinatorId)?.name) || 'Unassigned';
      after.coordinator = (newId && names.get(newId)?.name) || 'Unassigned';
      if (newId && replacing) after.reason = reason;
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

  if (!Object.keys(patch).length && !toClient) throw new HttpError(400, NOTHING);

  if (Object.keys(patch).length) {
    await db.batch([
      db.update(tickets).set(patch).where(eq(tickets.id, id)),
      ...(Object.keys(bookingPatch).length ? [db.update(bookings).set(bookingPatch).where(eq(bookings.id, ticket.bookingId))] : []),
    ]);
  }
  if (toClient) await assignClient(user, ticket.clientId, toClient.coordinatorId, toClient.reason, { id, bookingId: ticket.bookingId });

  await audit(user, after.postConsultation ? 'ticket.post_consultation' : 'ticket.updated', 'ticket', id, before, after);
  if (patch.status === 'cancelled') await cancelSession(user, ticket.bookingId);
  const [updated] = await db.select().from(tickets).where(eq(tickets.id, id));
  return updated;
}

// ---------- the client's feedback page (/feedback/:token, no login) ----------

/** A feedback link that can still be used: the token row with its ticket, session, client and module. */
async function openFeedback(token: string) {
  const [row] = UUID.test(token)
    ? await db
        .select({ link: feedbackTokens, ticket: tickets, booking: bookings, client: clients, module: modules })
        .from(feedbackTokens)
        .innerJoin(tickets, eq(tickets.id, feedbackTokens.ticketId))
        .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
        .innerJoin(clients, eq(clients.id, tickets.clientId))
        .innerJoin(modules, eq(modules.id, tickets.moduleId))
        .where(eq(feedbackTokens.token, token))
    : [];
  if (!row) throw new HttpError(404, 'This feedback link is not valid');
  if (row.link.used || FEEDBACK_FIELDS.some((f) => row.ticket.feedbackData[f.key])) throw new HttpError(410, 'Thank you, your feedback has already been received');
  if (row.link.expiresAt.getTime() < Date.now()) throw new HttpError(410, 'This feedback link has expired. Please ask the studio for a new one.');
  return row;
}

/** { ratings: { understanding: 1-5, ... }, comments? }: saves the client's ratings on the ticket and uses up the link. */
async function saveFeedback(token: string, body: Record<string, unknown>) {
  const row = await openFeedback(token);
  const given = (body.ratings ?? {}) as Record<string, unknown>;
  const feedback: Record<string, string> = {};
  for (const field of FEEDBACK_FIELDS) {
    const stars = Number(given[field.key]);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, `Please rate "${field.question}" from 1 to 5`);
    feedback[field.key] = String(stars);
  }
  const comments = optString(body.comments);
  if (comments.length > MAX_FEEDBACK_COMMENTS) throw new HttpError(400, `Please keep your comments under ${MAX_FEEDBACK_COMMENTS} characters`);
  if (comments) feedback[FEEDBACK_COMMENTS] = comments;

  // Only one submission per link, even if the form is sent twice at once.
  const [claimed] = await db.update(feedbackTokens).set({ used: true }).where(and(eq(feedbackTokens.id, row.link.id), eq(feedbackTokens.used, false), gt(feedbackTokens.expiresAt, new Date()))).returning();
  if (!claimed) throw new HttpError(410, 'Thank you, your feedback has already been received');
  await db.update(tickets).set({ feedbackData: feedback }).where(eq(tickets.id, row.ticket.id));
  await audit({ name: `${row.client.personName} (feedback form)`, role: 'client' }, 'feedback.received', 'ticket', row.ticket.id, undefined, feedback);
  return { ok: true };
}

const feedbackToken = (url: URL) => url.searchParams.get('feedback') ?? /^\/api\/feedback\/([^/]+)\/?$/.exec(url.pathname)?.[1];

export default handler({
  // Admins see every ticket, coordinators only the ones assigned to them. /api/feedback/:token (a rewrite to ?feedback=) is the public feedback form.
  GET: async (req, url) => {
    const token = feedbackToken(url);
    if (token) {
      const { ticket, booking, client, module } = await openFeedback(token);
      const settings = await loadSettings();
      const form: FeedbackForm = { brand: settings.brand.name, clientName: client.personName, moduleName: module.name, ticketNumber: ticket.ticketNumber, sessionAt: booking.startTime.toISOString(), zone: settings.timezone };
      return form;
    }
    const user = await requireUser(req);
    return await db.select().from(tickets).where(ownedBy(user, tickets.coordinatorId)).orderBy(desc(tickets.createdAt));
  },

  // The feedback form's submission (public, the token is the permission).
  POST: async (req, url) => {
    const token = feedbackToken(url);
    if (!token) throw new HttpError(404, 'Not found');
    return await saveFeedback(token, await readBody(req));
  },

  // One ticket: { id, status?, coordinatorId?, reason?, dueDate?, note?, postConsultation? } returns the ticket.
  // (reason is needed when a ticket's or its client's coordinator is replaced by another one.)
  // Many tickets: { ids: [...], status?, coordinatorId? } returns { updated, failed: [{ id, error }] };
  // a ticket that cannot be changed (not yours, cancelled, needs a reason, nothing to change) is skipped, not fatal.
  // Assigning a coordinator assigns the ticket's client, so a ticket moved along with an earlier one of the same client counts as updated.
  PATCH: async (req) => {
    const user = await requireUser(req);
    const body = await readBody(req);
    if (!Array.isArray(body.ids)) return await updateTicket(user, needString(body.id, 'Ticket'), body);

    if (!body.ids.length || body.ids.length > MAX_BULK) throw new HttpError(400, `Choose between 1 and ${MAX_BULK} tickets`);
    if (body.dueDate !== undefined || body.note !== undefined) throw new HttpError(400, 'Bulk updates only change status or coordinator');
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    const moved = new Set<string>(); // clients this request has just assigned: their other tickets moved along with them
    for (const id of body.ids.map(String)) {
      try {
        const ticket = await updateTicket(user, id, body);
        if (body.coordinatorId) moved.add(ticket.clientId);
        updated++;
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        const [ticket] = e.message === NOTHING && UUID.test(id) ? await db.select({ clientId: tickets.clientId, coordinatorId: tickets.coordinatorId }).from(tickets).where(eq(tickets.id, id)) : [];
        if (ticket && moved.has(ticket.clientId) && ticket.coordinatorId === body.coordinatorId) updated++;
        else failed.push({ id, error: e.message });
      }
    }
    return { updated, failed };
  },
});
