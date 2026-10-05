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
      await sendMail(user.email, 'CRM test email', 'Email sending from the CRM is working.');
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

    await sendMail(row.email, `${subject} [${row.ticket.ticketNumber}]`, message);
    await audit(user, 'email.sent', 'ticket', ticketId, undefined, { subject });
    return { ok: true };
  },
});
