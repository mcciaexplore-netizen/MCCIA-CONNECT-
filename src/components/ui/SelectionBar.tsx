import type { ReactNode } from 'react';

interface Props {
  count: number; // rows selected
  noun: string; // "tickets", "clients" ...
  allMatching: boolean;
  total: number; // every row the filters show
  canSelectAll: boolean;
  onSelectAll: () => void;
  children: ReactNode; // the actions
}

/** The bar over a list while rows are ticked: how many, a link to take every page, and the actions. */
export default function SelectionBar({ count, noun, allMatching, total, canSelectAll, onSelectAll, children }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary bg-primary-light px-3 py-2">
      <span className="mr-2 font-medium text-primary-dark">{allMatching ? `All ${count} ${noun} selected` : `${count} selected`}</span>
      {canSelectAll && <button className="mr-2 text-primary underline" onClick={onSelectAll}>Select all {total} {noun}</button>}
      {children}
    </div>
  );
}
