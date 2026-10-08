import { IMPORT_MAX_ROWS, type Module } from '../../types';

interface Props {
  modules: Module[];
  moduleId: string;
  onModule: (id: string) => void;
  onFile: (file: File | undefined) => void;
  onTemplate: () => void;
  fileName?: string;
  busy: string;
}

/** Import step 1: which service the tickets belong to, and the file (or the empty template to fill in first). */
export default function ImportPick({ modules, moduleId, onModule, onFile, onTemplate, fileName, busy }: Props) {
  return (
    <div className="space-y-4">
      <p className="text-ink-2">
        Bring tickets in from your previous software. Upload its Excel (.xlsx) or CSV export, check how its columns match, and see what will happen before anything is saved. Nobody is emailed and no calendar event is created.
      </p>
      <div>
        <label className="label" htmlFor="import-module">Which service are these tickets for?</label>
        <select id="import-module" className="input" value={moduleId} disabled={Boolean(busy)} onChange={(e) => onModule(e.target.value)}>
          {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="import-file">File</label>
        <input id="import-file" type="file" accept=".xlsx,.csv" className="input" disabled={Boolean(busy)} onChange={(e) => onFile(e.target.files?.[0])} />
        {fileName && <p className="mt-1 text-xs text-ink-3">{fileName}</p>}
      </div>
      {busy && <p role="status" className="text-ink-2">{busy}</p>}
      <p className="text-xs text-ink-3">
        No file yet?{' '}
        <button type="button" className="font-medium text-primary hover:underline" onClick={onTemplate}>Download the empty import file</button>
        : its columns, and a tab saying what to write in each. A file in this app's own Excel layout (what Export gives) matches by itself. Up to {IMPORT_MAX_ROWS.toLocaleString()} tickets per file.
      </p>
    </div>
  );
}
