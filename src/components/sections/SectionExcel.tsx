import { useState } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import { MAX_FILE_BYTES, toBase64 } from '../../lib/utils';
import Modal from '../ui/Modal';

type Section = 'applets' | 'workshops';
interface Result {
  added: number;
  updated: number;
  errors: string[];
}
const KEYS: Record<Section, string> = { applets: 'the same Company + Applet Name', workshops: 'its Number' };

/** "Export to Excel" and "Import from Excel" for the Applets and Workshops pages. */
export default function SectionExcel({ section, noun }: { section: Section; noun: string }) {
  const { exportExcel, mutate } = useData();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const close = () => {
    setOpen(false);
    setFile(null);
    setErrors([]);
  };

  const run = async () => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return toast.error('This file is bigger than 3 MB. Split it into parts and import them one after the other.');
    setBusy(true);
    const result = await mutate<Result>('/api/excel/import', 'POST', { section, name: file.name, file: await toBase64(file) });
    setBusy(false);
    if (!result) return;
    if (result.errors.length) return setErrors(result.errors);
    toast.success(`${result.added} added, ${result.updated} updated`);
    close();
  };

  return (
    <>
      <button className="btn" onClick={() => exportExcel({ section })}>Export to Excel</button>
      <button className="btn" onClick={() => setOpen(true)}>Import from Excel</button>
      {open && (
        <Modal title={`Import ${noun}`} onClose={close}>
          <div className="space-y-4">
            <p className="text-ink-2">
              Fill in the template (or edit an export) and upload it. A row with {KEYS[section]} as one already here updates it; every other row is added.
              If any row has a problem, nothing is saved and the problems are listed here.
            </p>
            <button type="button" className="btn" onClick={() => exportExcel({ section, blank: true })}>Download template</button>
            <div>
              <label className="label" htmlFor="section-file">File (.xlsx or .csv)</label>
              <input id="section-file" type="file" accept=".xlsx,.csv" className="input" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErrors([]); }} />
            </div>
            {errors.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border border-danger bg-danger-light p-3 text-danger">
                <p className="mb-1 font-medium">Nothing was imported. Fix these rows and upload the file again:</p>
                <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button className="btn btn-primary" disabled={!file || busy} onClick={run}>{busy ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
