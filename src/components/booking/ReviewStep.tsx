import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { formatTime } from '../../lib/utils';
import { normalizePhone, type BookingMode, type ClientInput, type PublicModule } from '../../types';

interface Props {
  module: PublicModule;
  client: ClientInput;
  answers: Record<string, string>;
  mode: BookingMode;
  startsAt: string;
  coordinator?: string; // shown when staff book on a client's behalf
  titles?: [string, string]; // the details section and the slot section
  onEdit: (step: 1 | 2) => void;
}

function Section({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line">
      <div className="flex items-center justify-between border-b border-line bg-page px-4 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-2">{title}</h3>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onEdit}>Edit</button>
      </div>
      <dl className="divide-y divide-line">{children}</dl>
    </section>
  );
}

const Row = ({ label, value }: { label: string; value?: string }) => (
  <div className="flex justify-between gap-4 px-4 py-2">
    <dt className="text-ink-2">{label}</dt>
    <dd className="text-right font-medium">{value || '—'}</dd>
  </div>
);

/** The last step: everything entered and chosen, with Edit links back to the details (1) and the slot (2). */
export default function ReviewStep({ module, client, answers, mode, startsAt, coordinator, titles = ['Your details', 'Your slot'], onEdit }: Props) {
  const start = new Date(startsAt);
  return (
    <div className="space-y-4">
      <Section title={titles[0]} onEdit={() => onEdit(1)}>
        <Row label="Company Name" value={client.companyName} />
        <Row label="Person Name" value={client.personName} />
        <Row label="Email" value={client.email} />
        <Row label="Phone" value={normalizePhone(client.phone) ?? client.phone} />
        <Row label="Scale" value={client.scale} />
        <Row label="Industry" value={client.industry} />
        <Row label="UDYAM No." value={client.udyamNo} />
        <Row label="Job Title" value={client.jobTitle} />
        <Row label="Member / Non-Member" value={client.isMember ? `Member${client.membershipId ? ` (${client.membershipId})` : ''}` : 'Non-Member'} />
        <Row label="Acquisition From" value={client.acquisitionFrom} />
        {module.questions.map((question) => (
          <Row key={question.id} label={question.label} value={answers[question.id]} />
        ))}
      </Section>
      <Section title={titles[1]} onEdit={() => onEdit(2)}>
        <Row label="Module" value={module.name} />
        <Row label="Mode" value={mode === 'online' ? 'Online (Google Meet)' : 'Offline (in person)'} />
        <Row label="Date" value={format(start, 'EEEE, d MMMM yyyy')} />
        <Row label="Time" value={formatTime(startsAt)} />
        {mode === 'offline' && <Row label="Venue" value={module.venue} />}
        {coordinator && <Row label="Coordinator" value={coordinator} />}
      </Section>
    </div>
  );
}
