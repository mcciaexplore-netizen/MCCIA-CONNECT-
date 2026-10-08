import ExcelJS from 'exceljs';
import { and, asc, desc, inArray } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { columnsFor, dateText, norm, ticketRows, timeText } from './_excel.js';
import { auditLogs, modules, tickets } from './_schema.js';
import type { AppSettings, ImportTarget } from '../src/types/index.js';

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

// ---------- importing: the template and reading a file ----------

const REQUIRED_FILL = 'FF9B1C1C'; // a required column of the template is dark red, the others brand blue

/** The empty import file for a module: its columns (required ones in red) and a "How to fill" tab saying what each takes. */
export async function importTemplate(settings: AppSettings, moduleName: string, targets: ImportTarget[], guide: [string, string, string][]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  addSheet(workbook, moduleName, targets.map(({ label, required }) => ({ header: label, width: Math.max(16, label.length + 4), fill: required ? REQUIRED_FILL : undefined })), []);
  addSheet(workbook, 'How to fill', [{ header: 'Column', width: 34 }, { header: 'Required', width: 10 }, { header: 'What to write', width: 110 }], guide);
  return await workbook.xlsx.writeBuffer();
}

/** A cell as the text a person sees in it (dates as 2026-10-12, a time alone as 10:30, formulas as their result). */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) {
    const iso = value.toISOString();
    const day = iso.slice(0, 10);
    return day <= '1900-01-01' ? iso.slice(11, 16) : iso.slice(11, 16) === '00:00' ? day : `${day} ${iso.slice(11, 16)}`;
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text).trim();
    return ''; // an error value such as #N/A
  }
  return String(value).trim();
}

/** Rows of text from a CSV (commas, semicolons or tabs; quotes allowed). */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = [',', ';', '\t'].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) (row.push(cell.trim()), (cell = ''));
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      [row, cell] = [[], ''];
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell.trim()]);
  return rows;
}

/**
 * The cells of an uploaded .xlsx (one of its sheets: `sheet`, else the one named like the module, else the first) or .csv, as text. Row n of the
 * result is row n+1 of the sheet, empty rows included. `base64` is the file's content.
 */
export async function readUpload(base64: string, fileName: string, preferred: string[], sheet?: number) {
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new HttpError(400, 'The file is empty');
  if (/\.csv$/i.test(fileName)) return { sheets: [fileName], sheet: 0, table: parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, '')) };
  if (!/\.xlsx$/i.test(fileName)) throw new HttpError(400, 'Choose an Excel (.xlsx) or a CSV file. An older .xls file: open it in Excel and save it as .xlsx first.');

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new HttpError(400, 'This file could not be read as an Excel workbook');
  }
  const names = workbook.worksheets.map((w) => w.name);
  const chosen = sheet ?? Math.max(0, names.findIndex((name) => preferred.some((p) => norm(p) === norm(name))));
  const worksheet = workbook.worksheets[chosen];
  if (!worksheet) throw new HttpError(400, 'That sheet is not in the file');
  if (worksheet.rowCount > 20_000) throw new HttpError(400, 'The sheet has too many rows to import in one go: split it and import the parts one after the other.');

  const table: string[][] = [];
  for (let n = 1; n <= worksheet.rowCount; n++) {
    const cells: string[] = [];
    worksheet.getRow(n).eachCell({ includeEmpty: false }, (cell, column) => {
      if (column <= 200) cells[column - 1] = cellText(cell.value);
    });
    table.push(Array.from(cells, (cell) => cell ?? ''));
  }
  return { sheets: names, sheet: chosen, table };
}
