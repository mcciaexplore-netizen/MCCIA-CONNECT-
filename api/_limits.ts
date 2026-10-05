import { and, eq, sql } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { loginAttempts } from './_schema.js';

/**
 * Per-IP limits, counted in login_attempts (one row per action + IP, a fixed window from the first attempt).
 * login: failed sign-ins; booking: bookings made on the public pages (signed-in staff are not limited).
 */
export const LIMITS = {
  login: { max: 5, minutes: 15, message: 'Too many attempts. Please try again in {m} minutes.' },
  booking: { max: 3, minutes: 60, message: 'Too many bookings from this network. Please try again in {m} minutes.' },
} as const;
export type LimitedAction = keyof typeof LIMITS;

/** The caller's IP as Vercel passes it on (x-real-ip, else the first x-forwarded-for entry). */
export function clientIp(req: Request) {
  return (req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown';
}

const windowOpen = (action: LimitedAction) => sql`${loginAttempts.windowStart} > now() - make_interval(mins => ${LIMITS[action].minutes})`;

/** The 429 for an action whose window started at windowStart, saying how long to wait. */
export function tooMany(action: LimitedAction, windowStart: Date) {
  const left = Math.max(1, Math.ceil((windowStart.getTime() + LIMITS[action].minutes * 60_000 - Date.now()) / 60_000));
  return new HttpError(429, LIMITS[action].message.replace('{m}', String(left)));
}

/** Throws 429 while this IP has used up its allowance for the action in the current window. */
export async function checkLimit(action: LimitedAction, ip: string) {
  const [row] = await db
    .select()
    .from(loginAttempts)
    .where(and(eq(loginAttempts.action, action), eq(loginAttempts.ip, ip), windowOpen(action)));
  if (row && row.attempts >= LIMITS[action].max) throw tooMany(action, row.windowStart);
}

/** Counts one more attempt (a new window starts once the old one is over). Throws 429 if that was the last one allowed. */
export async function countAttempt(action: LimitedAction, ip: string, email?: string) {
  const expired = sql`${loginAttempts.windowStart} <= now() - make_interval(mins => ${LIMITS[action].minutes})`;
  const [row] = await db
    .insert(loginAttempts)
    .values({ action, ip, email: email || null, attempts: 1 })
    .onConflictDoUpdate({
      target: [loginAttempts.action, loginAttempts.ip],
      set: {
        attempts: sql`case when ${expired} then 1 else ${loginAttempts.attempts} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${loginAttempts.windowStart} end`,
        email: email || null,
      },
    })
    .returning();
  return row;
}

/** Forgets an IP's attempts (a successful sign-in). */
export async function clearAttempts(action: LimitedAction, ip: string) {
  await db.delete(loginAttempts).where(and(eq(loginAttempts.action, action), eq(loginAttempts.ip, ip)));
}

