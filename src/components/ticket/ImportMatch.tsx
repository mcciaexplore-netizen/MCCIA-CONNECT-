import type { ImportRead } from '../../types';

interface Props {
  read: ImportRead;
  mapping: (string | null)[];
  onMapping: (mapping: (string | null)[]) => void;
  onSheet: (sheet: number) => void;
  onBack: () => void;
  onCheck: () => void;
  busy: string;
}

/** Import step 2: each column of the file and the field of the app it goes into (matched by name; change any that is wrong). */
export default function ImportMatch({ read, mapping, onMapping, onSheet, onBack, onCheck, busy }: Props) {
  const used = new Set(mapping.filter(Boolean));
  const missing = read.targets.filter((t) => t.required && !used.has(t.label));
  const example = (column: number) => read.rows.slice(0, 5).map((row) => row[column]).find(Boolean) ?? '';

  return (
    <div className="space-y-4">
      <p className="text-ink-2">
        {read.rows.length} {read.rows.length === 1 ? 'row' : 'rows'} found. Each column is matched to a field of the app by its name: check the matches and change any that are wrong. A column set to "Skip" is left out. Fields marked * are needed.
      </p>
      {read.sheets.length > 1 && (
        <div>
          <label className="label" htmlFor="import-sheet">Sheet</label>
          <select id="import-sheet" className="input w-64" value={read.sheet} disabled={Boolean(busy)} onChange={(e) => onSheet(Number(e.target.value))}>
            {read.sheets.map((name, i) => <option key={name} value={i}>{name}</option>)}
          </select>
        </div>
      )}
      <div className="max-h-[45vh] overflow-auto rounded-md border border-line">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-page text-xs uppercase text-ink-3">
            <tr><th className="px-3 py-2">Column in your file</th><th className="px-3 py-2">Example</th><th className="px-3 py-2">Goes into</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {read.headers.map((header, column) => (
              <tr key={column}>
                <td className="px-3 py-1.5 font-medium">{header}</td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 text-ink-3">{example(column)}</td>
                <td className="px-3 py-1.5">
                  <select className="input" aria-label={`Field for ${header}`} value={mapping[column] ?? ''} onChange={(e) => onMapping(mapping.map((label, i) => (i === column ? e.target.value || null : label)))}>
                    <option value="">Skip this column</option>
                    {read.targets.filter((t) => t.label === mapping[column] || !used.has(t.label)).map((t) => <option key={t.label} value={t.label}>{t.label}{t.required ? ' *' : ''}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing.length > 0 && <p className="text-danger">Still to match: {missing.map((t) => t.label).join(', ')}</p>}
      {busy && <p role="status" className="text-ink-2">{busy}</p>}
      <div className="flex justify-between">
        <button type="button" className="btn" disabled={Boolean(busy)} onClick={onBack}>Choose another file</button>
        <button type="button" className="btn btn-primary" disabled={missing.length > 0 || Boolean(busy)} onClick={onCheck}>Check the file</button>
      </div>
    </div>
  );
}
