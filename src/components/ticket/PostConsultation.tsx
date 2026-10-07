import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { postValues } from '../../lib/utils';
import type { Ticket } from '../../types';
import PostConsultationModal from './PostConsultationModal';

/** "Post-Consultation Notes" card with its Fill Form / Edit button. */
export default function PostConsultation({ ticket }: { ticket: Ticket }) {
  const { getModule, getSession } = useData();
  const [open, setOpen] = useState(false);
  const questions = getModule(ticket.moduleId)?.postQuestions ?? [];
  const data = postValues(ticket, getSession(ticket.id)?.booking); // the ticket's own status and payment are part of the form
  const filled = Object.keys(ticket.postConsultationData).length > 0;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Post-Consultation Notes</h2>
        {filled && <button className="btn px-2 py-1 text-xs" onClick={() => setOpen(true)}>Edit</button>}
      </div>
      {filled ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {questions.map((q) => (
            <div key={q.id} className={q.type === 'textarea' ? 'sm:col-span-2' : ''}>
              <dt className="text-xs text-ink-3">{q.label}</dt>
              <dd className="whitespace-pre-line">{data[q.id] || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex items-center justify-between rounded-md border border-gold bg-gold-light px-4 py-3 text-[#8a6d1c]">
          <span className="font-medium">Not filled yet</span>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>Fill Form</button>
        </div>
      )}
      {open && <PostConsultationModal ticket={ticket} onClose={() => setOpen(false)} />}
    </section>
  );
}
