import { audit, db, handler, HttpError, loadSettings, readBody, requireUser } from './_lib.js';
import { appSettings } from './_schema.js';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/types/index.js';

export default handler({
  GET: async (req) => {
    await requireUser(req, 'super_admin');
    return await loadSettings();
  },

  // Body: any of the setting keys, e.g. { venue: { address: "..." } }. Unknown fields are dropped.
  PUT: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const keys = (Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).filter((key) => body[key] !== undefined);
    if (!keys.length) throw new HttpError(400, 'Nothing to save');

    // Keep only the known fields of each setting, with the right type.
    const values = keys.map((key) => {
      const sent = (body[key] ?? {}) as Record<string, unknown>;
      const value = Object.fromEntries(
        Object.entries(DEFAULT_SETTINGS[key]).map(([field, fallback]) => [field, typeof sent[field] === typeof fallback ? sent[field] : fallback]),
      ) as AppSettings[typeof key];
      return { key, value, updatedAt: new Date() };
    });

    const before = await loadSettings();
    const [first, ...rest] = values.map((row) =>
      db.insert(appSettings).values(row).onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: row.updatedAt } }),
    );
    await db.batch([first, ...rest]);

    for (const { key, value } of values) await audit(user, 'settings.updated', 'settings', null, { [key]: before[key] }, { [key]: value });
    return await loadSettings();
  },
});
