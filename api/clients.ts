import { desc, eq, inArray, or } from 'drizzle-orm';
import { audit, db, handler, HttpError, needString, optString, parseClient, readBody, requireUser, UUID } from './_lib.js';
import { assignClient } from './_assign.js';
import { clients, coordinatorAssignments, coordinatorReassignments, coordinators, tickets, users } from './_schema.js';
import type { CoordinatorHistoryEntry } from '../src/types/index.js';

/**
 * Every coordinator change for one client, newest first, from coordinator_assignments and
 * coordinator_reassignments. Reassigning from the client page writes both rows at the same instant,
 * so that pair is shown once (as the reassignment, which carries the reason).
 */
async function coordinatorHistory(clientId: string): Promise<CoordinatorHistoryEntry[]> {
  const [assignments, reassignments, coordinatorRows] = await Promise.all([
    db.select().from(coordinatorAssignments).where(eq(coordinatorAssignments.clientId, clientId)),
    db.select().from(coordinatorReassignments).where(eq(coordinatorReassignments.clientId, clientId)),
    db.select({ id: coordinators.id, name: coordinators.name }).from(coordinators),
  ]);
  const names = new Map(coordinatorRows.map((c) => [c.id, c.name]));
  const paired = new Set(reassignments.map((r) => `${r.toCoordinatorId}|${r.createdAt.getTime()}`));

  const events = [
    ...assignments
      .filter((a) => !paired.has(`${a.coordinatorId}|${a.assignedAt.getTime()}`))
      .map((a) => ({ id: a.id, to: a.coordinatorId, from: null, by: a.assignedBy, at: a.assignedAt, reason: null })),
    ...reassignments.map((r) => ({ id: r.id, to: r.toCoordinatorId, from: r.fromCoordinatorId, by: r.doneBy, at: r.createdAt, reason: r.reason })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Who made each change (admins and coordinators alike are users).
  const byIds = [...new Set(events.flatMap((e) => (e.by ? [e.by] : [])))];
  const people = new Map((byIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, byIds)) : []).map((u) => [u.id, u.name]));
  return events.map((e) => ({
    id: e.id,
    coordinator: names.get(e.to) ?? 'Unknown',
    from: e.from ? (names.get(e.from) ?? 'Unknown') : null,
    assignedBy: (e.by && people.get(e.by)) || 'Unknown',
    at: e.at.toISOString(),
    reason: e.reason,
  }));
}

export default handler({
  // ?history=<clientId> (admin) is that client's coordinator history. Otherwise: admins see every client;
  // coordinators the clients assigned to them or with a ticket assigned to them.
  GET: async (req, url) => {
    const historyOf = url.searchParams.get('history');
    if (historyOf) {
      await requireUser(req, 'super_admin');
      if (!UUID.test(historyOf)) throw new HttpError(400, 'Invalid client');
      return await coordinatorHistory(historyOf);
    }
    const user = await requireUser(req);
    const mine =
      user.role === 'super_admin'
        ? undefined
        : or(
            eq(clients.assignedCoordinatorId, user.coordinatorId!),
            inArray(clients.id, db.select({ id: tickets.clientId }).from(tickets).where(eq(tickets.coordinatorId, user.coordinatorId!))),
          );
    return await db.select().from(clients).where(mine).orderBy(desc(clients.createdAt));
  },

  POST: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const [client] = await db.insert(clients).values(parseClient((await readBody(req)).client)).returning();
    await audit(user, 'client.created', 'client', client.id, undefined, { company: client.companyName, contact: client.personName });
    return client;
  },

  PATCH: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const id = needString(body.id, 'Client');
    const [before] = await db.select().from(clients).where(eq(clients.id, id));
    if (!before) throw new HttpError(404, 'Client not found');

    const values = parseClient(body.client);
    const [client] = await db.update(clients).set(values).where(eq(clients.id, id)).returning();

    const changed = (Object.keys(values) as (keyof typeof values)[]).filter((key) => values[key] !== before[key]);
    await audit(user, 'client.updated', 'client', id, Object.fromEntries(changed.map((k) => [k, before[k]])), Object.fromEntries(changed.map((k) => [k, values[k]])));
    return client;
  },

  // Assigns a coordinator to a client, or reassigns (a reason of 20+ characters is then required). The client's open
  // tickets and upcoming sessions move to the new coordinator, and both coordinators are emailed (see _assign.ts).
  PUT: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    await assignClient(user, needString(body.clientId, 'Client'), needString(body.coordinatorId, 'Coordinator'), optString(body.reason));
    return { ok: true };
  },
});
