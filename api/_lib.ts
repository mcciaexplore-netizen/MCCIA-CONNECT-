import { and, eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { db } from '../src/lib/db.js';
import { passwordStamp, verifyToken, readCookie, SESSION_COOKIE } from './_auth.js';
import { appSettings, auditLogs, coordinators, formQuestions, users } from './_schema.js';
import { BOOKING_FORM, DEFAULT_POST_CONSULTATION_QUESTIONS, DEFAULT_SETTINGS, EMAIL_PATTERN, MIN_PASSWORD_LENGTH, POST_CONSULTATION_FORM, ROLES, type AppSettings, type FormField, type Role } from '../src/types/index.js';

export { db };

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------- request helpers ----------

type Handler = (req: Request, url: URL) => Promise<unknown>;

/** Wraps per-method handlers into a Vercel web handler. Return data (sent as JSON) or a Response. */
export function handler(methods: Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Handler>>) {
  return {
    async fetch(req: Request) {
      const run = methods[req.method as keyof typeof methods];
      if (!run) return Response.json({ error: 'Method not allowed' }, { status: 405 });
      try {
        const result = await run(req, new URL(req.url));
        return result instanceof Response ? result : Response.json(result);
      } catch (e) {
        if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
        console.error(e);
        return Response.json({ error: 'Server error' }, { status: 500 });
      }
    },
  };
}

/**
 * A public answer the CDN may keep for `seconds` (and serve a little longer while it fetches a fresh one), so most visitors get it
 * from a server near them instead of from the database. Only for data that is the same for everybody.
 */
export const cached = (data: unknown, seconds: number) =>
  Response.json(data, { headers: { 'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds}` } });

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // falls through to the error below
  }
  throw new HttpError(400, 'Invalid request body');
}

/** Trimmed non-empty string, or a 400 naming the field. */
export function needString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  return value.trim();
}

export function optString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function needEmail(value: unknown): string {
  const email = needString(value, 'Email').toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email address');
  return email;
}

/** A new password: at least MIN_PASSWORD_LENGTH characters. It is stored exactly as typed (the login does not trim either). */
export function needPassword(value: unknown, label = 'Password'): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${label} is required`);
  if (value.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `${label} must be at least ${MIN_PASSWORD_LENGTH} characters`);
  return value;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres unique_violation (e.g. duplicate email). Drizzle wraps the driver's error, so the code may be on `cause`. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (error: unknown) => (error as { code?: string } | undefined)?.code;
  return code(e) === '23505' || code((e as { cause?: unknown } | undefined)?.cause) === '23505';
}

/** Validated client columns from a ClientInput-shaped object (booking form, add client, edit client). */
export function parseClient(raw: unknown) {
  const c = (raw ?? {}) as Record<string, unknown>;
  const isMember = Boolean(c.isMember);
  const employment = String(c.employmentRange ?? '').trim();
  if (employment && !/^\d{1,7}$/.test(employment)) throw new HttpError(400, 'Employment range must be a whole number');
  return {
    district: optString(c.district) || null,
    gender: optString(c.gender) || null,
    category: optString(c.category) || null,
    subSector: optString(c.subSector) || null,
    employmentRange: employment ? Number(employment) : null,
    onlinePresence: optString(c.onlinePresence) || null,
    companyName: needString(c.companyName, 'Company name'),
    personName: needString(c.personName, 'Contact name'),
    email: needEmail(c.email),
    phone: needString(c.phone, 'Phone'),
    jobTitle: optString(c.jobTitle) || null,
    scale: optString(c.scale) || null,
    industry: optString(c.industry) || null,
    udyamNo: optString(c.udyamNo) || null,
    acquisitionFrom: optString(c.acquisitionFrom) || null,
    isMember,
    membershipId: (isMember && optString(c.membershipId)) || null,
  };
}

/** The site's address as the browser reached it (Vercel passes the host on), for links in emails. */
export function siteOrigin(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

// ---------- auth ----------

export interface Actor {
  name: string;
  role: string;
}

export interface AuthUser extends Actor {
  id: string; // users.id
  email: string;
  role: Role;
  coordinatorId: string | null; // coordinators.id, for coordinators
}

/** The signed-in staff member behind the session cookie, or null (also for public callers). */
export async function getUser(req: Request): Promise<AuthUser | null> {
  const claims = verifyToken(readCookie(req, SESSION_COOKIE));
  if (!claims) return null;

  // The database has the last word, so deactivating someone cuts access immediately. One query: the login and, for a coordinator, their record.
  const [found] = await db
    .select({ row: users, coordinator: coordinators })
    .from(users)
    .leftJoin(coordinators, eq(coordinators.authUserId, users.id))
    .where(and(eq(users.id, claims.userId), eq(users.isActive, true)));
  const row = found?.row;
  if (!row || !(ROLES as readonly string[]).includes(row.role)) return null;
  if (claims.pv !== passwordStamp(row.passwordHash)) return null; // the password changed since this session began

  const user: AuthUser = { id: row.id, email: row.email, role: row.role, name: row.name, coordinatorId: null };
  if (row.role === 'coordinator') {
    if (!found.coordinator?.isActive) return null;
    user.coordinatorId = found.coordinator.id;
    user.name = found.coordinator.name;
  }
  return user;
}

export async function requireUser(req: Request, ...roles: Role[]): Promise<AuthUser> {
  const user = await getUser(req);
  if (!user) throw new HttpError(401, 'Sign in required');
  if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'You do not have access to this');
  return user;
}

/** WHERE clause limiting rows to the signed-in coordinator's own; admins see everything (undefined = no filter). */
export function ownedBy(user: AuthUser, column: PgColumn) {
  return user.role === 'super_admin' ? undefined : eq(column, user.coordinatorId!);
}

// ---------- audit & settings ----------

export async function audit(actor: Actor, action: string, entityType: string, entityId: string | null, oldValue?: Record<string, unknown>, newValue?: Record<string, unknown>) {
  await db.insert(auditLogs).values({ entityType, entityId, action, oldValue: oldValue ?? null, newValue: newValue ?? null, doneByName: actor.name, role: actor.role });
}

/** app_settings merged over the defaults, so every key is always present. */
export async function loadSettings(): Promise<AppSettings> {
  const rows = await db.select().from(appSettings);
  const settings: AppSettings = structuredClone(DEFAULT_SETTINGS);
  for (const row of rows) {
    if (row.key in settings) Object.assign(settings[row.key as keyof AppSettings], row.value);
  }
  return settings;
}

/** One form's questions by module id (the first row wins if a module has duplicates). */
async function loadQuestions(formType: string) {
  const rows = await db.select().from(formQuestions).where(eq(formQuestions.formType, formType));
  const byModule = new Map<string, FormField[]>();
  for (const row of rows) if (!byModule.has(row.moduleId)) byModule.set(row.moduleId, row.questions);
  return byModule;
}

export const loadBookingQuestions = () => loadQuestions(BOOKING_FORM);

/** Returns a lookup: a module's post-consultation questions, or the defaults when it has none saved. */
export async function loadPostQuestions() {
  const byModule = await loadQuestions(POST_CONSULTATION_FORM);
  return (moduleId: string) => byModule.get(moduleId) ?? DEFAULT_POST_CONSULTATION_QUESTIONS;
}
