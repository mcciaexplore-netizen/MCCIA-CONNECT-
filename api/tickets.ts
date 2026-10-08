import { and, desc, eq, getTableColumns, gt, gte, inArray, lt } from 'drizzle-orm';
import { assignClient } from './_assign.js';
import { clashesOf, studioTime } from './_availability.js';
import { returnFollowUps } from './_companies.js';
import { saveRecordings } from './_fireflies.js';
import { clearSheetRows, updateSheet } from './_live_excel.js';
import { audit, db, handler, HttpError, loadPostQuestions, loadSettings, needString, optString, ownedBy, readBody, requireUser, siteOrigin, UUID, type AuthUser } from './_lib.js';
import { runScheduled } from './_scheduled.js';
import { cancelSession, inBackground, loadBooking, removeCalendarEvents } from './_sessions.js';
import { bookings, clients, companies, coordinators, feedbackTokens, modules, tickets } from './_schema.js';
import { answerProblem, FEEDBACK_COMMENTS, FEEDBACK_FIELDS, MAX_FEEDBACK_COMMENTS, MIN_REASON_LENGTH, PAYMENT_STATUSES, TICKET_FIELDS, TICKET_STATUSES, type FeedbackForm, type PaymentStatus, type TicketStatus } from '../src/types/index.js';

const MAX_BULK = 100;
const MAX_BULK_CANCEL = 20; // each cancellation calls Google and sends emails afterwards, so a big batch could outlast the function
const NOTHING = 'Nothing to update';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 24 * 60 * 60_000;
// A ticket as the browser gets it: every column but the Fireflies transcript, which is long and is read on its own (?transcript=<id>).
const { transcript: _transcript, ...TICKET_COLUMNS } = getTableColumns(tickets);

/**
 * Applies status / coordinatorId (+ reason) / dueDate / note / postConsultation to one ticket (checking this user may),
 * logs it, returns the ticket. A coordinator is assigned to the ticket's CLIENT (see _assign.ts): their open tickets and
 * future bookings follow, and so will their next booking. Replacing one coordinator with another needs a reason.
 * Cancelling removes the Calendar event and tells the client and the coordinator.
 */
async function updateTicket(user: AuthUser, id: string, body: Record<string, unknown>, siteUrl: string) {
  await returnFollowUps();
  const [ticket] = UUID.test(id) ? await db.select(TICKET_COLUMNS).from(tickets).where(eq(tickets.id, id)) : [];
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
      // The coordinator the ticket's company already has (the company decides; the client's own is the fallback).
      const [owner] = await db
        .select({ company: companies.assignedCoordinatorId, client: clients.assignedCoordinatorId })
        .from(clients)
        .leftJoin(companies, eq(companies.id, clients.companyId))
        .where(eq(clients.id, ticket.clientId));
      const heldBy = owner?.company ?? owner?.client ?? null;
      const reason = optString(body.reason);
      // Someone else already had this ticket or this company: say why they are replaced.
      const replacing = Boolean(ticket.coordinatorId) || Boolean(newId && heldBy && heldBy !== newId);
      if (newId && replacing && reason.length < MIN_REASON_LENGTH) throw new HttpError(400, `Give a reason of at least ${MIN_REASON_LENGTH} characters to reassign a ticket that already has a coordinator`);
      if (newId && heldBy !== newId) {
        toClient = { coordinatorId: newId, reason };
      } else {
        // Unassigning, or handing the ticket to the coordinator its company already has: only this ticket changes. That coordinator must be free then too.
        if (newId) {
          const [session] = await db.select({ start: bookings.startTime, end: bookings.endTime }).from(bookings).where(eq(bookings.id, ticket.bookingId));
          if (session && session.end > new Date() && (await clashesOf(newId, session.start, session.end, ticket.bookingId)).length) {
            throw new HttpError(409, `${names.get(newId)?.name} already has a session at that time. A coordinator cannot take two sessions at the same time.`);
          }
        }
        patch.coordinatorId = newId;
        patch.followUpCoordinatorId = null;
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

  // Payment is recorded by hand, by an admin (Paid / Unpaid / Waived).
  const payment = body.paymentStatus ?? body.payment_status;
  if (payment !== undefined && payment !== ticket.paymentStatus) {
    if (user.role !== 'super_admin') throw new HttpError(403, 'Only admins can set the payment');
    if (!PAYMENT_STATUSES.includes(payment as PaymentStatus)) throw new HttpError(400, 'Payment must be paid, unpaid or waived');
    patch.paymentStatus = payment as PaymentStatus;
    before.payment = ticket.paymentStatus;
    after.payment = payment;
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
      if (q.id in TICKET_FIELDS) continue; // status and payment are the ticket's own: the form sends them as `status` / `paymentStatus`, with their own rules
      const value = optString(given[q.id]);
      if (q.required && !value) throw new HttpError(400, `"${q.label}" is required`);
      const problem = value ? answerProblem(q, value) : undefined;
      if (problem === 'option') throw new HttpError(400, `"${q.label}": choose ${q.type === 'checkbox' ? 'from' : 'one of'} the listed options`);
      if (problem === 'url') throw new HttpError(400, `"${q.label}" must be a web address starting with http:// or https://`);
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
  if (toClient) await assignClient(user, ticket.clientId, toClient.coordinatorId, toClient.reason, { id, bookingId: ticket.bookingId, coordinatorId: ticket.coordinatorId });

  await audit(user, after.postConsultation ? 'ticket.post_consultation' : 'ticket.updated', 'ticket', id, before, after);
  // Google and the emails follow the answer.
  if (patch.status === 'cancelled') inBackground(`Removing the calendar event and emailing about ${ticket.ticketNumber}`, () => cancelSession(user, ticket.bookingId, siteUrl));
  const [updated] = await db.select(TICKET_COLUMNS).from(tickets).where(eq(tickets.id, id));
  updateSheet([id]); // its row in the Excel sheet
  return updated;
}

/**
 * POST { action: 'fetch-recording', ticketId, force? }: asks Fireflies for the ticket's recording and saves it if it is ready (see _fireflies.ts).
 * Always answers 200 { found, problem? }: opening a ticket asks quietly, and "problem" is only shown when the person pressed the button.
 */
async function checkRecording(user: AuthUser, body: Record<string, unknown>) {
  const id = needString(body.ticketId, 'Ticket');
  const [ticket] = UUID.test(id) ? await db.select({ bookingId: tickets.bookingId, coordinatorId: tickets.coordinatorId }).from(tickets).where(eq(tickets.id, id)) : [];
  if (!ticket || (user.role !== 'super_admin' && ticket.coordinatorId !== user.coordinatorId)) throw new HttpError(404, 'Ticket not found');
  return await saveRecordings({ bookingId: ticket.bookingId, force: body.force === true });
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
  updateSheet([row.ticket.id]); // the ratings go to its row in the Excel sheet
  await audit({ name: `${row.client.personName} (feedback form)`, role: 'client' }, 'feedback.received', 'ticket', row.ticket.id, undefined, feedback);
  return { ok: true };
}

const feedbackToken = (url: URL) => url.searchParams.get('feedback') ?? /^\/api\/feedback\/([^/]+)\/?$/.exec(url.pathname)?.[1];

export default handler({
  // Admins see every ticket, coordinators only the ones assigned to them. /api/feedback/:token (a rewrite to ?feedback=) is the public feedback form.
  // ?action=send-reminders is the daily job (see _scheduled.ts). ?date_from= and ?date_to= (YYYY-MM-DD, studio time) keep only the
  // tickets whose session starts in that range. ?feedback is the client's feedback form (public).
  GET: async (req, url) => {
    if (url.searchParams.get('action') === 'send-reminders') return await runScheduled(req, siteOrigin(req));
    const token = feedbackToken(url);
    if (token) {
      const { ticket, booking, client, module } = await openFeedback(token);
      const settings = await loadSettings();
      const form: FeedbackForm = { brand: settings.brand.name, clientName: client.personName, moduleName: module.name, ticketNumber: ticket.ticketNumber, sessionAt: booking.startTime.toISOString(), zone: settings.timezone };
      return form;
    }
    const user = await requireUser(req);
    // ?transcript=<ticket>: the Fireflies transcript of one ticket (an admin's, or the coordinator's own).
    const transcriptOf = url.searchParams.get('transcript');
    if (transcriptOf) {
      const [row] = UUID.test(transcriptOf) ? await db.select({ transcript: tickets.transcript }).from(tickets).where(and(eq(tickets.id, transcriptOf), ownedBy(user, tickets.coordinatorId))) : [];
      if (!row) throw new HttpError(404, 'Ticket not found');
      return { transcript: row.transcript };
    }
    await returnFollowUps();
    const from = url.searchParams.get('date_from');
    const to = url.searchParams.get('date_to');
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new HttpError(400, 'date_from and date_to must be dates like 2026-10-12');
    const { tz } = from || to ? (await loadSettings()).timezone : { tz: '' };
    const inRange = from || to
      ? inArray(
          tickets.bookingId,
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(and(from ? gte(bookings.startTime, new Date(studioTime(from, '00:00', tz))) : undefined, to ? lt(bookings.startTime, new Date(studioTime(to, '00:00', tz) + DAY)) : undefined)),
        )
      : undefined;
    return await db.select(TICKET_COLUMNS).from(tickets).where(and(ownedBy(user, tickets.coordinatorId), inRange)).orderBy(desc(tickets.createdAt));
  },

  // The feedback form's submission (public, the token is the permission), or staff's { action: 'fetch-recording' }.
  POST: async (req, url) => {
    const token = feedbackToken(url);
    if (token) return await saveFeedback(token, await readBody(req));
    const user = await requireUser(req);
    const body = await readBody(req);
    if (body.action === 'fetch-recording') return await checkRecording(user, body);
    throw new HttpError(404, 'Not found');
  },

  // One ticket: { id, status?, coordinatorId?, reason?, dueDate?, note?, postConsultation? } returns the ticket.
  // (reason is needed when a ticket's or its client's coordinator is replaced by another one.)
  // Many tickets: { ids: [...], status?, coordinatorId? } returns { updated, failed: [{ id, error }] };
  // a ticket that cannot be changed (not yours, cancelled, needs a reason, nothing to change) is skipped, not fatal.
  // Assigning a coordinator assigns the ticket's client, so a ticket moved along with an earlier one of the same client counts as updated.
  PATCH: async (req) => {
    const user = await requireUser(req);
    const body = await readBody(req);
    const siteUrl = siteOrigin(req);
    if (!Array.isArray(body.ids)) return await updateTicket(user, needString(body.id, 'Ticket'), body, siteUrl);

    if (!body.ids.length || body.ids.length > MAX_BULK) throw new HttpError(400, `Choose between 1 and ${MAX_BULK} tickets`);
    if (body.dueDate !== undefined || body.note !== undefined || body.paymentStatus !== undefined || body.payment_status !== undefined) throw new HttpError(400, 'Bulk updates only change status or coordinator');
    if (body.status === 'cancelled' && body.ids.length > MAX_BULK_CANCEL) throw new HttpError(400, `Cancel at most ${MAX_BULK_CANCEL} sessions at a time`);
    const failed: { id: string; error: string }[] = [];
    let updated = 0;
    const moved = new Set<string>(); // clients this request has just assigned: their other tickets moved along with them
    for (const id of body.ids.map(String)) {
      try {
        const ticket = await updateTicket(user, id, body, siteUrl);
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

  // ?id=<ticket> (admins only): removes the ticket for good together with its booking and feedback link, and its Calendar event.
  // The client is not emailed (cancelling is what tells them); the audit log keeps a record of what was deleted.
  DELETE: async (req, url) => {
    const user = await requireUser(req, 'super_admin');
    const id = url.searchParams.get('id') ?? '';
    const [ticket] = UUID.test(id) ? await db.select().from(tickets).where(eq(tickets.id, id)) : [];
    const row = ticket && (await loadBooking(ticket.bookingId));
    if (!row) throw new HttpError(404, 'Ticket not found');

    await db.batch([
      db.delete(feedbackTokens).where(eq(feedbackTokens.ticketId, id)),
      db.delete(tickets).where(eq(tickets.id, id)),
      db.delete(bookings).where(eq(bookings.id, row.booking.id)),
    ]);
    await audit(user, 'ticket.deleted', 'ticket', id, {
      ticket: row.ticket.ticketNumber,
      status: row.ticket.status,
      client: row.client.personName,
      company: row.client.companyName,
      module: row.module.name,
      coordinator: row.coordinator?.name ?? 'Unassigned',
      startsAt: row.booking.startTime.toISOString(),
      mode: row.booking.mode,
    });
    clearSheetRows([{ ticketNumber: row.ticket.ticketNumber, moduleSlug: row.module.slug }]); // and its row leaves the Excel sheet
    const eventId = row.booking.googleEventId;
    if (eventId) inBackground(`Removing the Google Calendar event of the deleted ticket ${row.ticket.ticketNumber}`, () => removeCalendarEvents([eventId]));
    return { id, bookingId: row.booking.id };
  },
});
