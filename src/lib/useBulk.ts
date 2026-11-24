import { useState } from 'react';

/**
 * The checkbox selection of a list. It can also mean "every row the filters show, on all pages", and what is chosen goes to the server in
 * requests of at most `size` ids (`eachChunk`; it stops at the first request that fails, whose reason was already shown).
 */
export function useBulk<T extends { id: string }>(rows: T[], shown: T[], size = 100) {
  const [selected, setSelected] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [tableKey, setTableKey] = useState(0); // remounting the table clears its checkboxes
  const ids = allMatching ? rows.map((r) => r.id) : selected;

  const eachChunk = async <R,>(send: (chunk: string[]) => Promise<R | null>) => {
    const results: R[] = [];
    for (let i = 0; i < ids.length; i += size) {
      const result = await send(ids.slice(i, i + size));
      if (!result) break;
      results.push(result);
    }
    return results;
  };

  return {
    ids,
    allMatching,
    tableKey,
    eachChunk,
    onSelectionChange: (picked: T[]) => setSelected(picked.map((r) => r.id)),
    canSelectAll: !allMatching && selected.length > 0 && selected.length === shown.length && rows.length > shown.length, // this page is all selected, and there are more pages
    selectAll: () => setAllMatching(true),
    clear: () => {
      setSelected([]);
      setAllMatching(false);
      setTableKey((key) => key + 1);
    },
  };
}
