import { audit, handler, needString, readBody, requireUser } from './_lib.js';
import { triggerAppsScript } from './_integrations.js';

export default handler({
  // Admin check that the Apps Script web app is reachable: forwards { action, ...payload } (Settings sends { action: 'ping' }).
  POST: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const action = needString(body.action, 'Action');
    await triggerAppsScript({ ...((body.payload ?? {}) as Record<string, unknown>), action });
    await audit(user, 'apps-script.triggered', 'integration', null, undefined, { action });
    return { ok: true };
  },
});
