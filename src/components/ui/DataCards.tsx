import { cn } from '../../lib/utils';
import type { Column } from './DataTable';
import Icon from './Icon';

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  onEdit?: (row: T) => void;
  selectable?: boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
}

/** A DataTable on a phone: one card per row. Columns without a header sit before the title; the id column (else the first headed one) is the title. */
export default function DataCards<T>({ columns, data, rowKey, onRowClick, onEdit, selectable, selected, onToggle }: Props<T>) {
  const shown = columns.filter((c) => !c.desktopOnly);
  const lead = shown.filter((c) => !c.header);
  const headed = shown.filter((c) => c.header);
  const title = headed.find((c) => c.isId) ?? headed[0];
  const details = headed.filter((c) => c !== title);
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <ul className="space-y-2" data-cards>
      {data.map((row) => (
        <li key={rowKey(row)} data-selected={selected.has(rowKey(row))} className={cn('card min-w-0 space-y-2 break-words p-3', onRowClick && 'cursor-pointer', selected.has(rowKey(row)) && 'border-primary bg-primary-light')} onClick={onRowClick && (() => onRowClick(row))}>
          <div className="flex items-center gap-2 font-medium">
            {selectable && <input type="checkbox" aria-label="Select" checked={selected.has(rowKey(row))} onClick={stop} onChange={() => onToggle(rowKey(row))} />}
            {lead.map((c, i) => <span key={i}>{c.cell(row)}</span>)}
            <span className={cn('min-w-0 flex-1', title?.isId && 'text-primary')}>{title?.cell(row)}</span>
            {onEdit && <button type="button" aria-label="Edit" className="rounded p-1 text-ink-2 hover:text-primary" onClick={(e) => { stop(e); onEdit(row); }}><Icon name="pencil" /></button>}
          </div>
          <dl className="space-y-1">
            {details.map((c) => (
              <div key={c.header} className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-2">{c.header}</dt>
                <dd className="min-w-0 text-right">{c.cell(row)}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
