import ExcelJS from 'exceljs';
import { and, asc, desc, inArray } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { columnsFor, dateText, ticketRows, timeText } from './_excel.js';
import { auditLogs, modules, tickets } from './_schema.js';
import type { AppSettings } from '../src/types/index.js';

/** The download: an Excel file generated fresh from Neon every time, so notes, statuses, feedback and links are always current. */

const HEADER = 'FF0157B3'; // the brand blue
const INK = 'FF1A1F36';
const BORDER = { style: 'thin', color: { argb: 'FFE5E7EB' } } as const;
const PREFERRED_ORDER = ['ai-consultation', 'applet-setup', 'cluster-development'];

/** One styled tab: a blue header (frozen, filterable), then one row per entry. */
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width: number; fill?: string }[], rows: (string | number)[][]) {
  const sheet = workbook.addWorksheet(name.replace(/[\\/?*:[\]]/g, '-').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, width }) => ({ header, width }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell, index) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columns[index - 1].fill ?? HEADER } };
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });

  rows.forEach((values, index) => {
    const excelRow = sheet.addRow(values);
    excelRow.height = 18;
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFFFF9F9' : 'FFFFFFFF' } };
      cell.font = { size: 11, color: { argb: INK } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
    });
  });
}

export interface ExcelFilters {
  modules?: string[]; // module slugs; leave out for every module
  ids?: string[]; // ticket ids; leave out for every ticket
}

/** The workbook for the chosen modules (one tab each, even when empty), built fresh from Neon. */
export async function exportFilteredExcel(settings: AppSettings, { modules: slugs, ids }: ExcelFilters = {}) {
  const allModules = await db.select().from(modules).orderBy(asc(modules.name));
  const unknown = slugs?.find((slug) => !allModules.some((m) => m.slug === slug));
  if (unknown) throw new HttpError(400, `Unknown module: ${unknown}`);

  const chosen = allModules
    .filter((m) => !slugs || slugs.includes(m.slug))
    .sort((a, b) => (PREFERRED_ORDER.indexOf(a.slug) + 1 || 99) - (PREFERRED_ORDER.indexOf(b.slug) + 1 || 99));

  const found = chosen.length ? await ticketRows(and(inArray(tickets.moduleId, chosen.map((m) => m.id)), ids ? inArray(tickets.id, ids) : undefined)) : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  let total = 0;
  for (const module of chosen) {
    const inModule = found.filter((f) => f.ticket.moduleId === module.id);
    // Bookings made before row numbers existed get the next free numbers, in booking order (not saved).
    let next = Math.max(0, ...inModule.map((f) => f.booking.excelRowNumber ?? 0));
    const tabRows = inModule.map((f) => ({ ...f, domain: module.name, srNo: f.booking.excelRowNumber ?? ++next }));
    total += tabRows.length;
    const columns = columnsFor(module.slug);
    addSheet(workbook, module.name, columns, tabRows.map((row) => columns.map((column) => column.value(row, settings.timezone))));
  }
  return { buffer: await workbook.xlsx.writeBuffer(), tickets: total };
}

const AUDIT_COLUMNS = [
  { header: 'Timestamp', width: 22 },
  { header: 'Action', width: 24 },
  { header: 'Entity', width: 14 },
  { header: 'Entity ID', width: 38 },
  { header: 'Old Value', width: 40 },
  { header: 'New Value', width: 40 },
  { header: 'Done By', width: 20 },
  { header: 'Role', width: 12 },
];

/** Every audit log entry, newest first, as a workbook with one "Audit Logs" tab. */
export async function exportAuditExcel(settings: AppSettings) {
  const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
  const json = (value: unknown) => (value == null ? '' : JSON.stringify(value).slice(0, 32_000)); // a cell holds 32,767 characters at most
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  addSheet(
    workbook,
    'Audit Logs',
    AUDIT_COLUMNS,
    logs.map((log) => [
      log.createdAt ? `${dateText(settings.timezone, log.createdAt)} ${timeText(settings.timezone, log.createdAt)} ${settings.timezone.label}` : '',
      log.action,
      log.entityType,
      log.entityId ?? '',
      json(log.oldValue),
      json(log.newValue),
      log.doneByName ?? '',
      log.role ?? '',
    ]),
  );
  return { buffer: await workbook.xlsx.writeBuffer(), entries: logs.length };
}
