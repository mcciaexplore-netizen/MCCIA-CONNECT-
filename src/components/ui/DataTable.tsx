import { useState, type ReactNode } from 'react';
import { cn, useIsMobile } from '../../lib/utils';
import DataCards from './DataCards';
import EmptyState from './EmptyState';
import Icon, { type IconName } from './Icon';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  isId?: boolean; // ticket id style: brand colour, clickable
  desktopOnly?: boolean; // left out of the phone card (e.g. a row number)
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void; // also the eye icon
  onEdit?: (row: T) => void; // pencil icon
  selectable?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  empty?: string;
  emptyIcon?: IconName;
  emptyAction?: { label: string; onClick: () => void }; // e.g. "+ Add client" when there is nothing yet
}

/** Dense Zoho Desk style table; below 768px a list of cards instead. Styles live in index.css (.dt). */
export default function DataTable<T>({ columns, data, rowKey, onRowClick, onEdit, selectable, onSelectionChange, empty = 'Nothing here yet.', emptyIcon, emptyAction }: Props<T>) {
  const mobile = useIsMobile();
  const [selected, setSelected] = useState(new Set<string>());
  const hasActions = Boolean(onRowClick || onEdit);
  const actions = [{ icon: 'eye', title: 'View', run: onRowClick }, { icon: 'pencil', title: 'Edit', run: onEdit }] as const;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  const select = (next: Set<string>) => {
    setSelected(next);
    onSelectionChange?.(data.filter((row) => next.has(rowKey(row))));
  };
  const toggle = (key: string) => select(new Set(selected.has(key) ? [...selected].filter((k) => k !== key) : [...selected, key]));
  const all = data.length > 0 && data.every((row) => selected.has(rowKey(row)));

  const nothing = <EmptyState icon={emptyIcon} message={empty} action={emptyAction} />;
  if (mobile) return data.length ? <DataCards columns={columns} data={data} rowKey={rowKey} onRowClick={onRowClick} onEdit={onEdit} selectable={selectable} selected={selected} onToggle={toggle} /> : <div className="card">{nothing}</div>;

  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead>
          <tr>
            {selectable && <th className="w-9"><input type="checkbox" checked={all} onChange={() => select(all ? new Set() : new Set(data.map(rowKey)))} /></th>}
            {columns.map((c) => <th key={c.header} className={c.className}>{c.header}</th>)}
            {hasActions && <th className="w-[72px]" />}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={rowKey(row)} data-selected={selected.has(rowKey(row))} className={cn(onRowClick && 'cursor-pointer')} onClick={onRowClick && (() => onRowClick(row))}>
              {selectable && <td onClick={stop}><input type="checkbox" checked={selected.has(rowKey(row))} onChange={() => toggle(rowKey(row))} /></td>}
              {columns.map((c) => {
                const content = c.cell(row);
                const title = typeof content === 'string' || typeof content === 'number' ? String(content) : undefined;
                return <td key={c.header} className={c.className}><div className={cn('dt-cell', c.isId && 'dt-id')} title={title}>{content}</div></td>;
              })}
              {hasActions && (
                <td onClick={stop}>
                  <div className="dt-actions text-ink-2">
                    {actions.map(({ icon, title, run }) => run && (
                      <button key={icon} title={title} className="rounded p-1 hover:bg-white hover:text-primary" onClick={() => run(row)}><Icon name={icon} /></button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
          {!data.length && <tr><td colSpan={columns.length + Number(Boolean(selectable)) + Number(hasActions)}>{nothing}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
