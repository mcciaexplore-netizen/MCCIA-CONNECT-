import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { audit, db, getUser, handler, HttpError, isUniqueViolation, loadBookingQuestions, loadSettings, needString, optString, ownedBy, parseClient, readBody, requireUser, UUID, type Actor } from './_lib.js';
import { loadAvailability, openModes, studioDate, takenAround } from './_availability.js';
import { nextRowNumber } from './_excel.js';
import { sendMail, triggerAppsScript } from './_integrations.js';
import { adminCopy, clientConfirmation, coordinatorNotice } from './_mail.js';
import { bookings, clients, coordinators, modules, tickets } from './_schema.js';
import { BLANK_CLIENT, BOOKING_MODES, normalizePhone, validateClient, type BookingMode, type BookingResult, type ClientInput } from '../src/types/index.js';

/** A meeting link we are willing to store, mail and show: https only. */
const HTTPS_LINK = /^https:\/\/[^\s]{1,500}$/;

/**
 * Called by the Apps Script (apps-script/main.gs) once it has created the calendar event: stores the Meet link and event id.
 * Needs APPS_SCRIPT_SECRET (also set as the script's SHARED_SECRET); without it the endpoint is closed.
 */
async function saveMeetLink(body: Record<string, unknown>) {
  const secret = process.env.APPS_SCRIPT_SECRET;
  const given = Buffer.from(typeof body.secret === 'string' ? body.secret : '');
  if (!secret || given.length !== Buffer.byteLength(secret) || !timingSafeEqual(given, Buffer.from(secret))) throw new HttpError(403, 'Not allowed');

  const bookingId = needString(body.bookingId, 'Booking');
  const link = optString(body.meetLink);
  if (link && !HTTPS_LINK.test(link)) throw new HttpError(400, 'Invalid meeting link');
  const [row] = UUID.test(bookingId)
    ? await db.select({ booking: bookings, ticketId: tickets.id }).from(bookings).innerJoin(tickets, eq(tickets.bookingId, bookings.id)).where(eq(bookings.id, bookingId))
    : [];
  if (!row) throw new HttpError(404, 'Booking not found');

  // Only online sessions have a link.
  const patch = { googleEventId: optString(body.eventId) || row.booking.googleEventId, meetingLink: row.booking.mode === 'online' && link ? link : row.booking.meetingLink };
  await db.update(bookings).set(patch).where(eq(bookings.id, bookingId));
  await audit({ name: 'Apps Script', role: 'integration' }, 'booking.meet_link', 'ticket', row.ticketId, undefined, { meetingLink: patch.meetingLink });
  return { ok: true };
}

export default handler({
  // ?id=... is public (confirmation page, only non-sensitive details). Without it, staff get their bookings.
  GET: async (req, url) => {
    const id = url.searchParams.get('id');
    if (id) {
      if (!UUID.test(id)) throw new HttpError(404, 'Booking not found');
      const [row] = await db
        .select({
          id: bookings.id,
          ticketNumber: tickets.ticketNumber,
          moduleName: modules.name,
          clientName: clients.personName,
          startsAt: bookings.startTime,
          endsAt: bookings.endTime,
          mode: bookings.mode,
          meetingLink: bookings.meetingLink,
          clientEmail: clients.email,
        })
        .from(bookings)
        .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
        .innerJoin(modules, eq(bookings.moduleId, modules.id))
        .innerJoin(clients, eq(bookings.clientId, clients.id))
        .where(eq(bookings.id, id));
      if (!row) throw new HttpError(404, 'Booking not found');
      const settings = await loadSettings();
      const [name, domain] = row.clientEmail.split('@');
      return { ...row, clientEmail: `${name.slice(0, 2)}***@${domain}`, venue: settings.venue.address, confirmationEmail: settings.notifications.send_confirmations };
    }

    const user = await requireUser(req);
    return await db.select().from(bookings).where(ownedBy(user, bookings.coordinatorId)).orderBy(desc(bookings.createdAt));
  },

  // The booking form (public page and admin Create booking), or the Apps Script's { action: 'update-meet' } callback.
  POST: async (req): Promise<BookingResult | { ok: boolean }> => {
    const body = await readBody(req);
    if (body.action === 'update-meet') return await saveMeetLink(body);
    const user = await getUser(req);
    const actor: Actor = user ?? { name: 'Client (booking form)', role: 'client' };

    const mode = body.mode as BookingMode;
    if (!BOOKING_MODES.includes(mode)) throw new HttpError(400, 'Choose online or offline');
    const start = new Date(needString(body.startsAt, 'Time'));
    if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Invalid time');
    // Same rules as the booking form: required details, a valid email, a 10-digit phone number.
    const submitted = { ...BLANK_CLIENT, ...((body.client ?? {}) as Partial<ClientInput>) };
    const problem = Object.values(validateClient(submitted))[0];
    if (problem) throw new HttpError(400, problem);
    const clientInput = parseClient({ ...submitted, phone: normalizePhone(submitted.phone) });

    const moduleId = needString(body.moduleId, 'Module');
    const [module] = UUID.test(moduleId) ? await db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.isActive, true))) : [];
    if (!module) throw new HttpError(404, 'Module not found');

    // The chosen time must still be open for this mode.
    const { config, slots } = await loadAvailability(module.id, studioDate(start), 1);
    const slot = slots.find((s) => new Date(s.startsAt).getTime() === start.getTime());
    if (!config || !slot?.modes.includes(mode)) throw new HttpError(409, 'Sorry, that time is no longer available. Please pick another.');
    const end = new Date(slot.endsAt);

    // Keep only the module's own questions and enforce the required ones.
    const answers: Record<string, string> = {};
    const given = (body.answers ?? {}) as Record<string, unknown>;
    for (const question of (await loadBookingQuestions()).get(module.id) ?? []) {
      const value = optString(given[question.id]);
      if (question.required && !value) throw new HttpError(400, `"${question.label}" is required`);
      if (value) answers[question.id] = value;
    }

    // Returning clients are matched by email; their record is left as it is.
    const [existing] = await db.select().from(clients).where(sql`lower(${clients.email}) = ${clientInput.email}`).orderBy(clients.createdAt).limit(1);

    // Staff booking for a client must choose the coordinator; on the public page it is the client's assigned coordinator (if still active).
    const picked = user?.role === 'super_admin' && typeof body.coordinatorId === 'string' && body.coordinatorId ? body.coordinatorId : null;
    if (user?.role === 'super_admin' && !picked) throw new HttpError(400, 'Choose a coordinator for this booking');
    const wanted = picked ?? existing?.assignedCoordinatorId;
    const [coordinator] = wanted && UUID.test(wanted) ? await db.select().from(coordinators).where(eq(coordinators.id, wanted)) : [];
    if (picked && !coordinator?.isActive) throw new HttpError(400, 'Coordinator not found or inactive');
    const coordinatorId = coordinator?.isActive ? coordinator.id : null;

    const clientId = existing?.id ?? crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    const ticketId = crypto.randomUUID();

    let ticketNumber: string;
    try {
      // One atomic request: either the client, booking and ticket all exist or none do.
      const [, , [ticket]] = await db.batch([
        db.insert(clients).values({ id: clientId, ...clientInput }).onConflictDoNothing(),
        db.insert(bookings).values({ id: bookingId, moduleId: module.id, clientId, coordinatorId, startTime: start, endTime: end, mode, excelRowNumber: nextRowNumber(module.id), bookingAnswers: answers, createdBy: user ? 'admin' : 'client' }),
        db.insert(tickets).values({ id: ticketId, bookingId, moduleId: module.id, clientId, coordinatorId, status: coordinatorId ? 'pending' : 'new' }).returning({ ticketNumber: tickets.ticketNumber }),
      ]);
      ticketNumber = ticket.ticketNumber;
    } catch (e) {
      throw isUniqueViolation(e) ? new HttpError(409, 'Please try booking again.') : e;
    }

    // Nothing in the database stops two requests from taking the last place at once, so check again
    // now that ours is saved. If another booking now overlaps beyond capacity we back out, which in a
    // true tie means both back out and can simply retry. Backing out cancels instead of deleting:
    // ticket numbers come from count(*) + 1, so deleting would leave gaps that make later numbers collide.
    if (!openModes(config, await takenAround(module.id, start, end, bookingId), start, end).includes(mode)) {
      await db.batch([
        db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId)),
        db
          .update(tickets)
          .set({ status: 'cancelled', internalNotes: [{ text: 'Cancelled automatically: someone else booked the same time at the same moment.', author: 'System', at: new Date().toISOString() }] })
          .where(eq(tickets.id, ticketId)),
      ]);
      throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
    }

    await audit(actor, 'booking.created', 'ticket', ticketId, undefined, { ticket: ticketNumber, module: module.name, client: clientInput.personName, startsAt: start.toISOString(), mode });

    // Apps Script, then email. Their failures never undo the booking.
    const settings = await loadSettings();
    let meetingLink: string | null = null;
    try {
      // Creates the Calendar event (and the Meet link for online sessions).
      const reply = await triggerAppsScript({
        action: 'create',
        ticketNumber,
        moduleSlug: module.slug,
        moduleName: module.name,
        clientName: clientInput.personName,
        clientEmail: clientInput.email,
        coordinatorEmail: coordinator?.email ?? '',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        mode,
        venueAddress: settings.venue.address,
        bookingId,
      });
      // The script replies with the event it created: { success, eventId, meetingLink }. Only online sessions have a link.
      if (reply?.success === false) throw new Error(`Apps Script reported: ${String(reply.error)}`);
      const googleEventId = typeof reply?.eventId === 'string' && reply.eventId ? reply.eventId : null;
      const replyLink = reply?.meetingLink ?? reply?.meetLink;
      meetingLink = mode === 'online' && typeof replyLink === 'string' && HTTPS_LINK.test(replyLink) ? replyLink : null;
      if (googleEventId || meetingLink) await db.update(bookings).set({ googleEventId, meetingLink }).where(eq(bookings.id, bookingId));
    } catch (e) {
      console.error('Apps Script failed:', e);
    }

    // Clients are mailed from the Gmail account; the coordinator and the booking copy go out from the Zoho account.
    const booking = { brand: settings.brand.name, clientName: clientInput.personName, companyName: clientInput.companyName, coordinatorName: coordinator?.name, ticketNumber, moduleName: module.name, start, mode, meetingLink, venue: settings.venue.address };
    const mails: Promise<unknown>[] = [];
    if (settings.notifications.send_confirmations) mails.push(sendMail('client', { to: clientInput.email, ...clientConfirmation(booking) }));
    if (coordinator?.email) mails.push(sendMail('internal', { to: coordinator.email, ...coordinatorNotice(booking) }));
    const copyTo = settings.notifications.admin_email;
    if (copyTo && copyTo.toLowerCase() !== coordinator?.email.toLowerCase()) mails.push(sendMail('internal', { to: copyTo, ...adminCopy(booking) }));
    for (const result of await Promise.allSettled(mails)) if (result.status === 'rejected') console.error('Booking email failed:', result.reason);

    return { bookingId, ticketId, ticketNumber, meetingLink };
  },
});
