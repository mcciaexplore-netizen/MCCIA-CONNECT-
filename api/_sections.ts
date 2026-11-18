import { asc, desc, eq, sql } from 'drizzle-orm';
import { audit, db, HttpError, needString, optString, readBody, requireUser, UUID } from './_lib.js';
import { applets, applications, workshops } from './_schema.js';
import { BOOKING_MODES, WORKSHOP_KINDS, WORKSHOP_STATUSES, type BookingMode, type WorkshopKind, type WorkshopStatus } from '../src/types/index.js';

/**
 * The Applications, Applets and Workshops pages. They have no function of their own (Vercel Hobby allows 12): /api/applications,
 * /api/applets and /api/workshops are rewrites onto /api/modules?section=..., which hands the request to these.
 */
export const SECTIONS = ['applications', 'applets', 'workshops'] as const;
export type Section = (typeof SECTIONS)[number];
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function link(value: unknown, label: string, required: boolean): string | null {
  const text = required ? needString(value, label) : optString(value);
  if (!text) return null;
  const full = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    new URL(full);
  } catch {
    throw new HttpError(400, `${label} is not a valid web address`);
  }
  return full;
}
const day = (value: unknown, label: string) => {
  const text = optString(value);
  if (text && !DATE.test(text)) throw new HttpError(400, `${label} must be a date`);
  return text || null;
};
const time = (value: unknown, label: string) => {
  const text = optString(value);
  if (text && !TIME.test(text)) throw new HttpError(400, `${label} must be a time (HH:MM)`);
  return text || null;
};
const idOf = (body: Record<string, unknown>, label: string) => {
  const id = needString(body.id, label);
  if (!UUID.test(id)) throw new HttpError(404, `${label} not found`);
  return id;
};

// ---------- Applications: everyone signed in reads, admins keep the list ----------

async function applicationsApi(req: Request, method: Method) {
  if (method === 'GET') {
    await requireUser(req);
    return await db.select().from(applications).orderBy(asc(applications.name));
  }
  const user = await requireUser(req, 'super_admin');
  const body = await readBody(req);
  if (method === 'DELETE') {
    const [gone] = await db.delete(applications).where(eq(applications.id, idOf(body, 'Application'))).returning();
    if (!gone) throw new HttpError(404, 'Application not found');
    await audit(user, 'application.deleted', 'application', gone.id, { name: gone.name, url: gone.url });
    return gone;
  }
  const values = { name: needString(body.name, 'Name'), url: link(body.url, 'Link', true)!, description: optString(body.description) || null };
  if (method === 'POST') {
    const [row] = await db.insert(applications).values(values).returning();
    await audit(user, 'application.created', 'application', row.id, undefined, values);
    return row;
  }
  if (method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
  const [row] = await db.update(applications).set(values).where(eq(applications.id, idOf(body, 'Application'))).returning();
  if (!row) throw new HttpError(404, 'Application not found');
  await audit(user, 'application.updated', 'application', row.id, undefined, values);
  return row;
}

// ---------- Applets: deployed applets, entered by hand (admins only) ----------

async function appletsApi(req: Request, method: Method) {
  const user = await requireUser(req, 'super_admin');
  if (method === 'GET') return await db.select().from(applets).orderBy(sql`${applets.deployedOn} desc nulls last`, desc(applets.createdAt));
  const body = await readBody(req);
  if (method === 'DELETE') {
    const [gone] = await db.delete(applets).where(eq(applets.id, idOf(body, 'Applet'))).returning();
    if (!gone) throw new HttpError(404, 'Applet not found');
    await audit(user, 'applet.deleted', 'applet', gone.id, { company: gone.companyName, applet: gone.appletName });
    return gone;
  }
  const values = {
    companyName: needString(body.companyName, 'Company name'),
    contactName: optString(body.contactName) || null,
    appletName: needString(body.appletName, 'Applet name'),
    liveLink: link(body.liveLink, 'Live link', false),
    deployedOn: day(body.deployedOn, 'Deployed on'),
    notes: optString(body.notes) || null,
  };
  if (method === 'POST') {
    const [row] = await db.insert(applets).values(values).returning();
    await audit(user, 'applet.created', 'applet', row.id, undefined, values);
    return row;
  }
  if (method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
  const [row] = await db.update(applets).set(values).where(eq(applets.id, idOf(body, 'Applet'))).returning();
  if (!row) throw new HttpError(404, 'Applet not found');
  await audit(user, 'applet.updated', 'applet', row.id, undefined, values);
  return row;
}

// ---------- Workshops: one row per event, admins only ----------

function workshopValues(body: Record<string, unknown>) {
  if (!BOOKING_MODES.includes(body.mode as BookingMode)) throw new HttpError(400, 'Mode must be online or offline');
  if (!WORKSHOP_STATUSES.includes(body.status as WorkshopStatus)) throw new HttpError(400, 'Choose a status');
  const heldOn = day(body.heldOn, 'Date');
  if (!heldOn) throw new HttpError(400, 'Date is required');
  const startTime = time(body.startTime, 'Start time');
  const endTime = time(body.endTime, 'End time');
  if (startTime && endTime && endTime <= startTime) throw new HttpError(400, 'The end time must be after the start time');
  const count = optString(String(body.participants ?? ''));
  if (count && !/^\d{1,6}$/.test(count)) throw new HttpError(400, 'Participants must be a whole number');
  return {
    title: needString(body.title, 'Title'),
    heldOn,
    startTime,
    endTime,
    mode: body.mode as BookingMode,
    venue: optString(body.venue) || null,
    trainer: optString(body.trainer) || null,
    organisation: optString(body.organisation) || null,
    participants: count ? Number(count) : null,
    status: body.status as WorkshopStatus,
    notes: optString(body.notes) || null,
  };
}

async function workshopsApi(req: Request, method: Method) {
  const user = await requireUser(req, 'super_admin');
  if (method === 'GET') return await db.select().from(workshops).orderBy(desc(workshops.heldOn), desc(workshops.startTime));
  const body = await readBody(req);
  if (method === 'DELETE') {
    const [gone] = await db.delete(workshops).where(eq(workshops.id, idOf(body, 'Workshop'))).returning();
    if (!gone) throw new HttpError(404, 'Workshop not found');
    await audit(user, 'workshop.deleted', 'workshop', gone.id, { number: gone.ticketNumber, title: gone.title });
    return gone;
  }
  const values = workshopValues(body);
  if (method === 'POST') {
    // The kind decides the number series (W- or M-), so it is chosen once, here.
    if (!WORKSHOP_KINDS.includes(body.kind as WorkshopKind)) throw new HttpError(400, 'Choose Workshop or Mini Session');
    const [row] = await db.insert(workshops).values({ ...values, kind: body.kind as WorkshopKind }).returning();
    await audit(user, 'workshop.created', 'workshop', row.id, undefined, { number: row.ticketNumber, ...values });
    return row;
  }
  if (method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
  const [row] = await db.update(workshops).set(values).where(eq(workshops.id, idOf(body, 'Workshop'))).returning();
  if (!row) throw new HttpError(404, 'Workshop not found');
  await audit(user, 'workshop.updated', 'workshop', row.id, undefined, { number: row.ticketNumber, ...values });
  return row;
}

/** Which section a request is for: ?section= (after the rewrite) or the path itself (/api/workshops). */
export function sectionOf(url: URL): Section | undefined {
  const name = url.searchParams.get('section') ?? /^\/api\/([a-z]+)\/?$/.exec(url.pathname)?.[1];
  return SECTIONS.find((s) => s === name);
}

export function sectionApi(section: Section, req: Request, method: Method) {
  return section === 'applications' ? applicationsApi(req, method) : section === 'applets' ? appletsApi(req, method) : workshopsApi(req, method);
}
