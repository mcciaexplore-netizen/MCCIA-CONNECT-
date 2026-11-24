import { useState } from 'react';
import { usePageData, useData } from '../../context/DataContext';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import Modal from '../../components/ui/Modal';
import { formatDateTime } from '../../lib/utils';
import { PRE_DEV_BRIEF_DETAILS, PRE_DEV_BRIEF_SECTIONS, preDevBriefDone, type Ticket } from '../../types';

/** Every Pre-Development Brief a client has submitted (admins see all, coordinators their own tickets), newest first. */
export default function PreDevBriefs() {
  const { tickets, getClient, getModule } = useData();
  const page = usePageData('tickets', 'clients');
  const [viewing, setViewing] = useState<Ticket | null>(null);

  const rows = tickets.filter((t) => preDevBriefDone(t.preDevBriefData)).sort((a, b) => (b.preDevBriefSubmittedAt ?? '').localeCompare(a.preDevBriefSubmittedAt ?? ''));

  const columns: Column<Ticket>[] = [
    { header: 'Company', cell: (t) => getClient(t.clientId)?.companyName ?? '—' },
    { header: 'Contact', cell: (t) => getClient(t.clientId)?.personName ?? '—' },
    { header: 'Module', cell: (t) => getModule(t.moduleId)?.name ?? '—' },
    { header: 'Ticket', cell: (t) => t.ticketNumber },
    { header: 'Submitted', cell: (t) => (t.preDevBriefSubmittedAt ? formatDateTime(t.preDevBriefSubmittedAt) : '—') },
  ];

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pre-Dev Briefs</h1>
          <p className="page-sub">{rows.length} brief{rows.length === 1 ? '' : 's'} received from clients. Open one to see the full App Details and answers.</p>
        </div>
      </div>
      <DataTable columns={columns} data={rows} rowKey={(t) => t.id} onRowClick={setViewing} empty="No briefs received yet." emptyIcon="check" />
      {viewing && <PreDevBriefDetail ticket={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function PreDevBriefDetail({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { getClient, getModule } = useData();
  const client = getClient(ticket.clientId);
  const module = getModule(ticket.moduleId);
  const data = ticket.preDevBriefData;

  return (
    <Modal title="Pre-Development Brief" onClose={onClose}>
      <div className="space-y-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-ink-3">Company</dt><dd>{client?.companyName ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-3">Module</dt><dd>{module?.name ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-3">Ticket</dt><dd>{ticket.ticketNumber}</dd></div>
          <div><dt className="text-xs text-ink-3">Submitted</dt><dd>{ticket.preDevBriefSubmittedAt ? formatDateTime(ticket.preDevBriefSubmittedAt) : '—'}</dd></div>
        </dl>
        <div>
          <h3 className="mb-2 font-semibold">App details</h3>
          <dl className="space-y-2">
            {PRE_DEV_BRIEF_DETAILS.map((f) => (
              <div key={f.id}>
                <dt className="text-xs text-ink-3">{f.label}</dt>
                <dd className="whitespace-pre-line">{data[f.id] || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        {PRE_DEV_BRIEF_SECTIONS.map((section) => (
          <div key={section.heading}>
            <h3 className="mb-2 font-semibold">{section.heading}</h3>
            <dl className="space-y-3">
              {section.questions.map((q) => (
                <div key={q.id}>
                  <dt className="text-xs text-ink-3">{q.q}</dt>
                  <dd className="whitespace-pre-line">{data[q.id] || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Modal>
  );
}
