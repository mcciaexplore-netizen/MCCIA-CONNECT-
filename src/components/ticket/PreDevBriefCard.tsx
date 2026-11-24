import { useData } from '../../context/DataContext';
import type { Ticket } from '../../types';

/** Applet Setup and AI Consultation only: emails the client the Pre-Development Brief's questions and a link to the full document (brief + AI prompt gallery). */
export default function PreDevBriefCard({ ticket }: { ticket: Ticket }) {
  const { mutate } = useData();
  const send = () => mutate('/api/send-email', 'POST', { ticketId: ticket.id, preDevBrief: true }, 'Pre-Development Brief sent');

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Pre-Development Brief</h2>
      <div className="flex items-center justify-between rounded-md bg-page px-4 py-3">
        <span className="text-ink-2">Emails the client the brief's questions and a link to the full document (it also has the AI prompt gallery the team builds from).</span>
        <button className="btn" onClick={send}>Send to client</button>
      </div>
    </section>
  );
}
