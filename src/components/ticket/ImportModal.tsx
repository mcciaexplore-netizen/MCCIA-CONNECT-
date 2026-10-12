import { useState } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import { IMPORT_CHUNK, MEET_CHUNK, type ImportRead, type ImportReport } from '../../types';
import Modal from '../ui/Modal';
import ImportMatch from './ImportMatch';
import ImportPick from './ImportPick';
import ImportSummary from './ImportSummary';

const MAX_FILE_BYTES = 3 * 1024 * 1024; // it travels as text inside a request of at most 4.5 MB

async function toBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Tickets > Import tickets: pick a file, match its columns, check it, then import it. Nothing is saved before the last button. */
export default function ImportModal({ onClose }: { onClose: () => void }) {
  const { modules, mutate, refresh, exportExcel } = useData();
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '');
  const [upload, setUpload] = useState<{ name: string; data: string } | null>(null);
  const [read, setRead] = useState<ImportRead | null>(null);
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [checked, setChecked] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [makeMeet, setMakeMeet] = useState(true);
  const [meetResult, setMeetResult] = useState<{ created: number; reused: number; failed: number; reason?: string } | undefined>();
  const [busy, setBusy] = useState(''); // what is going on right now; the dialog cannot be closed meanwhile

  const send = (step: string, extra: object) => mutate<ImportRead & ImportReport>('/api/excel/import', 'POST', { step, module: moduleId, name: upload?.name, ...extra });

  const load = async (module: string, file = upload, sheet?: number) => {
    if (!file) return;
    setBusy('Reading the file…');
    const res = await mutate<ImportRead>('/api/excel/import', 'POST', { step: 'read', module, name: file.name, file: file.data, sheet });
    setBusy('');
    setRead(res);
    if (res) setMapping(res.mapping);
  };
  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return toast.error('This file is bigger than 3 MB. Split it into parts and import them one after the other.');
    const next = { name: file.name, data: await toBase64(file) };
    setUpload(next);
    await load(moduleId, next);
  };
  const check = async () => {
    setBusy('Checking every row…');
    setChecked(await send('check', { rows: read!.rows, mapping, firstRow: read!.firstRow }));
    setBusy('');
  };
  const run = async () => {
    const total: ImportReport = { ready: 0, created: 0, duplicates: 0, failed: 0, errors: [], warnings: checked!.warnings, tickets: [], upcomingOnline: 0, meetBookingIds: [] };
    for (let i = 0; i < read!.rows.length; i += IMPORT_CHUNK) {
      setBusy(`Importing… ${i} of ${read!.rows.length} rows`);
      const part = await send('run', { rows: read!.rows.slice(i, i + IMPORT_CHUNK), mapping, firstRow: read!.firstRow + i });
      if (!part) break; // the reason was shown; what was saved so far stays
      total.created += part.created;
      total.duplicates += part.duplicates;
      total.failed += part.failed;
      total.errors.push(...part.errors);
      total.tickets.push(...part.tickets);
      total.meetBookingIds.push(...part.meetBookingIds);
    }
    total.tickets = total.tickets.slice(0, 5);
    total.upcomingOnline = total.meetBookingIds.length;
    // The upcoming online sessions get their Calendar event and Meet link (a few at a time: each is a call to Google).
    if (makeMeet && total.meetBookingIds.length) {
      const result = { created: 0, reused: 0, failed: 0, reason: '' };
      for (let i = 0; i < total.meetBookingIds.length; i += MEET_CHUNK) {
        setBusy(`Looking for existing events and making Google Meet links… ${i} of ${total.meetBookingIds.length}`);
        const part = await mutate<{ created: number; reused: number; failed: { error: string }[] }>('/api/bookings', 'POST', { action: 'create-meet', bookingIds: total.meetBookingIds.slice(i, i + MEET_CHUNK) });
        if (!part) {
          result.failed += total.meetBookingIds.length - i; // the reason was shown; the rest can be done from the ticket list
          result.reason ||= 'the request failed';
          break;
        }
        result.created += part.created;
        result.reused += part.reused;
        result.failed += part.failed.length;
        result.reason ||= part.failed[0]?.error ?? '';
      }
      setMeetResult(result);
    }
    setBusy('');
    setResult(total);
    await refresh();
  };

  return (
    <Modal title="Import tickets" wide={Boolean(read)} onClose={() => !busy && onClose()}>
      {result ? (
        <ImportSummary report={result} done meetResult={meetResult} onClose={onClose} />
      ) : checked ? (
        <ImportSummary report={checked} busy={busy} onBack={() => setChecked(null)} onRun={run} meet={{ on: makeMeet, onChange: setMakeMeet }} />
      ) : read ? (
        <ImportMatch read={read} mapping={mapping} onMapping={setMapping} onSheet={(sheet) => load(moduleId, upload, sheet)} onBack={() => setRead(null)} onCheck={check} busy={busy} />
      ) : (
        <ImportPick modules={modules} moduleId={moduleId} onModule={(id) => { setModuleId(id); void load(id); }} onFile={choose} onTemplate={() => exportExcel({ template: moduleId })} fileName={upload?.name} busy={busy} />
      )}
    </Modal>
  );
}
