import { eq } from 'drizzle-orm';
import { db, loadSettings, type AuthUser } from './_lib.js';
import { scriptFailure, sendMail, triggerAppsScript } from './_integrations.js';
import { clientCancelled, clientLink, coordinatorCancelled, type BookingMail } from './_mail.js';
import { bookings, clients, coordinators, modules, tickets } from './_schema.js';
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

export const mailOf = ({ booking, ticket, client, module, coordinator }: BookingRow, settings: AppSettings, linkProblem?: string): BookingMail => ({
  brand: settings.brand.name,
  zone: settings.timezone,
  clientName: client.personName,
  companyName: client.companyName,
  coordinatorName: coordinator?.name,
  ticketNumber: ticket.ticketNumber,
  moduleName: module.name,
  start: booking.startTime,
  mode: booking.mode,
  meetingLink: booking.meetingLink,
  venue: settings.venue.address,
  linkProblem,
});

/** Sends several emails at once; one failing never stops the others (or the request that sent them). */
export async function sendAll(mails: Promise<unknown>[]) {
  for (const result of await Promise.allSettled(mails)) if (result.status === 'rejected') console.error('Email failed:', result.reason);
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

/** Emails the client their Meet link if the confirmation went out without one. Once: the ticket note it leaves ends the wait. */
export async function announceLink(bookingId: string) {
  const row = await loadBooking(bookingId);
  if (!row?.booking.meetingLink || row.booking.mode !== 'online' || !waitingForLink(row.ticket.internalNotes)) return;
  const settings = await loadSettings();
  if (settings.notifications.send_confirmations) {
    try {
      await sendMail('client', { to: row.client.email, ...clientLink(mailOf(row, settings)) });
    } catch (e) {
      console.error('Meet link email failed:', e);
      return; // still waiting, so the note stays as it is
    }
  }
  await addNote(row.ticket, settings.notifications.send_confirmations ? LINK_SENT : LINK_READY);
}

/**
 * After a ticket is cancelled: removes the Calendar event (a failure is noted on the ticket, so staff can delete it by hand)
 * and, for a session still to come, tells the client and the coordinator (unless the coordinator cancelled it themselves).
 */
export async function cancelSession(actor: AuthUser, bookingId: string) {
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

  const mail = mailOf(row, settings);
  await sendAll([
    ...(settings.notifications.send_confirmations ? [sendMail('client', { to: row.client.email, ...clientCancelled(mail) })] : []),
    ...(row.coordinator?.email && row.coordinator.id !== actor.coordinatorId ? [sendMail('internal', { to: row.coordinator.email, ...coordinatorCancelled(mail, actor.name) })] : []),
  ]);
}
