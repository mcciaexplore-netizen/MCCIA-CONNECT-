import { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { formatDate, toClientInput, useIsMobile } from '../../lib/utils';
import { ACQUISITION_OPTIONS, INDUSTRY_OPTIONS, SCALE_OPTIONS, type Client, type ClientInput, type CoordinatorHistoryEntry } from '../../types';
import Icon from '../ui/Icon';
import ReassignModal from '../ui/ReassignModal';

type TextKey = Exclude<keyof ClientInput, 'isMember' | 'membershipId'>;
type Editing = TextKey | 'member' | 'all' | null;

const FIELDS: { key: TextKey; label: string; type?: string; options?: readonly string[] }[] = [
  { key: 'companyName', label: 'Company' },
  { key: 'personName', label: 'Name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'jobTitle', label: 'Job title' },
  { key: 'industry', label: 'Industry', options: INDUSTRY_OPTIONS },
  { key: 'scale', label: 'Scale', options: SCALE_OPTIONS },
  { key: 'udyamNo', label: 'UDYAM' },
  { key: 'acquisitionFrom', label: 'Acquisition', options: ACQUISITION_OPTIONS },
];

/** The client's coordinator changes (assignments and reassignments) and the Assign / Reassign button. Admin only. */
function CoordinatorHistory({ client }: { client: Client }) {
  const { get, mutate } = useData();
  const mobile = useIsMobile();
  const [history, setHistory] = useState<CoordinatorHistoryEntry[]>([]);
  const [reassigning, setReassigning] = useState(false);

  // `client` is a new object after every data refresh, so this reloads after a reassignment too.
  useEffect(() => {
    get<CoordinatorHistoryEntry[]>(`/api/clients?history=${client.id}`).then(setHistory).catch(() => {});
  }, [get, client]);

  return (
    <>
      <hr className="my-4 border-line" />
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Coordinator History</h3>
        <button className="btn px-2 py-1 text-xs" onClick={() => setReassigning(true)}>{client.assignedCoordinatorId ? 'Reassign' : 'Assign'}</button>
      </div>
      {history.length === 0 ? (
        <p className="text-ink-3">No coordinator yet.</p>
      ) : (
        mobile ? (
        <ul className="space-y-2">
          {history.map((entry) => (
            <li key={entry.id} className="rounded-md border border-line p-3">
              <p className="font-medium">
                {entry.coordinator}
                {entry.from && <span className="font-normal text-ink-3"> (from {entry.from})</span>}
              </p>
              <p className="text-ink-2">{formatDate(entry.at)} · by {entry.assignedBy}</p>
              {entry.reason && <p className="mt-1">{entry.reason}</p>}
            </li>
          ))}
        </ul>
        ) : (
        <table className="w-full table-fixed text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase text-ink-3">
              <th className="w-[33%] pb-1 pr-1 font-semibold">Coordinator</th>
              <th className="w-[22%] pb-1 pr-1 font-semibold">Assigned By</th>
              <th className="w-[18%] pb-1 pr-1 font-semibold">Date</th>
              <th className="pb-1 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id} className="border-t border-line align-top">
                <td className="break-words py-1.5 pr-1 font-medium">
                  {entry.coordinator}
                  {entry.from && <span className="block font-normal text-ink-3">from {entry.from}</span>}
                </td>
                <td className="break-words py-1.5 pr-1">{entry.assignedBy}</td>
                <td className="py-1.5 pr-1">{formatDate(entry.at)}</td>
                <td className="break-words py-1.5 text-ink-2">{entry.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )
      )}

      {reassigning && (
        <ReassignModal
          currentId={client.assignedCoordinatorId}
          onClose={() => setReassigning(false)}
          onConfirm={(coordinatorId, reason) =>
            mutate('/api/clients', 'PUT', { clientId: client.id, coordinatorId, reason }, client.assignedCoordinatorId ? 'Client reassigned' : 'Coordinator assigned')
          }
        />
      )}
    </>
  );
}

/**
 * Left column: click any property to edit it, then Save changes. Below it, the client's coordinator history.
 * Read-only (coordinators): plain values, no editing, no history.
 */
export default function ContactPanel({ client, readOnly = false }: { client: Client; readOnly?: boolean }) {
  const { mutate, getCoordinator } = useData();
  const [draft, setDraft] = useState(toClientInput(client));
  const [editing, setEditing] = useState<Editing>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toClientInput(client));

  const save = async () => {
    const saved = await mutate<Client>('/api/clients', 'PATCH', { id: client.id, client: draft }, 'Client saved');
    if (saved) {
      setDraft(toClientInput(saved));
      setEditing(null);
    }
  };
  const cancel = () => {
    setDraft(toClientInput(client));
    setEditing(null);
  };
  const open = (key: Exclude<Editing, null>) => editing === 'all' || editing === key;
  const valueButton = (key: Exclude<Editing, null>, text: string) =>
    readOnly ? (
      <span className="block break-words px-1 py-0.5">{text}</span>
    ) : (
      <button title="Click to edit" className="block w-full break-words rounded px-1 py-0.5 text-left hover:bg-page" onClick={() => setEditing(key)}>{text}</button>
    );

  return (
    <aside className="w-full border-b border-line bg-white p-4 xl:w-[280px] xl:shrink-0 xl:border-b-0 xl:border-r">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">Contact Properties</h3>
        {!readOnly && <button title="Edit all properties" className="rounded p-1 text-ink-2 hover:bg-page hover:text-primary" onClick={() => setEditing('all')}><Icon name="pencil" /></button>}
      </div>

      <dl className="space-y-3">
        {FIELDS.map(({ key, label, type, options }) => (
          <div key={key}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd>
              {open(key) && options ? (
                <select className="input" autoFocus={editing === key} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}>
                  <option value="">—</option>
                  {(draft[key] && !options.includes(draft[key]) ? [...options, draft[key]] : options).map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : open(key) ? (
                <input className="input" type={type ?? 'text'} autoFocus={editing === key} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
              ) : (
                valueButton(key, draft[key] || '—')
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-xs text-ink-3">Member status</dt>
          <dd>
            {open('member') ? (
              <div className="space-y-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isMember} onChange={(e) => setDraft({ ...draft, isMember: e.target.checked })} />MCCIA member</label>
                {draft.isMember && <input className="input" placeholder="Membership ID" value={draft.membershipId} onChange={(e) => setDraft({ ...draft, membershipId: e.target.value })} />}
              </div>
            ) : (
              valueButton('member', draft.isMember ? `Member${draft.membershipId ? ` · ${draft.membershipId}` : ''}` : 'Not a member')
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Contact Owner</dt>
          <dd className="px-1">{getCoordinator(client.assignedCoordinatorId)?.name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">Created</dt>
          <dd className="px-1">{formatDate(client.createdAt)}</dd>
        </div>
      </dl>

      {(dirty || editing) && (
        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary" disabled={!dirty} onClick={save}>Save changes</button>
          <button className="btn" onClick={cancel}>Cancel</button>
        </div>
      )}

      {!readOnly && <CoordinatorHistory client={client} />}
    </aside>
  );
}
