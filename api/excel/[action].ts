import { eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, loadPostQuestions, loadSettings, needString, optString, readBody, requireUser, UUID } from '../_lib.js';
import { count, studioDate } from '../_availability.js';
import { exportAuditExcel, exportFilteredExcel, importTemplate, readUpload } from '../_excel_file.js';
import { guideRows, importRows, importTargets, splitTable, suggestMapping } from '../_import.js';
import { SHEETS } from '../_live_excel.js';
import { modules } from '../_schema.js';
import { IMPORT_CHUNK, IMPORT_MAX_ROWS, type ImportRead } from '../../src/types/index.js';

const MAX_IDS = 100;

const workbook = (buffer: ArrayBuffer | Buffer, filename: string) =>
  new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

/** The studio name as a file-name part, and today's date in studio time. */
async function fileParts() {
  const settings = await loadSettings();
  const brand = settings.brand.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Studio'; // safe in a file name
  return { settings, brand, today: studioDate(new Date(), settings.timezone.tz) };
}

async function moduleOf(id: unknown) {
  const moduleId = needString(id, 'Module');
  const [module] = UUID.test(moduleId) ? await db.select().from(modules).where(eq(modules.id, moduleId)) : [];
  if (!module) throw new HttpError(404, 'Module not found');
  return module;
}

// GET /api/excel/download. Generates the workbook fresh from Neon:
// one file, one tab per module. ?modules=all (default) or ?modules=ai-consultation,applet-setup;
// ?ids=a,b limits it to those tickets (the tickets list's "Export Excel"); ?audit=1 is the audit log instead (one "Audit Logs" tab).
const download = handler({
  GET: async (req, url) => {
    const user = await requireUser(req, 'super_admin');
    const { settings, brand, today } = await fileParts();

    if (url.searchParams.get('audit')) {
      const { buffer, entries } = await exportAuditExcel(settings);
      await audit(user, 'export.excel', 'export', null, undefined, { audit: true, entries });
      return workbook(buffer, `${brand}-Audit-Logs-${today}.xlsx`);
    }

    const modulesParam = url.searchParams.get('modules') ?? 'all';
    const modules = modulesParam === 'all' ? undefined : modulesParam.split(',').filter(Boolean);
    if (modules && !modules.length) throw new HttpError(400, 'Choose at least one module');
    const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);
    if (ids && (ids.length > MAX_IDS || !ids.every((id) => UUID.test(id)))) throw new HttpError(400, `ids must be up to ${MAX_IDS} ticket ids`);

    const { buffer, tickets } = await exportFilteredExcel(settings, { modules, ids });
    await audit(user, 'export.excel', 'export', null, undefined, { modules: modules?.join(',') ?? 'all', tickets });
    return workbook(buffer, `${brand}-Bookings-${today}.xlsx`);
  },
});

// GET /api/excel/template?module=<id>: the empty file to fill in for importing tickets of that module (its columns, and a "How to fill" tab).
const template = handler({
  GET: async (req, url) => {
    await requireUser(req, 'super_admin');
    const module = await moduleOf(url.searchParams.get('module'));
    const postQuestions = (await loadPostQuestions())(module.id);
    const { settings, brand } = await fileParts();
    return workbook(await importTemplate(settings, module.name, importTargets(postQuestions), guideRows(postQuestions)), `${brand}-Import-${module.slug}.xlsx`);
  },
});

const textRows = (value: unknown, max: number) => {
  if (!Array.isArray(value) || value.length > max || !value.every((row) => Array.isArray(row) && row.length <= 200 && row.every((cell) => typeof cell === 'string' && cell.length <= 20_000))) throw new HttpError(400, `Send up to ${max} rows of text`);
  return value as string[][];
};

// POST /api/excel/import { module, step }: bringing tickets in from a file. Admin only.
//  step "read":  { name, file (base64), sheet? } -> the sheets, header row, rows as text and which column is probably which field (ImportRead)
//  step "check": { rows, mapping, firstRow, name } -> what importing would do (an ImportReport), nothing saved
//  step "run":   the same, saved (the browser sends it in chunks of IMPORT_CHUNK rows)
const importer = handler({
  POST: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const module = await moduleOf(body.module);
    const postQuestions = (await loadPostQuestions())(module.id);
    const targets = importTargets(postQuestions);

    if (body.step === 'read') {
      const { sheets, sheet, table } = await readUpload(needString(body.file, 'File'), needString(body.name, 'File name'), [module.name, SHEETS[module.slug] ?? ''], typeof body.sheet === 'number' ? body.sheet : undefined);
      const { headers, rows, firstRow } = splitTable(table);
      if (rows.length > IMPORT_MAX_ROWS) throw new HttpError(400, `The sheet has ${rows.length} rows. One file may have up to ${IMPORT_MAX_ROWS}: split it and import the parts one after the other.`);
      return { sheets, sheet, headers, rows, firstRow, mapping: suggestMapping(headers, targets), targets } satisfies ImportRead;
    }

    if (body.step !== 'check' && body.step !== 'run') throw new HttpError(400, 'Unknown step');
    const dryRun = body.step === 'check';
    const rows = textRows(body.rows, dryRun ? IMPORT_MAX_ROWS : IMPORT_CHUNK);
    const labels = new Set(targets.map((t) => t.label));
    const mapping = Array.isArray(body.mapping) ? body.mapping.map((label) => (typeof label === 'string' && labels.has(label) ? label : null)) : bad();
    const used = mapping.filter((label): label is string => label !== null);
    if (new Set(used).size !== used.length) throw new HttpError(400, 'Each field can be matched to one column only');
    const missing = targets.filter((t) => t.required && !used.includes(t.label));
    if (missing.length) throw new HttpError(400, `Match a column to: ${missing.map((t) => t.label).join(', ')}`);
    return await importRows({ user, module, postQuestions, rows, mapping, firstRow: count(body.firstRow, 'First row', 1), dryRun, file: optString(body.name).slice(0, 200) });
  },
});

function bad(): never {
  throw new HttpError(400, 'Send the column matching');
}

const routes: Record<string, { fetch: (req: Request) => Promise<Response> }> = { download, template, import: importer };

// One function for /api/excel/download, /template and /import (Vercel Hobby allows 12 functions).
export default {
  fetch: (req: Request) => {
    const route = routes[new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''];
    return route ? route.fetch(req) : Promise.resolve(Response.json({ error: 'Not found' }, { status: 404 }));
  },
};
