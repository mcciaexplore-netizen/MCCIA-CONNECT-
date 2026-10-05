import { audit, cached, db, handler, HttpError, loadSettings, readBody, requireUser } from './_lib.js';
import { appSettings } from './_schema.js';
import { DEFAULT_SETTINGS, TIMEZONES, type AppSettings, type PublicSettings } from '../src/types/index.js';

export default handler({
  // ?public=1 is anyone's: the studio name, venue and time zone (login page, landing page, every role); the CDN keeps it for 30 s.
  // ?mine=1 is for anyone signed in: everything for an admin, that same public part for a coordinator.
  // Without either, admins only.
  GET: async (req, url) => {
    if (url.searchParams.has('public')) {
      const { brand, venue, timezone } = await loadSettings();
      return cached({ brand, venue, timezone } satisfies PublicSettings, 30);
    }
    const user = await requireUser(req, ...(url.searchParams.has('mine') ? [] : (['super_admin'] as const)));
    const settings = await loadSettings();
    if (user.role === 'super_admin') return settings;
    const { brand, venue, timezone } = settings;
    return { brand, venue, timezone } satisfies PublicSettings;
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
      if (key === 'timezone') {
        // Only a listed zone; its label, offset and date style come with it.
        const zone = TIMEZONES.find((z) => z.tz === sent.tz);
        if (!zone) throw new HttpError(400, 'Choose one of the listed time zones');
        return { key, value: { tz: zone.tz, label: zone.label, offset: zone.offset, locale: zone.locale }, updatedAt: new Date() };
      }
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
