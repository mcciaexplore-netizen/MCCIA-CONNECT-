import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { toClientInput } from '../../lib/utils';
import { EMAIL_PATTERN, type Client, type ClientInput } from '../../types';
import ClientFields from '../ui/ClientFields';
import Modal from '../ui/Modal';

/** Only what the server insists on is checked here: older records may have gaps in the other details. */
function problems({ companyName, personName, email, phone }: ClientInput) {
  const errors: Partial<Record<keyof ClientInput, string>> = {};
  if (!companyName.trim()) errors.companyName = 'Company name is required';
  if (!personName.trim()) errors.personName = 'Person name is required';
  if (!email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!phone.trim()) errors.phone = 'Phone is required';
  return errors;
}

/** The dialog that edits one client's details (admins). A different company name moves the client to that company. */
export default function EditClient({ client, onClose }: { client: Client; onClose: () => void }) {
  const { mutate } = useData();
  const [start] = useState(() => toClientInput(client));
  const [value, setValue] = useState(start);
  const [errors, setErrors] = useState<Partial<Record<keyof ClientInput, string>>>({});

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const found = problems(value);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (JSON.stringify(value) === JSON.stringify(start)) return onClose();
    if (await mutate('/api/clients', 'PATCH', { id: client.id, client: value }, 'Client saved')) onClose();
  };

  return (
    <Modal title={`Edit ${client.personName}`} onClose={onClose} wide>
      <form onSubmit={save} noValidate className="space-y-4">
        <ClientFields relaxed value={value} onChange={setValue} errors={errors} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Save client</button>
        </div>
      </form>
    </Modal>
  );
}
