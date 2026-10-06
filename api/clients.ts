import { desc, eq, getTableColumns, inArray, or, sql } from 'drizzle-orm';
import { audit, db, handler, HttpError, needString, optString, parseClient, readBody, requireUser, UUID } from './_lib.js';
import { assignClient } from './_assign.js';
import { companyOf, returnFollowUps } from './_companies.js';
import { bookings, clients, companies, coordinatorAssignments, coordinatorReassignments, coordinators, tickets, users } from './_schema.js';
import type { CoordinatorHistoryEntry } from '../src/types/index.js';

/**
 * Every coordinator change for one client, newest first, from coordinator_assignments and
 * coordinator_reassignments. Reassigning from the client page writes both rows at the same instant,
 * so that pair is shown once (as the reassignment, which carries the reason).
 */
async function coordinatorHistory(clientId: string): Promise<CoordinatorHistoryEntry[]> {
  const [{ companyId } = { companyId: null }] = await db.select({ companyId: clients.companyId }).from(clients).where(eq(clients.id, clientId));
  const [assignments, reassignments, coordinatorRows] = await Promise.all([
    db.select().from(coordinatorAssignments).where(eq(coordinatorAssignments.clientId, clientId)),
    db.select().from(coordinatorReassignments).where(companyId ? or(eq(coordinatorReassignments.clientId, clientId), eq(coordinatorReassignments.companyId, companyId)) : eq(coordinatorReassignments.clientId, clientId)),
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
  // ?history=<clientId> (admin) is that client's coordinator history. ?companies=1 (admin) is every company with its coordinator and
  // numbers. Otherwise: admins see every client; coordinators the clients assigned to them or with a ticket assigned to them.
  GET: async (req, url) => {
    if (url.searchParams.has('companies')) {
      await requireUser(req, 'super_admin');
      const rows = await db
        .select({
          ...getTableColumns(companies),
          clientCount: sql<number>`count(distinct ${clients.id})::int`,
          bookingCount: sql<number>`(count(${bookings.id}) filter (where ${bookings.status} <> 'cancelled'))::int`,
          lastBooking: sql<string | null>`max(${bookings.startTime}) filter (where ${bookings.status} <> 'cancelled')`,
        })
        .from(companies)
        .leftJoin(clients, eq(clients.companyId, companies.id))
        .leftJoin(bookings, eq(bookings.clientId, clients.id))
        .groupBy(companies.id)
        .orderBy(sql`max(${bookings.startTime}) desc nulls last`, companies.name);
      return rows.map((row) => ({ ...row, lastBooking: row.lastBooking ? new Date(row.lastBooking).toISOString() : null }));
    }
    const historyOf = url.searchParams.get('history');
    if (historyOf) {
      await requireUser(req, 'super_admin');
      if (!UUID.test(historyOf)) throw new HttpError(400, 'Invalid client');
      return await coordinatorHistory(historyOf);
    }
    const user = await requireUser(req);
    await returnFollowUps();
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
    const [created] = await db.insert(clients).values(parseClient((await readBody(req)).client)).returning();
    const company = await companyOf(created);
    const [client] = company.assignedCoordinatorId
      ? await db.update(clients).set({ assignedCoordinatorId: company.assignedCoordinatorId }).where(eq(clients.id, created.id)).returning()
      : [{ ...created, companyId: company.id }];
    if (company.assignedCoordinatorId) await db.insert(coordinatorAssignments).values({ clientId: client.id, coordinatorId: company.assignedCoordinatorId, assignedBy: user.id });
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
    let [client] = await db.update(clients).set(values).where(eq(clients.id, id)).returning();
    // A different company name puts the client in that company, and under its coordinator when it has one.
    if (values.companyName !== before.companyName) {
      const company = await companyOf({ id, companyName: values.companyName, companyId: null });
      if (company.assignedCoordinatorId && company.assignedCoordinatorId !== client.assignedCoordinatorId) {
        await db.insert(coordinatorAssignments).values({ clientId: id, coordinatorId: company.assignedCoordinatorId, assignedBy: user.id });
        [client] = await db.update(clients).set({ assignedCoordinatorId: company.assignedCoordinatorId }).where(eq(clients.id, id)).returning();
      }
      client = { ...client, companyId: company.id };
    }

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
