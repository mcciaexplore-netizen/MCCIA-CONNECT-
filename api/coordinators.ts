import { asc, eq } from 'drizzle-orm';
import { hashPassword } from './_auth.js';
import { parseHours } from './_availability.js';
import { audit, db, handler, HttpError, isUniqueViolation, needEmail, needPassword, needString, optString, readBody, requireUser, UUID } from './_lib.js';
import { coordinators, users } from './_schema.js';

const color = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#0157b3');
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');

export default handler({
  // Admins see everyone; a coordinator only sees their own record.
  GET: async (req) => {
    const user = await requireUser(req);
    const self = user.role === 'super_admin' ? undefined : eq(coordinators.id, user.coordinatorId!);
    return await db.select().from(coordinators).where(self).orderBy(asc(coordinators.name));
  },

  // Creates the login (a users row, role = coordinator) and the matching coordinator row in one step.
  POST: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const name = needString(body.name, 'Name');
    const email = needEmail(body.email);
    const password = needPassword(body.password);

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      const [, [coordinator]] = await db.batch([
        db.insert(users).values({ id: userId, email, passwordHash, name, role: 'coordinator' }),
        db
          .insert(coordinators)
          .values({ authUserId: userId, name, email, phone: optString(body.phone) || null, color: color(body.color), initials: initialsOf(name) })
          .returning(),
      ]);
      await audit(user, 'coordinator.created', 'coordinator', coordinator.id, undefined, { name, email });
      return coordinator;
    } catch (e) {
      throw isUniqueViolation(e) ? new HttpError(409, 'A coordinator with this email already exists') : e;
    }
  },

  // A coordinator's own hours { availability: { weeklyRules, dateOverrides } | null }. A coordinator sets their own; an admin sends
  // coordinatorId to set anyone's. null removes the limit: they can then be booked whenever a service is open.
  PUT: async (req) => {
    const user = await requireUser(req);
    const body = await readBody(req);
    const id = user.role === 'super_admin' ? needString(body.coordinatorId, 'Coordinator') : user.coordinatorId;
    const [before] = id && UUID.test(id) ? await db.select().from(coordinators).where(eq(coordinators.id, id)) : [];
    if (!before) throw new HttpError(404, 'Coordinator not found');

    const availability = body.availability === null ? null : parseHours((body.availability ?? {}) as Record<string, unknown>);
    const [coordinator] = await db.update(coordinators).set({ availability }).where(eq(coordinators.id, before.id)).returning();
    await audit(
      user,
      'coordinator.availability_changed',
      'coordinator',
      before.id,
      { limited: before.availability !== null },
      { limited: availability !== null, ...(availability && { weeklyRanges: availability.weeklyRules.length, blockedDates: availability.dateOverrides.length }) },
    );
    return coordinator;
  },

  // Edit any detail (name, email = their login, phone, colour, a new password), or activate / deactivate. Deactivating also blocks their login.
  // An empty password leaves the current one as it is.
  // PATCH /api/coordinators/:id/password { newPassword } (a vercel.json rewrite to ?password=:id) only sets the password.
  PATCH: async (req, url) => {
    const user = await requireUser(req, 'super_admin');
    const sent = await readBody(req);
    const passwordFor = url.searchParams.get('password') ?? /^\/api\/coordinators\/([^/]+)\/password\/?$/.exec(url.pathname)?.[1];
    const body = passwordFor ? { id: passwordFor, password: needPassword(sent.newPassword, 'New password') } : sent;
    const id = needString(body.id, 'Coordinator');

    const [before] = await db.select().from(coordinators).where(eq(coordinators.id, id));
    if (!before) throw new HttpError(404, 'Coordinator not found');

    const patch: Partial<typeof coordinators.$inferInsert> = {};
    if (body.name !== undefined) {
      patch.name = needString(body.name, 'Name');
      patch.initials = initialsOf(patch.name);
    }
    if (body.email !== undefined) patch.email = needEmail(body.email);
    if (body.phone !== undefined) patch.phone = optString(body.phone) || null;
    if (body.color !== undefined) patch.color = color(body.color);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    // Only what really changed is saved and logged (the edit form sends every field).
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) if (patch[key] === before[key]) delete patch[key];
    const passwordHash = typeof body.password === 'string' && body.password ? await hashPassword(needPassword(body.password)) : undefined;
    if (!Object.keys(patch).length && !passwordHash) throw new HttpError(400, 'Nothing to update');

    // The login (users row) follows the coordinator's name, email and active flag, and carries the password.
    const login = {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.email !== undefined && { email: patch.email }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      ...(passwordHash && { passwordHash }),
    };
    if (Object.keys(login).length && !before.authUserId) throw new HttpError(400, 'This coordinator has no login to change');
    const loginChange = Object.keys(login).length ? [db.update(users).set(login).where(eq(users.id, before.authUserId!))] : [];
    const own = Object.keys(patch).length ? db.update(coordinators).set(patch).where(eq(coordinators.id, id)).returning() : db.select().from(coordinators).where(eq(coordinators.id, id));
    let coordinator;
    try {
      [[coordinator]] = await db.batch([own, ...loginChange]);
    } catch (e) {
      throw isUniqueViolation(e) ? new HttpError(409, 'Someone else already uses that email') : e;
    }

    // The audit log says that a password changed, never what it is.
    const changed = Object.keys(patch).filter((key) => key !== 'initials') as (keyof typeof patch)[];
    await audit(
      user,
      'coordinator.updated',
      'coordinator',
      id,
      Object.fromEntries(changed.map((key) => [key, before[key]])),
      { ...Object.fromEntries(changed.map((key) => [key, patch[key]])), ...(passwordHash && { password: 'changed' }) },
    );
    return coordinator;
  },
});
