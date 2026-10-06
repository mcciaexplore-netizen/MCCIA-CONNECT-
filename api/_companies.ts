import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from './_lib.js';
import { bookings, clients, companies, tickets } from './_schema.js';

/**
 * Companies decide who a client's coordinator is: every client of a company shares it. Two names are the same company when they match
 * without capitals, punctuation or words like "Pvt", "Ltd" and "& Co" (the normalize_company_name() database function is the one rule for that).
 */

/** The company a name belongs to, if it has one yet. */
export async function findCompany(name: string) {
  const [company] = await db.select().from(companies).where(eq(companies.nameNormalized, sql`normalize_company_name(${name})`));
  return company;
}

/** The client's company, created (and the client linked to it) if that was never done. */
export async function companyOf(client: { id: string; companyName: string; companyId: string | null }) {
  if (client.companyId) {
    const [company] = await db.select().from(companies).where(eq(companies.id, client.companyId));
    if (company) return company;
  }
  const [created] = await db
    .insert(companies)
    .values({ name: client.companyName, nameNormalized: sql`normalize_company_name(${client.companyName})` })
    .onConflictDoNothing()
    .returning();
  const company = created ?? (await findCompany(client.companyName))!;
  await db.update(clients).set({ companyId: company.id }).where(eq(clients.id, client.id));
  return company;
}

/**
 * A ticket booked with a stand-in coordinator (the company's own was busy) goes back to the company's coordinator once the session is over.
 * Run before coordinators read tickets, so nothing needs a timer.
 */
export async function returnFollowUps() {
  await db
    .update(tickets)
    .set({ coordinatorId: sql`${tickets.followUpCoordinatorId}`, followUpCoordinatorId: null })
    .where(and(isNotNull(tickets.followUpCoordinatorId), inArray(tickets.bookingId, db.select({ id: bookings.id }).from(bookings).where(lt(bookings.endTime, new Date())))));
}
