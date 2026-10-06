import { and, eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, loadSettings, needString, readBody, requireUser, siteOrigin } from './_lib.js';
import { sendMail } from './_integrations.js';
import { feedbackRequest } from './_mail.js';
import { loadBooking, mailOf } from './_sessions.js';
import { feedbackTokens, tickets } from './_schema.js';
import { FEEDBACK_FIELDS } from '../src/types/index.js';

const FEEDBACK_LINK_DAYS = 30;

export default handler({
  // { test: true } emails the signed-in admin; { ticketId, feedbackRequest: true } emails that ticket's client a one-time feedback link.
  POST: async (req) => {
    const user = await requireUser(req);
    const body = await readBody(req);

    if (body.test) {
      if (user.role !== 'super_admin') throw new HttpError(403, 'Only admins can send a test email');
      // One from each sender, so a problem with either shows up: client mail (Gmail) and staff mail (Zoho).
      const channels = [['client', 'Gmail'], ['internal', 'Zoho']] as const;
      const results = await Promise.allSettled(
        channels.map(([channel, name]) =>
          sendMail(channel, { to: user.email, subject: `CRM test email: ${channel === 'client' ? 'client' : 'staff'} mail (${name})`, text: `Email sending from the CRM is working. This one is ${channel === 'client' ? 'client' : 'staff'} mail, sent through ${name}.`, strict: true }),
        ),
      );
      const failed = results.flatMap((result, i) => (result.status === 'rejected' ? [`${channels[i][1]}: ${result.reason instanceof Error ? result.reason.message : 'failed'}`] : []));
      if (failed.length) throw new HttpError(502, `Could not send through ${failed.join('; ')}`);
      return { ok: true };
    }

    if (!body.feedbackRequest) throw new HttpError(400, 'Nothing to send');
    const ticketId = needString(body.ticketId, 'Ticket');
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket) throw new HttpError(404, 'Ticket not found');
    if (user.role !== 'super_admin' && ticket.coordinatorId !== user.coordinatorId) throw new HttpError(403, 'This ticket is not assigned to you');
    if (FEEDBACK_FIELDS.some((f) => ticket.feedbackData[f.key])) throw new HttpError(400, 'Feedback for this session was already received');
    if (ticket.status === 'cancelled') throw new HttpError(400, 'This session was cancelled');

    // A new link each time; earlier unused links for this ticket stop working, so only the latest email counts.
    const row = (await loadBooking(ticket.bookingId))!;
    const expiresAt = new Date(Date.now() + FEEDBACK_LINK_DAYS * 24 * 60 * 60 * 1000);
    const [, [link]] = await db.batch([
      db.update(feedbackTokens).set({ used: true }).where(and(eq(feedbackTokens.ticketId, ticketId), eq(feedbackTokens.used, false))),
      db.insert(feedbackTokens).values({ ticketId, expiresAt }).returning(),
    ]);
    const siteUrl = siteOrigin(req);
    await sendMail('client', { to: row.client.email, ...feedbackRequest(mailOf(row, await loadSettings(), siteUrl), `${siteUrl}/feedback/${link.token}`) });
    await audit(user, 'feedback.requested', 'ticket', ticketId, undefined, { to: row.client.email, expires: expiresAt.toISOString() });
    return { ok: true };
  },
});
