import { useState } from 'react';
import toast from 'react-hot-toast';
import { usePageData, useData } from '../../context/DataContext';
import ApplicationForm from '../../components/sections/ApplicationForm';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import Icon from '../../components/ui/Icon';
import type { Application } from '../../types';

/** Every application the studio uses: its name, what it is for and the link to open it. Admins add, edit and remove; coordinators open. */
export default function Applications() {
  const { applications, role, mutate } = useData();
  const page = usePageData('applications');
  const admin = role === 'super_admin';
  const [editing, setEditing] = useState<Application | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const shown = applications.filter((a) => !query || `${a.name} ${a.description ?? ''} ${a.url}`.toLowerCase().includes(query));
  const remove = (a: Application) => window.confirm(`Remove ${a.name} from the list?`) && mutate('/api/applications', 'DELETE', { id: a.id }, 'Application removed');

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-sub">{applications.length} applications. Open one to go straight to it.</p>
        </div>
        {admin && <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add application</button>}
      </div>
      {applications.length > 0 && <input className="input mb-4 max-w-xs" placeholder="Search applications…" value={search} onChange={(e) => setSearch(e.target.value)} />}
      {!shown.length ? (
        <div className="card">
          <EmptyState icon="apps" message={applications.length ? 'No application matches that search.' : 'No applications yet.'} action={admin && !applications.length ? { label: '+ Add application', onClick: () => setEditing('new') } : undefined} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <div key={a.id} className="card flex flex-col">
              <h2 className="font-semibold">{a.name}</h2>
              <p className="mt-1 flex-1 whitespace-pre-line text-ink-2">{a.description || <span className="text-ink-3">No description</span>}</p>
              <p className="mt-3 truncate text-xs text-ink-3" title={a.url}>{a.url}</p>
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <a className="btn btn-primary" href={a.url} target="_blank" rel="noreferrer"><Icon name="link" className="h-4 w-4" /> Open</a>
                <button className="btn" onClick={() => navigator.clipboard.writeText(a.url).then(() => toast.success('Link copied'), () => toast.error('Could not copy the link'))}>Copy link</button>
                {admin && (
                  <span className="ml-auto flex gap-1 text-ink-2">
                    <button title="Edit" className="rounded p-1 hover:text-primary" onClick={() => setEditing(a)}><Icon name="pencil" /></button>
                    <button title="Remove" className="rounded p-1 hover:text-danger" onClick={() => remove(a)}><Icon name="trash" /></button>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ApplicationForm application={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
