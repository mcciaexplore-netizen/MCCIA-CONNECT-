import { timingSafeEqual } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { audit, db, getUser, handler, HttpError, isUniqueViolation, loadBookingQuestions, loadSettings, needString, optString, ownedBy, parseClient, readBody, requireUser, siteOrigin, UUID, type Actor, type AuthUser } from './_lib.js';
import { clashesOf, ensureCoordinatorFree, freeCoordinators, leastLoaded, loadAvailability, openModes, studioDate, takenAround } from './_availability.js';
import { assignClient } from './_assign.js';
import { findCompany } from './_companies.js';
import { nextRowNumber } from './_excel.js';
import { sendMail } from './_integrations.js';
import { clientIp, refundAttempt, reserveAttempt } from './_limits.js';
import { adminCopy, clientConfirmation, clientRescheduled, coordinatorNotice, coordinatorRescheduled, formatWhen } from './_mail.js';
import { addNote, announceLink, createCalendarEvent, errorText, HTTPS_LINK, inBackground, LINK_WAITING, loadBooking, mailOf, sendAll, waitingForLink, type BookingRow } from './_sessions.js';
import { bookings, clients, companies, coordinatorAssignments, coordinators, modules, tickets } from './_schema.js';
import { answerProblem, BLANK_CLIENT, BOOKING_MODES, normalizePhone, validateClient, type AppSettings, type BookingConflict, type BookingMode, type BookingResult, type ClientInput } from '../src/types/index.js';

const MAX_REASON = 500;

/**
 * Asks Google for the session's event and Meet link, then writes down on the ticket if the client is now waiting for the
 * link (so it is emailed when it arrives). Never throws: the session stands without Google. Returns the booking as it is now
 * and, for staff, why an online session has no link.
 */
async function syncCalendar(bookingId: string, settings: AppSettings) {
  let problem: string | undefined;
  try {
    await createCalendarEvent((await loadBooking(bookingId))!, settings);
  } catch (e) {
    console.error('Apps Script failed:', e);
    problem = errorText(e);
  }
  const row = (await loadBooking(bookingId))!; // with the link and event id, whichever way they were saved
  const missingLink = row.booking.mode === 'online' && !row.booking.meetingLink;
  return { row, missingLink, linkProblem: problem ?? (missingLink ? 'Google did not return a link' : undefined) };
}

/** The client was told the link will follow: note it on the ticket (staff see why) and check once more, in case it arrived meanwhile. */
async function awaitLink(row: BookingRow, linkProblem: string | undefined, siteUrl: string) {
  const why = linkProblem ? `${linkProblem}. Use "Create Meet link" on this ticket if it does not arrive.` : 'the link is emailed on its own once Google has made it.';
  await addNote((await loadBooking(row.booking.id))!.ticket, `${LINK_WAITING}: ${why}`);
  await announceLink(row.booking.id, siteUrl);
}

/**
 * Called by the Apps Script (apps-script/main.gs) once it has created the calendar event: stores the Meet link and event id.
 * Needs APPS_SCRIPT_SECRET (also set as the script's SHARED_SECRET); without it the endpoint is closed.
 */
async function saveMeetLink(body: Record<string, unknown>, siteUrl: string) {
  const secret = process.env.APPS_SCRIPT_SECRET;
  const given = Buffer.from(typeof body.secret === 'string' ? body.secret : '');
  if (!secret || given.length !== Buffer.byteLength(secret) || !timingSafeEqual(given, Buffer.from(secret))) throw new HttpError(403, 'Not allowed');

  const bookingId = needString(body.bookingId, 'Booking');
  const link = optString(body.meetLink);
  if (link && !HTTPS_LINK.test(link)) throw new HttpError(400, 'Invalid meeting link');
  const row = UUID.test(bookingId) ? await loadBooking(bookingId) : undefined;
  if (!row) throw new HttpError(404, 'Booking not found');

  // Only online sessions have a link.
  const patch = { googleEventId: optString(body.eventId) || row.booking.googleEventId, meetingLink: row.booking.mode === 'online' && link ? link : row.booking.meetingLink };
  await db.update(bookings).set(patch).where(eq(bookings.id, bookingId));
  await audit({ name: 'Apps Script', role: 'integration' }, 'booking.meet_link', 'ticket', row.ticket.id, undefined, { meetingLink: patch.meetingLink });
  await announceLink(bookingId, siteUrl);
  return { ok: true };
}

/** A booking this staff member may act on: admins any, a coordinator only their own (others look like they do not exist). */
async function ownBooking(user: AuthUser, bookingId: string) {
  const row = UUID.test(bookingId) ? await loadBooking(bookingId) : undefined;
  if (!row || (user.role !== 'super_admin' && row.booking.coordinatorId !== user.coordinatorId)) throw new HttpError(404, 'Booking not found');
  return row;
}

/** Staff ask for the calendar event and Meet link again (it failed or was never set up when the booking was made). Mails the client the link. */
async function createMeetLink(user: AuthUser, body: Record<string, unknown>, siteUrl: string) {
  const bookingId = needString(body.bookingId, 'Booking');
  const row = await ownBooking(user, bookingId);
  if (row.booking.mode !== 'online') throw new HttpError(400, 'Only online sessions have a Meet link');
  if (row.booking.status !== 'scheduled' || row.booking.endTime.getTime() < Date.now()) throw new HttpError(400, 'This session is over or was cancelled');
  if (row.booking.meetingLink) throw new HttpError(400, 'This booking already has a Meet link');

  const settings = await loadSettings();
  // The client was told the link would follow, so make sure it is sent when it exists.
  if (!waitingForLink(row.ticket.internalNotes)) {
    await addNote(row.ticket, `${LINK_WAITING}: ${user.name} asked for it from the ticket.`);
  }
  try {
    await createCalendarEvent(row, settings);
  } catch (e) {
    throw new HttpError(502, `Could not create the Meet link: ${errorText(e)}`);
  }
  const created = await loadBooking(bookingId);
  if (!created?.booking.meetingLink) throw new HttpError(502, 'Google did not return a Meet link. Try again in a minute.');
  await announceLink(bookingId, siteUrl);
  await audit(user, 'booking.meet_created', 'ticket', row.ticket.id, undefined, { meetingLink: created.booking.meetingLink });
  return { meetingLink: created.booking.meetingLink };
}

/**
 * POST /api/bookings/:id/reschedule { newStartTime, newEndTime?, reason } (a vercel.json rewrite to ?reschedule=:id).
 * Moves a scheduled session to another open slot of its module (same mode), replaces its Calendar event (a new Meet link),
 * sets the ticket to Rescheduled, emails the client and the coordinator, and logs it. Admins, or the session's coordinator.
 */
async function rescheduleSession(user: AuthUser, bookingId: string, body: Record<string, unknown>, siteUrl: string) {
  const row = await ownBooking(user, bookingId);
  if (row.booking.status !== 'scheduled') throw new HttpError(400, 'Only a scheduled session can be rescheduled');
  const reason = needString(body.reason, 'Reason');
  if (reason.length > MAX_REASON) throw new HttpError(400, `Keep the reason under ${MAX_REASON} characters`);
  const start = new Date(needString(body.newStartTime, 'New time'));
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Invalid time');
  if (start.getTime() === row.booking.startTime.getTime()) throw new HttpError(400, 'The session is already at that time');

  // The new time must be an open slot for this mode, not counting the session itself.
  const settings = await loadSettings();
  const tz = settings.timezone.tz;
  const { config, slots } = await loadAvailability(row.module.id, studioDate(start, tz), 1, tz, bookingId);
  const slot = slots.find((s) => new Date(s.startsAt).getTime() === start.getTime());
  if (!config || !slot?.modes.includes(row.booking.mode)) throw new HttpError(409, 'That time is not available. Please pick another.');
  const end = new Date(slot.endsAt);
  if (body.newEndTime !== undefined && new Date(String(body.newEndTime)).getTime() !== end.getTime()) throw new HttpError(400, `A session at that time ends at ${end.toISOString()}`);
  // A coordinator is never in two places at once, and keeps to their own hours.
  if (row.coordinator?.isActive) await ensureCoordinatorFree(row.coordinator, start, end, tz, { excludeBookingId: bookingId });

  const previous = { start: row.booking.startTime, end: row.booking.endTime };
  const note = { text: `Rescheduled from ${formatWhen(previous.start, settings.timezone)} to ${formatWhen(start, settings.timezone)} by ${user.name}: ${reason}`, author: user.name, at: new Date().toISOString() };
  // The old Meet link goes with the old event.
  await db.batch([
    db.update(bookings).set({ startTime: start, endTime: end, meetingLink: null, reminderSent: false }).where(eq(bookings.id, bookingId)),
    db.update(tickets).set({ status: 'rescheduled', internalNotes: [...row.ticket.internalNotes, note] }).where(eq(tickets.id, row.ticket.id)),
  ]);
  // The same double-check as a new booking: if someone took the last place at the same moment, put everything back.
  const crowded = !openModes(config, await takenAround(row.module.id, start, end, bookingId), start, end).includes(row.booking.mode);
  if (crowded || (row.coordinator && (await clashesOf(row.coordinator.id, start, end, bookingId)).length)) {
    await db.batch([
      db.update(bookings).set({ startTime: previous.start, endTime: previous.end, meetingLink: row.booking.meetingLink }).where(eq(bookings.id, bookingId)),
      db.update(tickets).set({ status: row.ticket.status, internalNotes: row.ticket.internalNotes }).where(eq(tickets.id, row.ticket.id)),
    ]);
    throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
  }
  await audit(user, 'booking.rescheduled', 'ticket', row.ticket.id, { startsAt: previous.start.toISOString(), status: row.ticket.status }, { startsAt: start.toISOString(), status: 'rescheduled', reason });

  // The new event (and Meet link) and the emails follow the answer.
  inBackground(`The calendar event and emails for ${row.ticket.ticketNumber}`, async () => {
    const { row: moved, missingLink, linkProblem } = await syncCalendar(bookingId, settings);
    const mail = mailOf(moved, settings, siteUrl, linkProblem);
    await sendAll([
      ...(settings.notifications.send_confirmations ? [sendMail('client', { to: moved.client.email, ...clientRescheduled(mail, previous.start) })] : []),
      ...(moved.coordinator?.email && moved.coordinator.id !== user.coordinatorId ? [sendMail('internal', { to: moved.coordinator.email, ...coordinatorRescheduled(mail, previous.start, user.name, reason) })] : []),
    ]);
    if (missingLink) await awaitLink(moved, linkProblem, siteUrl);
  });
  return { bookingId, startsAt: start.toISOString(), endsAt: end.toISOString() };
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

  // The booking form (public page and admin Create booking), the Apps Script's { action: 'update-meet' } callback,
  // staff's { action: 'create-meet' } and the reschedule route.
  POST: async (req, url): Promise<BookingResult | BookingConflict | Record<string, unknown>> => {
    const body = await readBody(req);
    const siteUrl = siteOrigin(req);
    const rescheduleId = url.searchParams.get('reschedule') ?? /^\/api\/bookings\/([^/]+)\/reschedule\/?$/.exec(url.pathname)?.[1];
    if (rescheduleId) return await rescheduleSession(await requireUser(req), rescheduleId, body, siteUrl);
    if (body.action === 'update-meet') return await saveMeetLink(body, siteUrl);
    if (body.action === 'create-meet') return await createMeetLink(await requireUser(req), body, siteUrl);
    const user = await getUser(req);
    const actor: Actor = user ?? { name: 'Client (booking form)', role: 'client' };
    // The public pages allow 3 bookings per IP per hour; staff booking for clients are not limited.
    const ip = clientIp(req);

    const mode = body.mode as BookingMode;
    if (!BOOKING_MODES.includes(mode)) throw new HttpError(400, 'Choose online or offline');
    const start = new Date(needString(body.startsAt, 'Time'));
    if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Invalid time');
    // Same rules as the booking form: required details, a valid email, a 10-digit phone number. A client already on file (matched by email)
    // is only held to the basic contact details: their record may predate some of the 18 fields and is left as it is (see `missing` below).
    const submitted = { ...BLANK_CLIENT, ...((body.client ?? {}) as Partial<ClientInput>) };
    const basic = Object.values(validateClient(submitted, false))[0];
    if (basic) throw new HttpError(400, basic);
    const errors = validateClient(submitted);
    // Returning clients are matched by email.
    const [existing] = await db.select().from(clients).where(sql`lower(${clients.email}) = ${submitted.email.trim().toLowerCase()}`).orderBy(clients.createdAt).limit(1);
    const problem = existing ? undefined : Object.values(errors)[0];
    if (problem) throw new HttpError(400, problem);
    const clientInput = parseClient({ ...submitted, phone: normalizePhone(submitted.phone) });

    const moduleId = needString(body.moduleId, 'Module');
    const [module] = UUID.test(moduleId) ? await db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.isActive, true))) : [];
    if (!module) throw new HttpError(404, 'Module not found');

    // The chosen time must still be open for this mode.
    const settings = await loadSettings();
    const tz = settings.timezone.tz;
    const { config, slots } = await loadAvailability(module.id, studioDate(start, tz), 1, tz);
    const slot = slots.find((s) => new Date(s.startsAt).getTime() === start.getTime());
    if (!config || !slot?.modes.includes(mode)) throw new HttpError(409, 'Sorry, that time is no longer available. Please pick another.');
    const end = new Date(slot.endsAt);

    // Keep only the module's own questions and enforce the required ones.
    const answers: Record<string, string> = {};
    const given = (body.answers ?? {}) as Record<string, unknown>;
    for (const question of (await loadBookingQuestions()).get(module.id) ?? []) {
      const value = optString(given[question.id]);
      if (question.required && !value) throw new HttpError(400, `"${question.label}" is required`);
      // A list question only accepts its own options and a link question a web address, whatever the browser sent.
      if (value && answerProblem(question, value)) throw new HttpError(400, `Invalid answer for ${question.label}`);
      if (value) answers[question.id] = value;
    }

    // A returning client's record is left as it is, except for details it does not have yet (and only valid ones are taken).
    const missing = existing ? Object.fromEntries(Object.entries(clientInput).filter(([key, value]) => key !== 'isMember' && key !== 'membershipId' && value != null && value !== '' && !errors[key as keyof ClientInput] && (existing as Record<string, unknown>)[key] == null)) : {};

    // The company decides the coordinator: every client of a company shares it, however the company's name is written (see _companies.ts).
    const company = existing?.companyId ? (await db.select().from(companies).where(eq(companies.id, existing.companyId)))[0] : await findCompany(clientInput.companyName);
    const permanentId = company?.assignedCoordinatorId ?? existing?.assignedCoordinatorId ?? null;
    const [permanentRow] = permanentId && UUID.test(permanentId) ? await db.select().from(coordinators).where(eq(coordinators.id, permanentId)) : [];
    const permanent = permanentRow?.isActive ? permanentRow : undefined; // an inactive coordinator holds nobody

    // Who takes this session. Staff choose: an admin names the coordinator, a coordinator books for themselves and only for their own company
    // or one nobody has yet. On the public page the rules decide:
    //  1. the company's coordinator, if free then;
    //  2. if they are busy: the client is told who else is free and may book with one of them, for this session only;
    //  3. a company with no coordinator yet gets the free one with the fewest sessions this month, for good.
    const picked = user?.role === 'super_admin' && typeof body.coordinatorId === 'string' && body.coordinatorId ? body.coordinatorId : null;
    if (user?.role === 'super_admin' && !picked) throw new HttpError(400, 'Choose a coordinator for this booking');
    const own = user?.role === 'coordinator' ? user.coordinatorId : null;
    if (own && permanent && permanent.id !== own) throw new HttpError(403, "This client's company works with another coordinator. Ask the admin to book this session.");

    let coordinator: typeof coordinators.$inferSelect;
    let standIn: typeof permanent; // set when this one session is booked with someone else because the company's coordinator was busy
    let autoAssigned = false;
    if (user) {
      const wantedId = picked ?? own;
      const [row] = wantedId && UUID.test(wantedId) ? await db.select().from(coordinators).where(eq(coordinators.id, wantedId)) : [];
      if (!row?.isActive) throw new HttpError(400, 'Coordinator not found or inactive');
      // Their own hours and one session at a time, checked before anything is written.
      await ensureCoordinatorFree(row, start, end, tz);
      coordinator = row;
    } else {
      const free = await freeCoordinators(start, end, tz);
      if (permanent && free.some((c) => c.id === permanent.id)) {
        coordinator = permanent;
      } else if (permanent) {
        const others = free.filter((c) => c.id !== permanent.id);
        const alternative = others.find((c) => c.id === body.coordinatorId);
        if (!alternative) return { coordinatorConflict: true, assignedCoordinator: { id: permanent.id, name: permanent.name }, availableCoordinators: others.map(({ id, name, color }) => ({ id, name, color })) } satisfies BookingConflict;
        coordinator = alternative;
        standIn = permanent;
      } else {
        if (!free.length) throw new HttpError(409, 'No coordinators are available at this time. Please choose another slot.');
        coordinator = await leastLoaded(free, start, tz);
        autoAssigned = true;
      }
    }
    const coordinatorId = coordinator.id;

    const clientId = existing?.id ?? crypto.randomUUID();
    const bookingId = crypto.randomUUID();
    const ticketId = crypto.randomUUID();
    const companyIdOf = sql<string>`(select id from companies where name_normalized = normalize_company_name(${clientInput.companyName}))`;

    // Take one of the IP's 3 allowed bookings now, before anything is written, so parallel requests cannot all get in.
    // It is given back if the booking then does not happen.
    if (!user) await reserveAttempt('booking', ip, clientInput.email);
    const giveBack = () => (user ? Promise.resolve() : refundAttempt('booking', ip));

    let ticketNumber: string;
    try {
      // One atomic request: either the company, client, booking and ticket all exist or none do.
      const writes = [
        ...(company ? [] : [db.insert(companies).values({ name: clientInput.companyName, nameNormalized: sql`normalize_company_name(${clientInput.companyName})` }).onConflictDoNothing()]),
        // A new client starts with the company's coordinator, when it has one.
        ...(existing ? [] : [db.insert(clients).values({ id: clientId, ...clientInput, companyId: companyIdOf, assignedCoordinatorId: permanent?.id ?? null })]),
        ...(!existing && permanent ? [db.insert(coordinatorAssignments).values({ clientId, coordinatorId: permanent.id })] : []),
        ...(existing && Object.keys(missing).length ? [db.update(clients).set(missing).where(eq(clients.id, existing.id))] : []),
        ...(existing && !existing.companyId ? [db.update(clients).set({ companyId: companyIdOf }).where(eq(clients.id, existing.id))] : []),
        ...(existing && permanent && existing.assignedCoordinatorId !== permanent.id ? [db.update(clients).set({ assignedCoordinatorId: permanent.id }).where(eq(clients.id, existing.id))] : []),
        // The client had a coordinator but their company did not (older data): the company takes it, so the whole company shares it.
        ...(company && permanent && !company.assignedCoordinatorId ? [db.update(companies).set({ assignedCoordinatorId: permanent.id }).where(eq(companies.id, company.id))] : []),
        db.insert(bookings).values({ id: bookingId, moduleId: module.id, clientId, coordinatorId, startTime: start, endTime: end, mode, excelRowNumber: nextRowNumber(module.id), bookingAnswers: answers, createdBy: user ? (user.role === 'coordinator' ? 'coordinator' : 'admin') : 'client', ...(mode === 'online' && { meetLinkRequestedAt: new Date() }) }),
        db.insert(tickets).values({ id: ticketId, bookingId, moduleId: module.id, clientId, coordinatorId, followUpCoordinatorId: standIn?.id ?? null, status: 'pending' }).returning({ ticketNumber: tickets.ticketNumber }),
      ];
      const results = (await db.batch(writes as unknown as [(typeof writes)[0], ...(typeof writes)[number][]])) as unknown as { ticketNumber: string }[][];
      ticketNumber = results[results.length - 1][0].ticketNumber;
    } catch (e) {
      await giveBack();
      throw isUniqueViolation(e) ? new HttpError(409, 'Please try booking again.') : e;
    }

    // Nothing in the database stops two requests from taking the last place at once, so check again
    // now that ours is saved. If another booking now overlaps beyond capacity we back out, which in a
    // true tie means both back out and can simply retry. Backing out cancels instead of deleting, so the
    // booking stays on record (and its ticket number is not given out twice).
    const crowded = !openModes(config, await takenAround(module.id, start, end, bookingId), start, end).includes(mode);
    if (crowded || (coordinatorId && (await clashesOf(coordinatorId, start, end, bookingId)).length)) {
      await db.batch([
        db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, bookingId)),
        db
          .update(tickets)
          .set({ status: 'cancelled', internalNotes: [{ text: 'Cancelled automatically: someone else booked the same time at the same moment.', author: 'System', at: new Date().toISOString() }] })
          .where(eq(tickets.id, ticketId)),
      ]);
      await giveBack();
      throw new HttpError(409, 'Sorry, that time was just taken. Please pick another.');
    }

    await audit(actor, 'booking.created', 'ticket', ticketId, undefined, { ticket: ticketNumber, module: module.name, client: clientInput.personName, startsAt: start.toISOString(), mode });
    if (standIn) {
      await audit(actor, 'booking.temporary_coordinator', 'ticket', ticketId, undefined, {
        message: `Booking assigned to ${coordinator.name} because ${standIn.name} was unavailable`,
        temporary: coordinator.name,
        permanent: standIn.name,
      });
    }
    // A company with no coordinator yet now has one: the free one the form picked, or the one staff chose. Everything of the company follows.
    if (!permanent) {
      try {
        await assignClient(user ?? actor, clientId, coordinator.id, '', undefined, autoAssigned ? { auto: { firstBooking: !company } } : {});
      } catch (e) {
        console.error('Assigning the company failed:', e); // the booking stands; the company is given a coordinator on its next booking
      }
    }

    // The booking is saved: the client gets their answer now, and Google and the emails follow. Their failures never undo the booking.
    inBackground(`The calendar event and emails for ${ticketNumber}`, async () => {
      // The client's confirmation does not wait for Google: it only says the Meet link follows in its own email. Clients are mailed from the
      // Gmail account; the coordinator and the booking copy go out from the Zoho account.
      const [{ row, missingLink, linkProblem }] = await Promise.all([
        syncCalendar(bookingId, settings),
        settings.notifications.send_confirmations && loadBooking(bookingId).then((booked) => sendAll([sendMail('client', { to: clientInput.email, ...clientConfirmation(mailOf(booked!, settings, siteUrl)) })])),
      ]);
      const booking = mailOf(row, settings, siteUrl, linkProblem);
      const copyTo = settings.notifications.admin_email;
      await sendAll([
        ...(coordinator?.email ? [sendMail('internal', { to: coordinator.email, ...coordinatorNotice(booking) })] : []),
        ...(copyTo && copyTo.toLowerCase() !== coordinator?.email.toLowerCase() ? [sendMail('internal', { to: copyTo, ...adminCopy(booking) })] : []),
      ]);
      // The link goes out in its own email as soon as it exists (now, or when the Apps Script calls back).
      if (row.booking.mode === 'online') {
        if (missingLink) await awaitLink(row, linkProblem, siteUrl);
        else await announceLink(bookingId, siteUrl, true);
      }
    });

    return { bookingId, ticketId, ticketNumber };
  },
});
