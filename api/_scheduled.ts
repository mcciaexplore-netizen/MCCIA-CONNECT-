import { timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, lte, ne } from 'drizzle-orm';
import { db, loadSettings, requireUser } from './_lib.js';
import { sendMail } from './_integrations.js';
import { saveRecordings } from './_fireflies.js';
import { clientReminder, formatWhen } from './_mail.js';
import { loadBooking, mailOf } from './_sessions.js';
import { adminNotifications, bookings } from './_schema.js';
import type { AppSettings } from '../src/types/index.js';

/** The jobs Vercel runs once a day (vercel.json "crons"): reminders for coming sessions, a check for Meet links that never arrived, and Fireflies recordings. */

const HOUR = 60 * 60_000;
const MEET_LINK_PATIENCE = 30 * 60_000; // the Apps Script is expected to call back within this long
const MAX_LEAD_HOURS = 7 * 24;

/**
 * Who may run them: Vercel's own call (it sends `Authorization: Bearer <CRON_SECRET>` when that variable is set), or a signed-in admin
 * (by hand). While CRON_SECRET is not set, Vercel's cron user agent is accepted instead: the jobs only do work that is due, once.
 */
async function authorize(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const given = Buffer.from(req.headers.get('authorization') ?? '');
    const wanted = Buffer.from(`Bearer ${secret}`);
    if (given.length === wanted.length && timingSafeEqual(given, wanted)) return;
  } else if ((req.headers.get('user-agent') ?? '').startsWith('vercel-cron/')) {
    return;
  }
  await requireUser(req, 'super_admin');
}

/** Emails each client whose scheduled session starts within lead_time_hours, once (bookings.reminder_sent). Returns how many went out. */
async function sendReminders(settings: AppSettings, siteUrl: string) {
  const hours = Math.min(MAX_LEAD_HOURS, Math.max(0, Math.floor(Number(settings.notifications.lead_time_hours) || 0)));
  if (!hours || !settings.notifications.send_confirmations) return 0;
  const now = new Date();
  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, 'scheduled'), eq(bookings.reminderSent, false), gt(bookings.startTime, now), lte(bookings.startTime, new Date(now.getTime() + hours * HOUR))));

  let sent = 0;
  for (const { id } of due) {
    // Claimed first, so two overlapping runs never send the same reminder twice; put back if the email fails, so the next run tries again.
    const [claimed] = await db.update(bookings).set({ reminderSent: true }).where(and(eq(bookings.id, id), eq(bookings.reminderSent, false))).returning({ id: bookings.id });
    if (!claimed) continue;
    const row = (await loadBooking(id))!;
    try {
      await sendMail('client', { to: row.client.email, ...clientReminder(mailOf(row, settings, siteUrl)) });
      sent++;
    } catch (e) {
      console.error('Reminder failed:', e);
      await db.update(bookings).set({ reminderSent: false }).where(eq(bookings.id, id));
    }
  }
  return sent;
}

/** Tells the admin (dashboard message), once per session, about online sessions whose Meet link has not come 30 minutes after it was asked for. */
async function flagMissingMeetLinks(settings: AppSettings) {
  const stale = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.mode, 'online'),
        ne(bookings.status, 'cancelled'),
        isNull(bookings.meetingLink),
        eq(bookings.meetLinkFailedNotified, false),
        lt(bookings.meetLinkRequestedAt, new Date(Date.now() - MEET_LINK_PATIENCE)),
        gt(bookings.endTime, new Date()), // a session that is already over does not need a link any more
      ),
    );

  let flagged = 0;
  for (const { id } of stale) {
    const [claimed] = await db.update(bookings).set({ meetLinkFailedNotified: true }).where(and(eq(bookings.id, id), eq(bookings.meetLinkFailedNotified, false))).returning({ id: bookings.id });
    if (!claimed) continue;
    const { ticket, client, booking } = (await loadBooking(id))!;
    await db.insert(adminNotifications).values({
      message: `Meet link failed for ${ticket.ticketNumber} — ${client.personName} on ${formatWhen(booking.startTime, settings.timezone)}. Create manually and update the ticket.`,
    });
    flagged++;
  }
  return flagged;
}

/** GET /api/tickets?action=send-reminders: all three jobs. Returns { sent, meetLinkFailures, recordings }. */
export async function runScheduled(req: Request, siteUrl: string) {
  await authorize(req);
  const settings = await loadSettings();
  const sent = await sendReminders(settings, siteUrl);
  const meetLinkFailures = await flagMissingMeetLinks(settings);
  // Fireflies recordings of the sessions that ended since (the same check runs when a ticket is opened, so this catches the ones nobody opened).
  const { found: recordings } = await saveRecordings({ force: true });
  return { sent, meetLinkFailures, recordings };
}
