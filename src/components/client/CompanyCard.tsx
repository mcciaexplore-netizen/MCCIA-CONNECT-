import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { BLANK_CLIENT, CLIENT_FIELDS, clientText, type Client, type ClientInput, type CompanyRow } from '../../types';
import ClientFields from '../ui/ClientFields';
import Icon from '../ui/Icon';
import Modal from '../ui/Modal';

/** What belongs to the company itself: its name and the details every contact of it shares. */
const KEYS = ['companyName', 'udyamNo', 'isMember', 'membershipId', 'scale', 'industry', 'subSector', 'district', 'employmentRange', 'onlinePresence'] as const;

const valuesOf = (company: CompanyRow, client?: Client): ClientInput => ({
  ...BLANK_CLIENT,
  ...(client && Object.fromEntries(KEYS.map((key) => [key, key === 'isMember' ? client.isMember : clientText(client, key)]))),
  companyName: company.name,
});

function EditCompany({ company, members, onClose }: { company: CompanyRow; members: Client[]; onClose: () => void }) {
  const { mutate } = useData();
  const [start] = useState(() => valuesOf(company, members[0]));
  const [value, setValue] = useState(start);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(KEYS.filter((key) => value[key] !== start[key]).map((key) => [key, value[key]])); // only what was changed is sent
    if (!Object.keys(changed).length) return onClose();
    if (await mutate('/api/clients', 'PATCH', { companyId: company.id, company: changed }, 'Company updated')) onClose();
  };

  return (
    <Modal title="Edit company" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-ink-2">Changes apply to all {members.length} {members.length === 1 ? 'contact' : 'contacts'} of this company.</p>
        <ClientFields keys={[...KEYS]} relaxed value={value} onChange={setValue} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Save company</button>
        </div>
      </form>
    </Modal>
  );
}

/** The company's own details (read from its first contact: the contacts share them) with an Edit button. */
export default function CompanyCard({ company, members }: { company: CompanyRow; members: Client[] }) {
  const [editing, setEditing] = useState(false);
  const first = members[0];
  const fields = CLIENT_FIELDS.filter((f) => f.key !== 'companyName' && KEYS.includes(f.key as (typeof KEYS)[number]) && (f.key !== 'membershipId' || first?.isMember));

  return (
    <section className="card mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Company details</h2>
        <button className="btn px-2 py-1 text-xs" onClick={() => setEditing(true)}><Icon name="pencil" /> Edit company</button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="break-words">{(first && clientText(first, key)) || '—'}</dd>
          </div>
        ))}
      </dl>
      {members.length > 1 && <p className="mt-3 text-xs text-ink-3">Shown from {first.personName}. An edit applies to all {members.length} contacts.</p>}
      {editing && <EditCompany company={company} members={members} onClose={() => setEditing(false)} />}
    </section>
  );
}
