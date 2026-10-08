import type { ImportReport } from '../../types';

interface Props {
  report: ImportReport;
  done?: boolean; // the import has run (the report is what it did), else it is a check (what it would do)
  busy?: string;
  onBack?: () => void;
  onRun?: () => void;
  onClose?: () => void;
}

const Stat = ({ label, value, tone }: { label: string; value: number; tone?: string }) => (
  <div className="rounded-md bg-page px-4 py-3">
    <p className={`text-2xl font-semibold ${tone ?? ''}`}>{value}</p>
    <p className="text-xs text-ink-3">{label}</p>
  </div>
);

/** Import steps 3 and 4: what the check found (and the button that imports), then what the import did. */
export default function ImportSummary({ report, done, busy, onBack, onRun, onClose }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={done ? 'Tickets imported' : 'Ready to import'} value={done ? report.created : report.ready} tone="text-primary" />
        <Stat label="Already in the app (skipped)" value={report.duplicates} />
        <Stat label="Rows with a problem (skipped)" value={report.failed} tone={report.failed ? 'text-danger' : ''} />
      </div>
      {done && report.tickets.length > 0 && <p className="text-ink-2">Starting with {report.tickets.join(', ')}. They are in the Tickets list now and are being added to the Excel sheet.</p>}
      {report.warnings.map((warning) => <p key={warning} className="rounded-md bg-gold-light px-3 py-2 text-[#8a6d1c]">{warning}</p>)}
      {report.errors.length > 0 && (
        <div className="max-h-[30vh] overflow-auto rounded-md border border-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-page text-xs uppercase text-ink-3"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Problem</th></tr></thead>
            <tbody className="divide-y divide-line">
              {report.errors.map((error) => <tr key={error.row}><td className="px-3 py-1.5 font-medium">{error.row}</td><td className="px-3 py-1.5">{error.message}</td></tr>)}
            </tbody>
          </table>
          {report.failed > report.errors.length && <p className="px-3 py-2 text-xs text-ink-3">…and {report.failed - report.errors.length} more.</p>}
        </div>
      )}
      {!done && report.ready === 0 && <p className="text-ink-2">Nothing can be imported from this file yet. Fix the rows above in the file (or the matching) and check again.</p>}
      {busy && <p role="status" className="text-ink-2">{busy}</p>}
      <div className="flex justify-between">
        {done ? <span /> : <button type="button" className="btn" disabled={Boolean(busy)} onClick={onBack}>Back</button>}
        {done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={report.ready === 0 || Boolean(busy)} onClick={onRun}>Import {report.ready} {report.ready === 1 ? 'ticket' : 'tickets'}</button>
        )}
      </div>
    </div>
  );
}
