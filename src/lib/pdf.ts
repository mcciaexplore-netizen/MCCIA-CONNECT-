/**
 * "Export PDF" without a PDF library: the table opens in a print-ready page and the browser's print dialog saves it as a PDF
 * (Destination: Save as PDF). Landscape A4, the header row repeated on every page.
 */
export interface PdfTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export function exportPdf({ title, subtitle, headers, rows }: PdfTable) {
  const page = window.open('', '_blank');
  if (!page) return false; // a pop-up blocker said no
  page.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Outfit, Arial, sans-serif; color: #1a1f36; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    p { font-size: 11px; color: #5b6478; margin: 0 0 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 9.5px; }
    thead { display: table-header-group; }
    th { background: #0157b3; color: #fff; text-align: left; padding: 5px 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { padding: 4px 6px; border-bottom: 1px solid #e6ebf2; vertical-align: top; word-break: break-word; }
    tr { page-break-inside: avoid; }
    tbody tr:nth-child(even) td { background: #f5f8fc; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style></head><body>
    <h1>${escape(title)}</h1>
    <p>${escape(subtitle ?? '')}${subtitle ? ' · ' : ''}${rows.length} row${rows.length === 1 ? '' : 's'} · ${escape(new Date().toLocaleString())}</p>
    <table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}">Nothing to show.</td></tr>`}</tbody></table>
  </body></html>`);
  page.document.close();
  page.onafterprint = () => page.close();
  setTimeout(() => page.print(), 300); // let the page lay out first
  return true;
}
