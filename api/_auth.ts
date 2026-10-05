import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './_lib.js';

/**
 * Passwords and sessions with Node's built-in crypto, so no extra library is needed:
 * passwords are hashed with scrypt, and a session is an HS256 JWT in an httpOnly cookie.
 */

const derive = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await derive(password, salt, KEY_LENGTH)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  const actual = await derive(password, Buffer.from(salt, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- JWT ----------

export const SESSION_COOKIE = 'session';
export const SESSION_SECONDS = 7 * 24 * 60 * 60;

const secret = () => {
  const value = process.env.JWT_SECRET;
  if (!value) throw new HttpError(500, 'JWT_SECRET is not set on the server');
  return value;
};
const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest();

/**
 * A short fingerprint of a password hash, kept in the session token (claim `pv`). Changing a password changes it, which
 * ends every session that was signed in with the old one. It is keyed with the server secret, so it reveals nothing.
 */
export const passwordStamp = (passwordHash: string) => createHmac('sha256', secret()).update(`pv:${passwordHash}`).digest('base64url').slice(0, 22);

/** A signed token for the user: { userId, role, coordinatorId, pv } that expires after a week. */
export function signToken(claims: { userId: string; role: string; coordinatorId: string | null; pv: string }) {
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }))}`;
  return `${body}.${b64(sign(body))}`;
}

/** The claims of a token with a valid signature that has not expired, otherwise null. */
export function verifyToken(token: string | null | undefined): { userId: string; role: string; coordinatorId: string | null; pv?: string } | null {
  const [header, payload, signature] = token?.split('.') ?? [];
  if (!header || !payload || !signature) return null;
  const expected = sign(`${header}.${payload}`);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof claims.userId === 'string' && typeof claims.exp === 'number' && claims.exp > Date.now() / 1000 ? claims : null;
  } catch {
    return null;
  }
}

// ---------- cookie ----------

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** The Set-Cookie header that stores (or, with no token, clears) the session. */
export function sessionCookie(req: Request, token: string | null) {
  const secure = new URL(req.url).protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  return `${SESSION_COOKIE}=${token ?? ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? SESSION_SECONDS : 0}${secure ? '; Secure' : ''}`;
}
