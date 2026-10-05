import { eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, needString, readBody, requireUser } from './_lib.js';
import { sendMail } from './_integrations.js';
import { clients, tickets } from './_schema.js';

export default handler({
  // { test: true } emails the signed-in admin; { ticketId, subject, message } emails that ticket's client.
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

    const ticketId = needString(body.ticketId, 'Ticket');
    const subject = needString(body.subject, 'Subject');
    const message = needString(body.message, 'Message');

    const [row] = await db
      .select({ ticket: tickets, email: clients.email })
      .from(tickets)
      .innerJoin(clients, eq(tickets.clientId, clients.id))
      .where(eq(tickets.id, ticketId));
    if (!row) throw new HttpError(404, 'Ticket not found');
    if (user.role !== 'super_admin' && row.ticket.coordinatorId !== user.coordinatorId) throw new HttpError(403, 'This ticket is not assigned to you');

    await sendMail('client', { to: row.email, subject: `${subject} [${row.ticket.ticketNumber}]`, text: message });
    await audit(user, 'email.sent', 'ticket', ticketId, undefined, { subject });
    return { ok: true };
  },
});
