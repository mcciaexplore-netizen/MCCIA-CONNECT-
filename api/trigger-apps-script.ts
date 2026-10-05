import { audit, handler, HttpError, needString, readBody, requireUser } from './_lib.js';
import { scriptFailure, triggerAppsScript } from './_integrations.js';

export default handler({
  // Admin check that the Apps Script web app is reachable: forwards { action, ...payload } (Settings sends { action: 'ping' }).
  POST: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const action = needString(body.action, 'Action');
    // The script's own answer decides: a wrong secret, a script that is not deployed to everyone, or a page that is not JSON all fail here.
    const failure = scriptFailure(await triggerAppsScript({ ...((body.payload ?? {}) as Record<string, unknown>), action }));
    if (failure) throw new HttpError(502, `The Apps Script said: ${failure}`);
    await audit(user, 'apps-script.triggered', 'integration', null, undefined, { action });
    return { ok: true };
  },
});
