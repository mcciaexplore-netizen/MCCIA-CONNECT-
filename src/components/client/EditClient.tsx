import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { toClientInput } from '../../lib/utils';
import { CLIENT_FIELDS, EMAIL_PATTERN, type Client, type ClientInput } from '../../types';
import ClientFields from '../ui/ClientFields';
import Modal from '../ui/Modal';

/** Every detail except the company name, for coordinators (changing it moves the client to another company: an admin does that). */
const WITHOUT_COMPANY = CLIENT_FIELDS.map((field) => field.key).filter((key) => key !== 'companyName');

/** Only what the server insists on is checked here: older records may have gaps in the other details. */
function problems({ companyName, personName, email, phone }: ClientInput, company: boolean) {
  const errors: Partial<Record<keyof ClientInput, string>> = {};
  if (company && !companyName.trim()) errors.companyName = 'Company name is required';
  if (!personName.trim()) errors.personName = 'Person name is required';
  if (!email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!phone.trim()) errors.phone = 'Phone is required';
  return errors;
}

/**
 * The dialog that edits one client's details: admins any client (a different company name moves the client to that company), coordinators
 * their own clients without the company name.
 */
export default function EditClient({ client, onClose }: { client: Client; onClose: () => void }) {
  const { mutate, role } = useData();
  const admin = role === 'super_admin';
  const [start] = useState(() => toClientInput(client));
  const [value, setValue] = useState(start);
  const [errors, setErrors] = useState<Partial<Record<keyof ClientInput, string>>>({});

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const found = problems(value, admin);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (JSON.stringify(value) === JSON.stringify(start)) return onClose();
    if (await mutate('/api/clients', 'PATCH', { id: client.id, client: value }, 'Client saved')) onClose();
  };

  return (
    <Modal title={`Edit ${client.personName}`} onClose={onClose} wide>
      <form onSubmit={save} noValidate className="space-y-4">
        {!admin && <p className="text-ink-2">Company: <b>{client.companyName}</b>. Ask an admin if the company name needs to change.</p>}
        <ClientFields relaxed keys={admin ? undefined : WITHOUT_COMPANY} value={value} onChange={setValue} errors={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Save client</button>
        </div>
      </form>
    </Modal>
  );
}
