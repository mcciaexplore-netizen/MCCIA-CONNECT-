import { asc, eq } from 'drizzle-orm';
import { hashPassword } from './_auth.js';
import { audit, db, handler, HttpError, isUniqueViolation, needEmail, needString, optString, readBody, requireUser } from './_lib.js';
import { coordinators, users } from './_schema.js';

const color = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#C41E3A');
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
    const password = needString(body.password, 'Password');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');

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

  // Edit details or activate/deactivate. Deactivating also blocks their login.
  PATCH: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const id = needString(body.id, 'Coordinator');

    const [before] = await db.select().from(coordinators).where(eq(coordinators.id, id));
    if (!before) throw new HttpError(404, 'Coordinator not found');

    const patch: Partial<typeof coordinators.$inferInsert> = {};
    if (body.name !== undefined) {
      patch.name = needString(body.name, 'Name');
      patch.initials = initialsOf(patch.name);
    }
    if (body.phone !== undefined) patch.phone = optString(body.phone) || null;
    if (body.color !== undefined) patch.color = color(body.color);
    if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
    if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');

    const loginChange = before.authUserId && (patch.isActive !== undefined || patch.name !== undefined)
      ? [db.update(users).set({ ...(patch.isActive !== undefined && { isActive: patch.isActive }), ...(patch.name !== undefined && { name: patch.name }) }).where(eq(users.id, before.authUserId))]
      : [];
    const [[coordinator]] = await db.batch([db.update(coordinators).set(patch).where(eq(coordinators.id, id)).returning(), ...loginChange]);

    const changed = Object.keys(patch).filter((key) => key !== 'initials') as (keyof typeof patch)[];
    await audit(
      user,
      'coordinator.updated',
      'coordinator',
      id,
      Object.fromEntries(changed.map((key) => [key, before[key]])),
      Object.fromEntries(changed.map((key) => [key, patch[key]])),
    );
    return coordinator;
  },
});
