import { and, desc, eq, getTableColumns, inArray, ne, or, sql } from 'drizzle-orm';
import { audit, db, handler, HttpError, needString, optString, parseClient, readBody, requireUser, restartTicketNumbersIfNone, UUID, type AuthUser } from './_lib.js';
import { assignClient } from './_assign.js';
import { companyOf, returnFollowUps } from './_companies.js';
import { clearSheetRows, updateSheet } from './_live_excel.js';
import { inBackground, removeCalendarEvents } from './_sessions.js';
import { adminNotifications, auditLogs, bookings, clients, companies, coordinatorAssignments, coordinatorReassignments, coordinators, feedbackTokens, modules, tickets, users } from './_schema.js';
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

// What belongs to the company rather than to one person; an edit sets it on every contact of the company.
const COMPANY_TEXT = ['udyamNo', 'scale', 'industry', 'subSector', 'district', 'onlinePresence'] as const;

/**
 * PATCH { companyId, company: { companyName?, udyamNo?, isMember?, membershipId?, scale?, industry?, subSector?, district?, employmentRange?, onlinePresence? } }:
 * renames the company (its name and every contact's company name; another company that reads the same is refused) and sets the details that
 * were sent on all its contacts. Only what is sent changes. The contacts' rows in the Excel sheet follow.
 */
async function updateCompany(user: AuthUser, body: Record<string, unknown>) {
  const id = needString(body.companyId, 'Company');
  const [company] = UUID.test(id) ? await db.select().from(companies).where(eq(companies.id, id)) : [];
  if (!company) throw new HttpError(404, 'Company not found');
  const given = (body.company ?? {}) as Record<string, unknown>;

  const values: Partial<typeof clients.$inferInsert> = {};
  for (const key of COMPANY_TEXT) if (given[key] !== undefined) values[key] = optString(given[key]) || null;
  if (given.employmentRange !== undefined) {
    const employment = String(given.employmentRange ?? '').trim();
    if (employment && !/^\d{1,7}$/.test(employment)) throw new HttpError(400, 'Employment range must be a whole number');
    values.employmentRange = employment ? Number(employment) : null;
  }
  if (given.isMember !== undefined) values.isMember = Boolean(given.isMember);
  if (given.membershipId !== undefined) values.membershipId = optString(given.membershipId) || null;
  if (values.isMember === false) values.membershipId = null; // only members have a membership id

  const name = given.companyName === undefined ? undefined : needString(given.companyName, 'Company name');
  if (name && name !== company.name) {
    const [clash] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.nameNormalized, sql`normalize_company_name(${name})`), ne(companies.id, id)));
    if (clash) throw new HttpError(409, 'Another company already has this name (or one that reads the same). Open that company instead.');
  }
  const renamed = name !== undefined && name !== company.name;
  if (!renamed && !Object.keys(values).length) throw new HttpError(400, 'Nothing to update');

  const writes = [
    ...(renamed ? [db.update(companies).set({ name, nameNormalized: sql`normalize_company_name(${name})` }).where(eq(companies.id, id))] : []),
    db.update(clients).set({ ...(renamed && { companyName: name }), ...values }).where(eq(clients.companyId, id)),
  ];
  await db.batch(writes as unknown as [(typeof writes)[0], ...(typeof writes)[number][]]);
  const members = await db.select({ id: clients.id }).from(clients).where(eq(clients.companyId, id));
  await audit(user, 'company.updated', 'company', id, renamed ? { name: company.name } : undefined, { ...(renamed && { name }), ...values, contacts: members.length });
  updateSheet((await db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.clientId, members.map((m) => m.id)))).map((t) => t.id)); // their rows in the Excel sheet
  return { id, name: name ?? company.name, contacts: members.length };
}

const MAX_BULK_DELETE = 50; // each deletion also calls Google and Microsoft afterwards

/**
 * Removes clients for good with all their tickets, sessions, feedback links and coordinator history, their Calendar events and their rows in the
 * Excel sheet. `companyIds` removes those companies too, with every client in them; a company left with nobody goes as well. Nobody is emailed; the
 * audit log keeps a record of each client and company deleted. With no ticket left at all the numbering starts again at TKT-0001.
 * Returns what went, or undefined when none of it existed.
 */
async function deleteClients(user: AuthUser, clientIds: string[], companyIds: string[]) {
  const inCompanies = companyIds.length ? await db.select().from(clients).where(inArray(clients.companyId, companyIds)) : [];
  const wanted = [...new Set([...clientIds, ...inCompanies.map((c) => c.id)])];
  const found = wanted.length ? await db.select().from(clients).where(inArray(clients.id, wanted)) : [];
  const asked = companyIds.length ? await db.select().from(companies).where(inArray(companies.id, companyIds)) : [];
  if (!found.length && !asked.length) return undefined;
  const memberIds = found.map((c) => c.id);
  const sessions = memberIds.length
    ? await db.select({ clientId: bookings.clientId, bookingId: bookings.id, ticketId: tickets.id, ticketNumber: tickets.ticketNumber, eventId: bookings.googleEventId, moduleSlug: modules.slug }).from(bookings).innerJoin(tickets, eq(tickets.bookingId, bookings.id)).innerJoin(modules, eq(bookings.moduleId, modules.id)).where(inArray(bookings.clientId, memberIds))
    : [];
  const ticketIds = sessions.map((s) => s.ticketId);

  // The companies that end up with nobody: the ones asked for, and any whose last client is going.
  const touched = [...new Set([...found.flatMap((c) => (c.companyId ? [c.companyId] : [])), ...asked.map((c) => c.id)])];
  const staying = touched.length ? (await db.select({ id: clients.id, companyId: clients.companyId }).from(clients).where(inArray(clients.companyId, touched))).filter((c) => !memberIds.includes(c.id)) : [];
  const goneCompanies = touched.filter((id) => !staying.some((c) => c.companyId === id));

  // One transaction: everything of the clients, then the companies that are empty.
  const writes = [
    ...(ticketIds.length ? [db.delete(feedbackTokens).where(inArray(feedbackTokens.ticketId, ticketIds))] : []),
    ...(memberIds.length
      ? [
          db.delete(tickets).where(inArray(tickets.clientId, memberIds)),
          db.delete(bookings).where(inArray(bookings.clientId, memberIds)),
          db.delete(coordinatorAssignments).where(inArray(coordinatorAssignments.clientId, memberIds)),
          db.delete(coordinatorReassignments).where(inArray(coordinatorReassignments.clientId, memberIds)),
          db.delete(clients).where(inArray(clients.id, memberIds)),
        ]
      : []),
    ...(goneCompanies.length
      ? [
          db.delete(adminNotifications).where(inArray(adminNotifications.companyId, goneCompanies)),
          db.delete(coordinatorReassignments).where(inArray(coordinatorReassignments.companyId, goneCompanies)),
          db.delete(companies).where(inArray(companies.id, goneCompanies)),
        ]
      : []),
  ];
  await db.batch(writes as unknown as [(typeof writes)[0], ...(typeof writes)[number][]]);

  const names = new Map([...asked.map((c) => [c.id, c.name] as const), ...found.flatMap((c) => (c.companyId ? [[c.companyId, c.companyName] as const] : []))]);
  const numbersOf = (own: string[]) => sessions.filter((s) => own.includes(s.clientId)).map((s) => s.ticketNumber);
  await db.insert(auditLogs).values([
    ...found.map((c) => ({ entityType: 'client', entityId: c.id, action: 'client.deleted', oldValue: { company: c.companyName, contact: c.personName, email: c.email, tickets: numbersOf([c.id]) }, doneByName: user.name, role: user.role })),
    ...goneCompanies.map((id) => ({ entityType: 'company', entityId: id, action: 'company.deleted', oldValue: { company: names.get(id) ?? '', contacts: found.filter((c) => c.companyId === id).length, tickets: numbersOf(found.filter((c) => c.companyId === id).map((c) => c.id)) }, doneByName: user.name, role: user.role })),
  ]);
  clearSheetRows(sessions); // their rows leave the Excel sheet
  const eventIds = sessions.flatMap((s) => (s.eventId ? [s.eventId] : []));
  if (eventIds.length) inBackground(found.length === 1 ? `Removing the Google Calendar events of the deleted client ${found[0].personName} (${found[0].companyName})` : `Removing the Google Calendar events of ${found.length} deleted clients`, () => removeCalendarEvents(eventIds));
  await restartTicketNumbersIfNone();
  return { clientIds: memberIds, companyIds: goneCompanies, ticketIds, bookingIds: sessions.map((s) => s.bookingId) };
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
    if (body.companyId !== undefined) return await updateCompany(user, body);
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
    updateSheet((await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.clientId, id))).map((t) => t.id)); // the client's rows in the Excel sheet
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

  // ?id=<client>, ?company=<company>, or { clientIds } / { companyIds } up to MAX_BULK_DELETE (admins only): see deleteClients. A single client
  // answers { id, ticketIds, bookingIds }; the others { deleted, clientIds, companyIds, ticketIds, bookingIds }.
  DELETE: async (req, url) => {
    const user = await requireUser(req, 'super_admin');
    const clientParam = url.searchParams.get('id');
    const companyParam = url.searchParams.get('company');
    const body = clientParam === null && companyParam === null ? await readBody(req).catch(() => undefined) : undefined;
    const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : undefined);
    const clientIds = clientParam !== null ? [clientParam] : list(body?.clientIds);
    const companyIds = companyParam !== null ? [companyParam] : list(body?.companyIds);
    const noun = companyParam !== null || (!clientIds && companyIds) ? 'Company' : 'Client';
    if (!clientIds && !companyIds) throw new HttpError(404, 'Client not found');
    const all = [...(clientIds ?? []), ...(companyIds ?? [])];
    const single = clientParam !== null || companyParam !== null;
    if (!all.length || all.length > MAX_BULK_DELETE || !all.every((id) => UUID.test(id))) throw new HttpError(single ? 404 : 400, single ? `${noun} not found` : `Choose between 1 and ${MAX_BULK_DELETE}`);
    const done = await deleteClients(user, clientIds ?? [], companyIds ?? []);
    if (!done) throw new HttpError(404, `${noun} not found`);
    return clientParam !== null ? { id: clientParam, ticketIds: done.ticketIds, bookingIds: done.bookingIds } : { deleted: done.clientIds.length, ...done };
  },
});
