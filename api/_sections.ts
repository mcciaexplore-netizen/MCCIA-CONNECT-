import { asc, desc, eq, sql } from 'drizzle-orm';
import { audit, db, HttpError, isUniqueViolation, needString, optString, readBody, requireUser, UUID } from './_lib.js';
import { applets, applications, workshopParticipants, workshops } from './_schema.js';
import { BOOKING_MODES, kindOfCode, WORKSHOP_CODE, WORKSHOP_STATUSES, type BookingMode, type WorkshopStatus } from '../src/types/index.js';

/**
 * The Applications, Applets and Workshops pages. They have no function of their own (Vercel Hobby allows 12): /api/applications,
 * /api/applets, /api/workshops and /api/participants are rewrites onto /api/modules?section=..., which hands the request to these.
 */
export const SECTIONS = ['applications', 'applets', 'workshops', 'participants'] as const;
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

/** A checked applet from the form or from a row of an imported file (throws an HttpError naming the problem). */
export const appletValues = (body: Record<string, unknown>) => ({
  companyName: needString(body.companyName, 'Company name'),
  membership: optString(body.membership) || null,
  membershipNo: optString(body.membershipNo) || null,
  contactName: optString(body.contactName) || null,
  phone: optString(body.phone) || null,
  email: optString(body.email) || null,
  appletName: optString(body.appletName) || null,
  liveLink: link(body.liveLink, 'Live link', false),
  deployedOn: day(body.deployedOn, 'Deployed on'),
  notes: optString(body.notes) || null,
});

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
  const values = appletValues(body);
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

// ---------- Workshops (batches) and their participants: admins only ----------

/** A Workshop ID: W21, W-Pilot, E01 ... (its first letter is the type: W Workshop, E Mini Session). */
export function workshopCode(value: unknown) {
  const code = needString(value, 'Workshop ID').replace(/\s+/g, ' ');
  if (!WORKSHOP_CODE.test(code)) throw new HttpError(400, `Workshop ID "${code}" must start with W (Workshop) or E (Mini Session), e.g. W21 or E01`);
  return code[0].toUpperCase() + code.slice(1);
}

/** A checked workshop from the form (or made up from an imported file). */
export function workshopValues(body: Record<string, unknown>) {
  if (!BOOKING_MODES.includes(body.mode as BookingMode)) throw new HttpError(400, 'Mode must be online or offline');
  if (!WORKSHOP_STATUSES.includes(body.status as WorkshopStatus)) throw new HttpError(400, 'Choose a status');
  const startTime = time(body.startTime, 'Start time');
  const endTime = time(body.endTime, 'End time');
  if (startTime && endTime && endTime <= startTime) throw new HttpError(400, 'The end time must be after the start time');
  const code = workshopCode(body.code);
  return {
    code,
    kind: kindOfCode(code),
    title: optString(body.title), // the workshop's name; empty until someone gives it one
    heldOn: day(body.heldOn, 'Date'),
    startTime,
    endTime,
    mode: body.mode as BookingMode,
    venue: optString(body.venue) || null,
    trainer: optString(body.trainer) || null,
    organisation: optString(body.organisation) || null,
    status: body.status as WorkshopStatus,
    notes: optString(body.notes) || null,
  };
}

/** The participant's columns that are plain text, as the form and the file send them. */
export const PARTICIPANT_TEXT = ['companyName', 'udyamNo', 'membershipNo', 'membership', 'phone', 'email', 'designation', 'mode', 'month', 'timeSlot', 'confirmationStatus', 'attendance', 'deploymentStatus', 'allocation', 'consStatus', 'calling'] as const;

/** A checked participant (everything but the workshop it belongs to). */
export const participantValues = (body: Record<string, unknown>) => ({
  ...(Object.fromEntries(PARTICIPANT_TEXT.map((key) => [key, optString(body[key]) || null])) as Record<(typeof PARTICIPANT_TEXT)[number], string | null>),
  personName: needString(body.personName, 'Name'),
  sessionDate: day(body.sessionDate, 'Date'),
});

const saveError = (e: unknown, code: string): never => {
  throw isUniqueViolation(e) ? new HttpError(409, `There is already a workshop ${code}`) : e;
};

async function workshopsApi(req: Request, method: Method) {
  const user = await requireUser(req, 'super_admin');
  if (method === 'GET') return await db.select().from(workshops).orderBy(sql`${workshops.heldOn} desc nulls last`, asc(workshops.code));
  const body = await readBody(req);
  if (method === 'DELETE') {
    const [gone] = await db.delete(workshops).where(eq(workshops.id, idOf(body, 'Workshop'))).returning(); // its participants go with it (on delete cascade)
    if (!gone) throw new HttpError(404, 'Workshop not found');
    await audit(user, 'workshop.deleted', 'workshop', gone.id, { code: gone.code, title: gone.title });
    return gone;
  }
  const values = workshopValues(body);
  if (method === 'POST') {
    const [row] = await db.insert(workshops).values(values).returning().catch((e) => saveError(e, values.code));
    await audit(user, 'workshop.created', 'workshop', row.id, undefined, values);
    return row;
  }
  if (method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
  const [row] = await db.update(workshops).set(values).where(eq(workshops.id, idOf(body, 'Workshop'))).returning().catch((e) => saveError(e, values.code));
  if (!row) throw new HttpError(404, 'Workshop not found');
  await audit(user, 'workshop.updated', 'workshop', row.id, undefined, values);
  return row;
}

async function participantsApi(req: Request, method: Method) {
  const user = await requireUser(req, 'super_admin');
  if (method === 'GET') return await db.select().from(workshopParticipants).orderBy(asc(workshopParticipants.personName));
  const body = await readBody(req);
  if (method === 'DELETE') {
    const [gone] = await db.delete(workshopParticipants).where(eq(workshopParticipants.id, idOf(body, 'Participant'))).returning();
    if (!gone) throw new HttpError(404, 'Participant not found');
    await audit(user, 'participant.deleted', 'workshop', gone.workshopId, { name: gone.personName, company: gone.companyName });
    return gone;
  }
  const values = participantValues(body);
  if (method === 'POST') {
    const workshopId = needString(body.workshopId, 'Workshop');
    const [workshop] = UUID.test(workshopId) ? await db.select({ id: workshops.id }).from(workshops).where(eq(workshops.id, workshopId)) : [];
    if (!workshop) throw new HttpError(404, 'Workshop not found');
    const [row] = await db.insert(workshopParticipants).values({ ...values, workshopId }).returning();
    await audit(user, 'participant.added', 'workshop', workshopId, undefined, values);
    return row;
  }
  if (method !== 'PATCH') throw new HttpError(405, 'Method not allowed');
  const [row] = await db.update(workshopParticipants).set(values).where(eq(workshopParticipants.id, idOf(body, 'Participant'))).returning();
  if (!row) throw new HttpError(404, 'Participant not found');
  await audit(user, 'participant.updated', 'workshop', row.workshopId, undefined, values);
  return row;
}

/** Which section a request is for: ?section= (after the rewrite) or the path itself (/api/workshops). */
export function sectionOf(url: URL): Section | undefined {
  const name = url.searchParams.get('section') ?? /^\/api\/([a-z]+)\/?$/.exec(url.pathname)?.[1];
  return SECTIONS.find((s) => s === name);
}

export function sectionApi(section: Section, req: Request, method: Method) {
  const run = { applications: applicationsApi, applets: appletsApi, workshops: workshopsApi, participants: participantsApi }[section];
  return run(req, method);
}
