import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { confirmCancel, postValues } from '../../lib/utils';
import { ADMIN_ONLY_FIELDS, PAYMENT_LABELS, PAYMENT_STATUSES, statusOf, type Ticket } from '../../types';
import Modal from '../ui/Modal';
import QuestionFields from '../ui/QuestionFields';

/**
 * The consultant form (the module's questions) in a dialog: one form, one Save. Its Consultation Status and Payment Status are the ticket's own
 * (the status and payment rules apply: cancelling asks first, payment is the admin's), the rest is saved with the notes.
 */
export default function PostConsultationModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { getModule, getSession, role, mutate } = useData();
  const [values, setValues] = useState(() => postValues(ticket, getSession(ticket.id)?.booking));
  const [saving, setSaving] = useState(false);
  const admin = role === 'super_admin';
  const questions = (getModule(ticket.moduleId)?.postQuestions ?? []).filter((q) => admin || !ADMIN_ONLY_FIELDS.includes(q.id));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const status = statusOf(values.consultation_status ?? '');
    const payment = PAYMENT_STATUSES.find((p) => PAYMENT_LABELS[p] === values.payment_status);
    if (status === 'cancelled' && ticket.status !== 'cancelled' && !confirmCancel()) return;
    setSaving(true);
    // The Fireflies link shown in the form is not copied into the answers: it stays the session's live link until someone writes another one.
    const answers = { ...values };
    if (answers.recording_link === getSession(ticket.id)?.booking.recordingLink) delete answers.recording_link;
    const body = { id: ticket.id, postConsultation: answers, ...(status && status !== ticket.status && { status }), ...(admin && payment && payment !== ticket.paymentStatus && { paymentStatus: payment }) };
    const done = await mutate('/api/tickets', 'PATCH', body, 'Post-consultation notes saved');
    setSaving(false);
    if (done) onClose();
  };

  return (
    <Modal title="Post-consultation notes" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <QuestionFields questions={questions} values={values} onChange={setValues} />
        <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-line bg-white px-5 py-3">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
