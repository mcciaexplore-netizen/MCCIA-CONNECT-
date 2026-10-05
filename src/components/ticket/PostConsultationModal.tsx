import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import type { Ticket } from '../../types';
import Modal from '../ui/Modal';
import QuestionFields from '../ui/QuestionFields';

/** The post-consultation form (the module's questions) in a dialog: fills it in, or edits what is saved. */
export default function PostConsultationModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { getModule, mutate } = useData();
  const [values, setValues] = useState<Record<string, string>>(ticket.postConsultationData);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const done = await mutate('/api/tickets', 'PATCH', { id: ticket.id, postConsultation: values }, 'Post-consultation notes saved');
    setSaving(false);
    if (done) onClose();
  };

  return (
    <Modal title="Post-consultation notes" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <QuestionFields questions={getModule(ticket.moduleId)?.postQuestions ?? []} values={values} onChange={setValues} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
