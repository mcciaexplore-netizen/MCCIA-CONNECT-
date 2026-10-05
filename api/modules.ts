import { and, asc, eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, isUniqueViolation, loadBookingQuestions, loadPostQuestions, loadSettings, needString, optString, readBody, requireUser } from './_lib.js';
import { formQuestions, modules } from './_schema.js';
import { BOOKING_FORM, DEFAULT_POST_CONSULTATION_QUESTIONS, FIELD_TYPES, POST_CONSULTATION_FORM, type FieldType, type FormField } from '../src/types/index.js';

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const color = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#C41E3A');

function cleanQuestions(raw: unknown): FormField[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'Questions must be a list');
  return raw.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    if (!FIELD_TYPES.includes(f.type as FieldType)) throw new HttpError(400, 'Invalid question type');
    const options = Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean) : [];
    if ((f.type === 'select' || f.type === 'radio') && !options.length) throw new HttpError(400, `"${optString(f.label)}" needs at least one option`);
    return { id: needString(f.id, 'Question id'), label: needString(f.label, 'Question'), type: f.type as FieldType, required: Boolean(f.required), options };
  });
}

/** Creates or replaces a module's questions for one form (form_questions has one row per module and form type). */
async function saveQuestions(moduleId: string, formType: string, questions: FormField[]) {
  const [existing] = await db.select({ id: formQuestions.id }).from(formQuestions).where(and(eq(formQuestions.moduleId, moduleId), eq(formQuestions.formType, formType)));
  if (existing) await db.update(formQuestions).set({ questions, updatedAt: new Date() }).where(eq(formQuestions.id, existing.id));
  else await db.insert(formQuestions).values({ moduleId, formType, questions });
}

export default handler({
  // ?slug=... is public (booking page, active modules only); without it, staff get every module.
  GET: async (req, url) => {
    const slug = url.searchParams.get('slug');
    if (slug) {
      const [module] = await db
        .select({ id: modules.id, slug: modules.slug, name: modules.name, description: modules.description, color: modules.color })
        .from(modules)
        .where(and(eq(modules.slug, slug), eq(modules.isActive, true)));
      if (!module) throw new HttpError(404, 'This booking page does not exist');
      return { ...module, questions: (await loadBookingQuestions()).get(module.id) ?? [], venue: (await loadSettings()).venue.address };
    }
    await requireUser(req);
    const [rows, questions, postQuestions] = await Promise.all([db.select().from(modules).orderBy(asc(modules.name)), loadBookingQuestions(), loadPostQuestions()]);
    return rows.map((module) => ({ ...module, questions: questions.get(module.id) ?? [], postQuestions: postQuestions(module.id) }));
  },

  POST: async (req) => {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req);
    const name = needString(body.name, 'Name');
    const slug = slugify(optString(body.slug) || name);
    if (!slug) throw new HttpError(400, 'Could not build a link from that name');
    try {
      const [module] = await db
        .insert(modules)
        .values({ name, slug, description: optString(body.description) || null, color: color(body.color) })
        .returning();
      await audit(user, 'module.created', 'module', module.id, undefined, { name });
      return { ...module, questions: [], postQuestions: DEFAULT_POST_CONSULTATION_QUESTIONS };
    } catch (e) {
      throw isUniqueViolation(e) ? new HttpError(409, 'A module with this link already exists') : e;
    }
  },

  // Saves whichever of the module's details (name, description, colour, live) and forms (booking questions, post-consultation questions) are sent.
  PATCH: async (req) => {
    const user = await requireUser(req, 'admin');
    const body = await readBody(req);
    const id = needString(body.id, 'Module');

    const details: Partial<typeof modules.$inferInsert> = {};
    if (body.name !== undefined) details.name = needString(body.name, 'Name');
    if (body.description !== undefined) details.description = optString(body.description) || null;
    if (body.color !== undefined) details.color = color(body.color);
    if (body.isActive !== undefined) details.isActive = Boolean(body.isActive);

    const [module] = Object.keys(details).length
      ? await db.update(modules).set(details).where(eq(modules.id, id)).returning()
      : await db.select().from(modules).where(eq(modules.id, id));
    if (!module) throw new HttpError(404, 'Module not found');

    let questions = (await loadBookingQuestions()).get(id) ?? [];
    if (body.questions !== undefined) {
      questions = cleanQuestions(body.questions);
      await saveQuestions(id, BOOKING_FORM, questions);
    }
    let postQuestions = (await loadPostQuestions())(id);
    if (body.postQuestions !== undefined) {
      postQuestions = cleanQuestions(body.postQuestions);
      await saveQuestions(id, POST_CONSULTATION_FORM, postQuestions);
    }

    await audit(user, 'module.updated', 'module', id, undefined, { name: module.name, isActive: module.isActive, questions: questions.length, postQuestions: postQuestions.length });
    return { ...module, questions, postQuestions };
  },
});
