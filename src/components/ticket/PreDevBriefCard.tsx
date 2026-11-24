import { useNavigate } from 'react-router';
import { useData } from '../../context/DataContext';
import { preDevBriefDone, type Ticket } from '../../types';

/** Applet Setup and AI Consultation only: emails the client a link to fill in the Pre-Development Brief, and shows whether it's been received. */
export default function PreDevBriefCard({ ticket }: { ticket: Ticket }) {
  const { role, mutate } = useData();
  const navigate = useNavigate();
  const send = () => mutate('/api/send-email', 'POST', { ticketId: ticket.id, preDevBrief: true }, 'Pre-Development Brief sent');
  const received = preDevBriefDone(ticket.preDevBriefData);

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Pre-Development Brief</h2>
      <div className="flex items-center justify-between rounded-md bg-page px-4 py-3">
        {received ? (
          <>
            <span className="text-ink-2">The client has filled in the Pre-Development Brief.</span>
            <button className="btn" onClick={() => navigate(`/${role === 'super_admin' ? 'admin' : 'coordinator'}/predev-briefs`)}>View answers</button>
          </>
        ) : (
          <>
            <span className="text-ink-2">Emails the client a link to fill in the brief online (plus the full document, which also has the AI prompt gallery the team builds from).</span>
            <button className="btn" onClick={send}>Send to client</button>
          </>
        )}
      </div>
    </section>
  );
}
