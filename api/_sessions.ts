import { waitUntil } from '@vercel/functions';
import { eq } from 'drizzle-orm';
import { db, loadSettings, type AuthUser } from './_lib.js';
import { scriptFailure, sendMail, triggerAppsScript } from './_integrations.js';
import { clientCancelled, clientLink, coordinatorCancelled, coordinatorLinkReady, type BookingMail } from './_mail.js';
import { adminNotifications, bookings, clients, coordinators, modules, tickets } from './_schema.js';
import type { AppSettings, InternalNote } from '../src/types/index.js';

/**
 * What happens around a booked session besides the database row: its Google Calendar event and Meet link (through the
 * Apps Script) and the emails about it. Used by bookings.ts (book, Meet link, reschedule) and tickets.ts (cancel).
 */

/** A meeting link we are willing to store, mail and show: https only. */
export const HTTPS_LINK = /^https:\/\/[^\s]{1,500}$/;

/** A booking with everything the calendar and the emails need. */
export async function loadBooking(id: string) {
  const [row] = await db
    .select({ booking: bookings, ticket: tickets, client: clients, module: modules, coordinator: coordinators })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .innerJoin(modules, eq(bookings.moduleId, modules.id))
    .leftJoin(coordinators, eq(bookings.coordinatorId, coordinators.id))
    .where(eq(bookings.id, id));
  return row;
}
export type BookingRow = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

export const mailOf = ({ booking, ticket, client, module, coordinator }: BookingRow, settings: AppSettings, siteUrl: string, linkProblem?: string): BookingMail => ({
  brand: settings.brand.name,
  siteUrl,
  zone: settings.timezone,
  clientName: client.personName,
  companyName: client.companyName,
  coordinatorName: coordinator?.name,
  ticketNumber: ticket.ticketNumber,
  moduleName: module.name,
  start: booking.startTime,
  end: booking.endTime,
  mode: booking.mode,
  meetingLink: booking.meetingLink,
  venue: settings.venue.address,
  contactEmail: settings.notifications.admin_email,
  linkProblem,
});

/** Sends several emails at once; one failing never stops the others (or the request that sent them). */
export async function sendAll(mails: Promise<unknown>[]) {
  for (const result of await Promise.allSettled(mails)) if (result.status === 'rejected') console.error('Email failed:', result.reason);
}

/**
 * Does `work` after the response has gone out, so nobody waits for Google or the mail servers (Vercel keeps the function running
 * until the work is done; the function's maxDuration still applies). The request already succeeded, so a failure is not an error
 * for the person who made it: it is logged and left on the admin dashboard.
 */
export function inBackground(what: string, work: () => Promise<unknown>) {
  waitUntil(
    work().catch(async (e) => {
      console.error(`${what} failed:`, e);
      try {
        await db.insert(adminNotifications).values({ message: `${what} failed: ${errorText(e)}` });
      } catch (inner) {
        console.error('Could not tell the admin:', inner);
      }
    }),
  );
}

// The ticket's internal notes also record whether the client is still waiting for their Meet link: the last note
// starting with "Google Meet link" says so. That tells a late link (or "Create Meet link") to email the client, exactly once.
const LINK_NOTE = 'Google Meet link';
export const LINK_WAITING = `${LINK_NOTE} not ready when the confirmation went out`;
const LINK_SENT = `${LINK_NOTE} emailed to the client`;
const LINK_READY = `${LINK_NOTE} ready (client emails are switched off, nothing was sent)`;

export const waitingForLink = (notes: InternalNote[]) => [...notes].reverse().find((n) => n.text.startsWith(LINK_NOTE))?.text.startsWith(LINK_WAITING) ?? false;
export const addNote = (ticket: BookingRow['ticket'], text: string) =>
  db.update(tickets).set({ internalNotes: [...ticket.internalNotes, { text, author: 'System', at: new Date().toISOString() }] }).where(eq(tickets.id, ticket.id));

/**
 * Asks the Apps Script for a Calendar event (and, for online sessions, a Meet link) and stores what it returns.
 * Throws when the script cannot be reached or says no. A booking that already has an event gets a new one in its place.
 */
export async function createCalendarEvent({ booking, ticket, client, module, coordinator }: BookingRow, settings: AppSettings) {
  // Noted before asking: if no link has come back 30 minutes later, the daily check tells the admin (see _scheduled.ts).
  if (booking.mode === 'online') await db.update(bookings).set({ meetLinkRequestedAt: new Date(), meetLinkFailedNotified: false }).where(eq(bookings.id, booking.id));
  const reply = await triggerAppsScript({
    action: booking.googleEventId ? 'reschedule' : 'create',
    ...(booking.googleEventId && { oldEventId: booking.googleEventId }),
    ticketNumber: ticket.ticketNumber,
    moduleSlug: module.slug,
    moduleName: module.name,
    clientName: client.personName,
    clientEmail: client.email,
    coordinatorEmail: coordinator?.email ?? '',
    startTime: booking.startTime.toISOString(),
    endTime: booking.endTime.toISOString(),
    mode: booking.mode,
    venueAddress: settings.venue.address,
    timeZone: settings.timezone.tz,
    brandName: settings.brand.name,
    bookingId: booking.id,
  });
  // The script replies with the event it created: { success, eventId, meetingLink }. Only online sessions have a link.
  const failure = scriptFailure(reply);
  if (failure) throw new Error(`Apps Script reported: ${failure}`);
  const googleEventId = typeof reply?.eventId === 'string' && reply.eventId ? reply.eventId : null;
  const replyLink = reply?.meetingLink ?? reply?.meetLink;
  const meetingLink = booking.mode === 'online' && typeof replyLink === 'string' && HTTPS_LINK.test(replyLink) ? replyLink : null;
  if (googleEventId || meetingLink) await db.update(bookings).set({ ...(googleEventId && { googleEventId }), ...(meetingLink && { meetingLink }) }).where(eq(bookings.id, booking.id));
}

/**
 * Emails the client their Meet link (and tells the coordinator it is ready) once the link exists, if they were waiting for it. Once: the
 * ticket note it leaves ends the wait. The confirmation email never carries the link, so every online booking gets it here:
 * `first` is the booking's own first announcement (the link was already there when it was made), which needs no "waiting" note before it.
 */
export async function announceLink(bookingId: string, siteUrl: string, first = false) {
  const row = await loadBooking(bookingId);
  if (!row?.booking.meetingLink || row.booking.mode !== 'online' || !(first || waitingForLink(row.ticket.internalNotes))) return;
  const settings = await loadSettings();
  const mail = mailOf(row, settings, siteUrl);
  if (settings.notifications.send_confirmations) {
    try {
      await sendMail('client', { to: row.client.email, ...clientLink(mail) });
    } catch (e) {
      console.error('Meet link email failed:', e);
      return; // still waiting, so the note stays as it is
    }
  }
  await addNote(row.ticket, settings.notifications.send_confirmations ? LINK_SENT : LINK_READY);
  if (row.coordinator?.email) await sendAll([sendMail('internal', { to: row.coordinator.email, ...coordinatorLinkReady(mail) })]);
}

/**
 * Asks Google for the session's event and Meet link, then writes down on the ticket if the client is now waiting for the
 * link (so it is emailed when it arrives). Never throws: the session stands without Google. Returns the booking as it is now
 * and, for staff, why an online session has no link.
 */
export async function syncCalendar(bookingId: string, settings: AppSettings) {
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
export async function awaitLink(row: BookingRow, linkProblem: string | undefined, siteUrl: string) {
  const why = linkProblem ? `${linkProblem}. Use "Create Meet link" on this ticket if it does not arrive.` : 'the link is emailed on its own once Google has made it.';
  await addNote((await loadBooking(row.booking.id))!.ticket, `${LINK_WAITING}: ${why}`);
  await announceLink(row.booking.id, siteUrl);
}

/** Removes these Google Calendar events (for tickets that were deleted). Tries every one, then fails once if any could not be removed. */
export async function removeCalendarEvents(eventIds: string[]) {
  const results = await Promise.allSettled(
    eventIds.map(async (eventId) => {
      const failure = scriptFailure(await triggerAppsScript({ action: 'cancel', eventId }));
      if (failure) throw new Error(`Apps Script reported: ${failure}`);
    }),
  );
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed.length) throw new Error(`${failed.length} of ${eventIds.length} could not be removed (${errorText(failed[0].reason)})`);
}

/**
 * After a ticket is cancelled: removes the Calendar event (a failure is noted on the ticket, so staff can delete it by hand)
 * and, for a session still to come, tells the client and the coordinator (unless the coordinator cancelled it themselves).
 */
export async function cancelSession(actor: AuthUser, bookingId: string, siteUrl: string) {
  const row = await loadBooking(bookingId);
  if (!row) return;
  const settings = await loadSettings();
  if (row.booking.googleEventId) {
    try {
      const failure = scriptFailure(await triggerAppsScript({ action: 'cancel', eventId: row.booking.googleEventId }));
      if (failure) throw new Error(`Apps Script reported: ${failure}`);
      // The event (and its Meet link) is gone.
      await db.update(bookings).set({ googleEventId: null, meetingLink: null }).where(eq(bookings.id, bookingId));
    } catch (e) {
      console.error('Removing the calendar event failed:', e);
      await addNote(row.ticket, `The Google Calendar event could not be removed (${errorText(e)}). Delete it in Google Calendar.`);
    }
  }
  if (row.booking.endTime.getTime() <= Date.now()) return; // nothing to tell anyone about a session that is over

  const mail = mailOf(row, settings, siteUrl);
  await sendAll([
    ...(settings.notifications.send_confirmations ? [sendMail('client', { to: row.client.email, ...clientCancelled(mail) })] : []),
    ...(row.coordinator?.email && row.coordinator.id !== actor.coordinatorId ? [sendMail('internal', { to: row.coordinator.email, ...coordinatorCancelled(mail, actor.name) })] : []),
  ]);
}
