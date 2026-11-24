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

/** Counts one more attempt (a new window starts once the old one is over). One atomic statement, so parallel requests get distinct counts. */
async function countAttempt(action: LimitedAction, ip: string, email?: string) {
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

/**
 * Takes one of the IP's allowed attempts BEFORE the work is done, and throws 429 once they are used up. Because counting is
 * atomic, a burst of parallel requests cannot all slip through a check. Give the attempt back with refundAttempt when the
 * work succeeded (a sign-in) or never happened (a booking that failed).
 */
export async function reserveAttempt(action: LimitedAction, ip: string, email?: string) {
  const attempt = await countAttempt(action, ip, email);
  if (attempt.attempts > LIMITS[action].max) throw tooMany(action, attempt.windowStart);
  return attempt;
}

/** Gives one attempt back (never below zero). Other people's failures from the same IP stay counted. */
export async function refundAttempt(action: LimitedAction, ip: string) {
  await db
    .update(loginAttempts)
    .set({ attempts: sql`greatest(${loginAttempts.attempts} - 1, 0)` })
    .where(and(eq(loginAttempts.action, action), eq(loginAttempts.ip, ip), windowOpen(action)));
}
