import { audit, handler, HttpError, loadSettings, requireUser, UUID } from '../_lib.js';
import { studioDate } from '../_availability.js';
import { exportAuditExcel, exportFilteredExcel } from '../_excel_file.js';

const MAX_IDS = 100;

const workbook = (buffer: ArrayBuffer | Buffer, filename: string) =>
  new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

// GET /api/excel/download. Generates the workbook fresh from Neon:
// one file, one tab per module. ?modules=all (default) or ?modules=ai-consultation,applet-setup;
// ?ids=a,b limits it to those tickets (the tickets list's "Export Excel"); ?audit=1 is the audit log instead (one "Audit Logs" tab).
export default handler({
  GET: async (req, url) => {
    const user = await requireUser(req, 'super_admin');
    const settings = await loadSettings();
    const today = studioDate(new Date(), settings.timezone.tz);
    const brand = settings.brand.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Studio'; // safe in a file name

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
