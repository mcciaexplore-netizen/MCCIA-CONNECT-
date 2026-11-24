export const PAGE_SIZE = 25;

/** The rows of one page (page 1 is the first); a page past the end shows the last. */
export function pageOf<T>(rows: T[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const start = (current - 1) * PAGE_SIZE;
  return { rows: rows.slice(start, start + PAGE_SIZE), current, pages, start };
}

/** "Showing 1-25 of 130" with Previous / Next, under a list that shows PAGE_SIZE rows at a time (hidden while everything fits on one page, unless `always`). */
export default function Pager({ total, page, onPage, always }: { total: number; page: number; onPage: (page: number) => void; always?: boolean }) {
  const { current, pages, start } = pageOf(new Array<null>(total), page);
  if (total <= PAGE_SIZE && !always) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-ink-2">
      <span>{total ? `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, total)} of ${total}` : 'Showing 0 of 0'}</span>
      <div className="flex gap-2">
        <button className="btn" disabled={current === 1} onClick={() => onPage(current - 1)}>Previous</button>
        <button className="btn" disabled={current === pages} onClick={() => onPage(current + 1)}>Next</button>
      </div>
    </div>
  );
}
