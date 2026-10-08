/**
 * The studio's Excel workbook on SharePoint / OneDrive, through Microsoft Graph. The app signs in as itself (application permission
 * Files.ReadWrite.All, granted once by a Microsoft admin): nobody logs in. This file only knows how to read and write the rows of a sheet's
 * Excel table; what goes into them, and when, is api/_live_excel.ts.
 *
 * Needs MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET and MS_EXCEL_URL (the file's sharing link). Without them nothing is written.
 * MS_LOGIN_URL and MS_GRAPH_URL replace Microsoft's addresses (the tests point them at a fake).
 */

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;

export const excelConfigured = () => Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_EXCEL_URL);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let token: { value: string; expires: number } | undefined;
async function accessToken() {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const response = await fetch(`${process.env.MS_LOGIN_URL ?? 'https://login.microsoftonline.com'}/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MS_CLIENT_ID!, client_secret: process.env.MS_CLIENT_SECRET!, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null;
  if (!response.ok || !body?.access_token) throw new Error(`Microsoft sign-in failed: ${body?.error_description?.split('\r')[0] ?? response.status}`);
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return token.value;
}

// Excel serves a read straight after a write from a server that may not have the write yet (for a few seconds). Everything one operation does
// therefore happens inside a workbook session, which keeps it on one server, and the changes are saved when the session is closed.
let session: string | undefined;

/** One Graph call. Throttling (429, 503) is waited out twice; an expired token is renewed once. */
async function graph<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${process.env.MS_GRAPH_URL ?? 'https://graph.microsoft.com/v1.0'}${path}`, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(session && { 'workbook-session-id': session }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 401 && attempt === 0) {
      token = undefined;
      continue;
    }
    if ([429, 503, 504].includes(response.status) && attempt < MAX_RETRIES) {
      await sleep(Math.min(10_000, Number(response.headers.get('retry-after') ?? 2) * 1000));
      continue;
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!response.ok) throw new Error(`Excel ${method} ${path.split('?')[0].replace(/^\/drives\/[^/]+\/items\/[^/]+\/workbook/, '')}: ${data.error?.code ?? response.status} ${data.error?.message ?? ''}`.trim());
    return data as T;
  }
}

// ---------- the workbook and its sheets ----------

let workbook: Promise<string> | undefined;
/** Where the workbook is: the sharing link says which drive and item it is, once per server instance. */
function workbookPath() {
  workbook ??= graph<{ id: string; parentReference: { driveId: string } }>('GET', `/shares/u!${Buffer.from(process.env.MS_EXCEL_URL!).toString('base64url')}/driveItem?$select=id,parentReference`)
    .then((item) => `/drives/${item.parentReference.driveId}/items/${item.id}/workbook`)
    .catch((e) => {
      workbook = undefined;
      throw e;
    });
  return workbook;
}

const tables = new Map<string, string>(); // sheet name -> its table's id
const sheetName = (name: string) => encodeURIComponent(name.replace(/'/g, "''"));

/** Forget what was learned about the workbook (after a failure: the file or its table may have been replaced). */
export function forgetWorkbook() {
  workbook = undefined;
  tables.clear();
  token = undefined;
}

const LETTERS = (n: number) => {
  let letters = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) letters = String.fromCharCode(65 + ((i - 1) % 26)) + letters;
  return letters;
};
const columnNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

interface SheetInfo {
  book: string; // the workbook's path
  sheet: string;
  table: string; // the table's path
  headers: string[];
  headerRow: number; // the sheet row the headers are on
  firstColumn: number; // the sheet column of the table's first column (1 = A)
}

async function sheetInfo(sheet: string): Promise<SheetInfo> {
  const book = await workbookPath();
  let id = tables.get(sheet);
  if (!id) {
    id = (await graph<{ value: { id: string }[] }>('GET', `${book}/worksheets('${sheetName(sheet)}')/tables?$select=id`)).value[0]?.id;
    if (!id) throw new Error(`Excel: the "${sheet}" sheet has no table (select its headers and rows and use Insert > Table)`);
    tables.set(sheet, id);
  }
  const table = `${book}/tables/${encodeURIComponent(id)}`;
  const header = await graph<{ address: string; values: unknown[][] }>('GET', `${table}/headerRowRange?$select=address,values`);
  const at = /!\$?([A-Z]+)\$?(\d+)/.exec(header.address);
  if (!at) throw new Error(`Excel: cannot read the address ${header.address}`);
  return { book, sheet, table, headers: header.values[0].map(String), headerRow: Number(at[2]), firstColumn: columnNumber(at[1]) };
}

const cellRange = (info: SheetInfo, row: number, from: number, to: number) => `${LETTERS(info.firstColumn + from)}${row}:${LETTERS(info.firstColumn + to)}${row}`;

/** What the column of this header holds, row by row, as text (the ids of the rows). */
async function columnValues(info: SheetInfo, index: number) {
  const { values } = await graph<{ values: unknown[][] }>('GET', `${info.table}/columns/itemAt(index=${index})/dataBodyRange?$select=values`);
  return values.map(([value]) => String(value ?? '').trim());
}

export type Cell = string | number | null; // null = not ours: whatever is in that cell stays

export interface SheetRow {
  id: string;
  cells: (headers: string[]) => Cell[]; // one cell per header of the table
}

/** Writes the cells of one existing row, only in runs of columns that are ours (cells given as null are never touched). */
async function writeRow(info: SheetInfo, at: number, cells: Cell[]) {
  const row = info.headerRow + 1 + at;
  for (let start = 0; start < cells.length; start++) {
    if (cells[start] === null) continue;
    let end = start;
    while (end + 1 < cells.length && cells[end + 1] !== null) end++;
    await graph('PATCH', `${info.book}/worksheets('${sheetName(info.sheet)}')/range(address='${cellRange(info, row, start, end)}')`, { values: [cells.slice(start, end + 1)] });
    start = end;
  }
}

/** Runs the work in a workbook session; a session that cannot be closed is left to expire. */
async function inSession<T>(work: () => Promise<T>): Promise<T> {
  const book = await workbookPath();
  session = (await graph<{ id: string }>('POST', `${book}/createSession`, { persistChanges: true })).id;
  try {
    return await work();
  } finally {
    await graph('POST', `${book}/closeSession`, {}).catch(() => undefined);
    session = undefined;
  }
}

// Operations on the workbook run one after another, so two changes made at once cannot both add the same row.
let tail: Promise<unknown> = Promise.resolve();
const queued = <T>(work: () => Promise<T>): Promise<T> => {
  const run = tail.then(() => inSession(work), () => inSession(work));
  tail = run.catch(() => undefined);
  return run;
};

const formatted = new Set<string>();

/**
 * Puts each row into the sheet's table: the row whose id column (the header `isIdHeader` picks) holds its id is updated, otherwise
 * it is added (into the table's empty first row if that is all there is, else at the end). `formats` set a number format on a column once (e.g. dates).
 */
export function upsertRows(sheet: string, isIdHeader: (header: string) => boolean, rows: SheetRow[], formats: { header: (header: string) => boolean; code: string }[] = []) {
  if (!rows.length) return Promise.resolve();
  return queued(async () => {
    const info = await sheetInfo(sheet);
    const idIndex = info.headers.findIndex(isIdHeader);
    if (idIndex < 0) throw new Error(`Excel: the "${sheet}" sheet has no ticket id column`);
    const ids = await columnValues(info, idIndex);

    for (const { header, code } of formats) {
      const index = info.headers.findIndex(header);
      if (index < 0 || formatted.has(`${sheet}|${index}|${code}`) || !ids.length) continue;
      await graph('PATCH', `${info.table}/columns/itemAt(index=${index})/dataBodyRange`, { numberFormat: ids.map(() => [code]) });
      formatted.add(`${sheet}|${index}|${code}`);
    }

    const added: Cell[][] = [];
    for (const row of rows) {
      const cells = row.cells(info.headers);
      const at = ids.indexOf(row.id);
      if (at >= 0) await writeRow(info, at, cells);
      else added.push(cells);
    }
    if (!added.length) return;

    // A new table has one empty row: the first ticket goes into it instead of leaving it empty above (empty where we write; the studio's own columns may have notes).
    const last = ids.length - 1;
    if (last >= 0 && ids[last] === '') {
      const { values } = await graph<{ values: unknown[][] }>('GET', `${info.table}/rows/itemAt(index=${last})/range?$select=values`);
      if (values[0].every((value, i) => value === '' || added[0][i] === null)) await writeRow(info, last, added.shift()!);
    }
    if (added.length) await graph('POST', `${info.table}/rows/add`, { index: null, values: added.map((cells) => cells.map((cell) => cell ?? '')) });
  });
}

/** Removes the rows with these ids from the sheet's table (the last row left in a table is emptied, a table keeps one row). */
export function removeRows(sheet: string, isIdHeader: (header: string) => boolean, rowIds: string[]) {
  if (!rowIds.length) return Promise.resolve();
  return queued(async () => {
    const info = await sheetInfo(sheet);
    const idIndex = info.headers.findIndex(isIdHeader);
    if (idIndex < 0) throw new Error(`Excel: the "${sheet}" sheet has no ticket id column`);
    const ids = await columnValues(info, idIndex);
    // From the bottom up, so the positions still to be removed do not move.
    const found = rowIds.map((id) => ids.indexOf(id)).filter((at) => at >= 0).sort((a, b) => b - a);
    let remaining = ids.length;
    for (const at of found) {
      if (remaining === 1) await graph('PATCH', `${info.book}/worksheets('${sheetName(info.sheet)}')/range(address='${cellRange(info, info.headerRow + 1 + at, 0, info.headers.length - 1)}')`, { values: [info.headers.map(() => '')] });
      else await graph('DELETE', `${info.table}/rows/itemAt(index=${at})`);
      remaining--;
    }
  });
}
