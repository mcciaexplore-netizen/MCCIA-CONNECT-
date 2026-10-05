import { asc, eq, sql } from 'drizzle-orm';
import { hashPassword, sessionCookie, signToken, verifyPassword } from '../_auth.js';
import { audit, db, getUser, handler, HttpError, isUniqueViolation, needEmail, needPassword, needString, optString, readBody, requireUser, type AuthUser } from '../_lib.js';
import { checkLimit, clearAttempts, clientIp, countAttempt, LIMITS, tooMany } from '../_limits.js';
import { coordinators, users } from '../_schema.js';

/** What the browser keeps in its context: who is signed in. */
const me = (user: AuthUser) => ({ userId: user.id, role: user.role, coordinatorId: user.coordinatorId, name: user.name, email: user.email });

// Verified against this when the email is unknown, so the reply takes as long as for a wrong password.
const DECOY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

const login = handler({
  // { email, password }: sets the session cookie (an httpOnly JWT) and returns who signed in.
  // 5 failed attempts from one IP within 15 minutes lock that IP out until the window ends (the 5th failure already says so).
  POST: async (req) => {
    const body = await readBody(req);
    const email = optString(body.email).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = clientIp(req);
    await checkLimit('login', ip);
    const refuse = async () => {
      const attempt = await countAttempt('login', ip, email);
      return attempt.attempts >= LIMITS.login.max ? tooMany('login', attempt.windowStart) : new HttpError(401, 'Invalid credentials');
    };

    const [row] = await db.select().from(users).where(eq(users.email, email));
    const valid = await verifyPassword(password, row?.passwordHash ?? DECOY_HASH);
    if (!row || !valid || !row.isActive) throw await refuse();

    let coordinatorId: string | null = null;
    if (row.role === 'coordinator') {
      const [coordinator] = await db.select().from(coordinators).where(eq(coordinators.authUserId, row.id));
      if (!coordinator?.isActive) throw await refuse();
      coordinatorId = coordinator.id;
    }
    await clearAttempts('login', ip);
    const token = signToken({ userId: row.id, role: row.role, coordinatorId });
    const user: AuthUser = { id: row.id, email: row.email, role: row.role, name: row.name, coordinatorId };
    return Response.json(me(user), { headers: { 'Set-Cookie': sessionCookie(req, token) } });
  },
});

const logout = handler({
  POST: async (req) => Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(req, null) } }),
});

const current = handler({
  // Who the session cookie belongs to: { userId, role, coordinatorId }.
  GET: async (req) => {
    const user = await getUser(req);
    if (!user) throw new HttpError(401, 'Sign in required');
    return me(user);
  },
});

const createUser = handler({
  // Creates an admin login: { email, password, name }. Coordinators are created with POST /api/coordinators.
  // The very first admin has nobody to sign in as, so while there are no users at all the request needs { setupKey } = JWT_SECRET.
  POST: async (req) => {
    const body = await readBody(req);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const actor = count === 0 ? null : await requireUser(req, 'super_admin');
    if (!actor && (!process.env.JWT_SECRET || body.setupKey !== process.env.JWT_SECRET)) throw new HttpError(403, 'The first admin needs the setup key (JWT_SECRET)');

    const email = needEmail(body.email);
    const name = needString(body.name, 'Name');
    const password = needPassword(body.password);
    try {
      const [created] = await db.insert(users).values({ email, name, role: 'super_admin', passwordHash: await hashPassword(password) }).returning({ id: users.id });
      await audit(actor ?? { name, role: 'super_admin' }, 'user.created', 'user', created.id, undefined, { email, role: 'super_admin' });
      return { id: created.id, email, name, role: 'super_admin' };
    } catch (e) {
      throw isUniqueViolation(e) ? new HttpError(409, 'A user with this email already exists') : e;
    }
  },
});

const admins = handler({
  // The admin logins, for Settings > Team (coordinators are listed by /api/coordinators).
  GET: async (req) => {
    await requireUser(req, 'super_admin');
    return await db.select({ id: users.id, email: users.email, name: users.name, isActive: users.isActive }).from(users).where(eq(users.role, 'super_admin')).orderBy(asc(users.name));
  },
});

/** { currentPassword, newPassword }: changes the signed-in person's own password. (A wrong current password is a 400, not a 401, which would sign them out.) */
async function changeOwnPassword(req: Request) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const newPassword = needPassword(body.newPassword, 'New password');
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  if (!(await verifyPassword(typeof body.currentPassword === 'string' ? body.currentPassword : '', row.passwordHash))) throw new HttpError(400, 'Your current password is not right');
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, user.id));
  await audit(user, 'user.password_changed', 'user', user.id);
  return { ok: true };
}

// PATCH is the documented method; POST keeps working for older pages.
const changePassword = handler({ PATCH: changeOwnPassword, POST: changeOwnPassword });

const routes: Record<string, { fetch: (req: Request) => Promise<Response> }> = { login, logout, me: current, 'create-user': createUser, users: admins, 'change-password': changePassword };

// One function for /api/auth/login, /logout, /me, /create-user, /users and /change-password (Vercel Hobby allows 12 functions).
export default {
  fetch: (req: Request) => {
    const route = routes[new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''];
    return route ? route.fetch(req) : Promise.resolve(Response.json({ error: 'Not found' }, { status: 404 }));
  },
};
