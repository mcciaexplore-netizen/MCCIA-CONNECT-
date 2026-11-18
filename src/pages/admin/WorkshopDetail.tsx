import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import ParticipantForm from '../../components/sections/ParticipantForm';
import WorkshopForm from '../../components/sections/WorkshopForm';
import DataState from '../../components/ui/DataState';
import DataTable, { type Column } from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Pager, { pageOf } from '../../components/ui/Pager';
import StatCard from '../../components/ui/StatCard';
import { exportPdf } from '../../lib/pdf';
import { attended, dayText, workshopDate, WorkshopStatusPill } from '../../lib/workshops';
import { WORKSHOP_KIND_LABELS, type Participant } from '../../types';

const dash = <span className="text-ink-3">—</span>;
const text = (value: string | null) => value || dash;

/** One workshop: its details and everyone registered for it (the columns of the workshop sheet). */
export default function WorkshopDetail() {
  const { workshopId } = useParams();
  const { workshops, participants, mutate } = useData();
  const page = usePageData('workshops', 'participants');
  const [search, setSearch] = useState('');
  const [pageNo, setPageNo] = useState(1);
  const [editingWorkshop, setEditingWorkshop] = useState(false);
  const [editing, setEditing] = useState<Participant | 'new' | null>(null);

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;
  const workshop = workshops.find((w) => w.id === workshopId);
  if (!workshop) return <div className="card"><EmptyState icon="presentation" message="This workshop does not exist (any more)." /></div>;

  const people = participants.filter((p) => p.workshopId === workshop.id);
  const query = search.trim().toLowerCase();
  const rows = people.filter((p) => !query || `${p.personName} ${p.companyName ?? ''} ${p.email ?? ''} ${p.phone ?? ''} ${p.udyamNo ?? ''} ${p.membershipNo ?? ''}`.toLowerCase().includes(query));
  const { rows: shown } = pageOf(rows, pageNo);

  const columns: Column<Participant>[] = [
    { header: 'Name', cell: (p) => <span className="font-medium">{p.personName}</span> },
    { header: 'Company Name', cell: (p) => text(p.companyName) },
    { header: 'Membership No', cell: (p) => text(p.membershipNo) },
    { header: 'UDYAM No', cell: (p) => text(p.udyamNo) },
    { header: 'Tel. / Mobile', cell: (p) => text(p.phone) },
    { header: 'Email', cell: (p) => text(p.email) },
    { header: 'Designation', cell: (p) => text(p.designation) },
    { header: 'Mode', cell: (p) => text(p.mode) },
    { header: 'Month', cell: (p) => text(p.month) },
    { header: 'Date', cell: (p) => dayText(p.sessionDate) || dash },
    { header: 'Time Slot', cell: (p) => text(p.timeSlot) },
    { header: 'Confirmation', cell: (p) => text(p.confirmationStatus) },
    { header: 'Attendance', cell: (p) => text(p.attendance) },
    { header: 'Deployment', cell: (p) => text(p.deploymentStatus) },
    { header: 'Allocation', cell: (p) => text(p.allocation) },
    { header: 'Cons-Status', cell: (p) => text(p.consStatus) },
    { header: 'Calling', cell: (p) => text(p.calling) },
  ];

  const remove = (p: Participant) => window.confirm(`Remove ${p.personName} from ${workshop.code}?`) && mutate('/api/participants', 'DELETE', { id: p.id }, 'Participant removed');
  const exportParticipants = () =>
    exportPdf({
      title: [workshop.code, workshop.title].filter(Boolean).join(' · '),
      subtitle: `Registered ${people.length} · Attended ${people.filter(attended).length}`,
      headers: columns.map((c) => c.header),
      rows: rows.map((p) => [p.personName, p.companyName, p.membershipNo, p.udyamNo, p.phone, p.email, p.designation, p.mode, p.month, dayText(p.sessionDate), p.timeSlot, p.confirmationStatus, p.attendance, p.deploymentStatus, p.allocation, p.consStatus, p.calling]),
    }) || toast.error('Allow pop-ups for this site to export a PDF');
  const details = [workshopDate(workshop), workshop.mode === 'online' ? 'Online' : 'Offline', workshop.venue, workshop.trainer && `Trainer: ${workshop.trainer}`, workshop.organisation].filter(Boolean);

  return (
    <div>
      <Link to="/admin/workshops" className="mb-3 inline-block text-primary hover:underline">← All workshops</Link>
      <div className="page-header">
        <div>
          <h1 className="page-title flex flex-wrap items-center gap-2">{[workshop.code, workshop.title].filter(Boolean).join(' · ')} <WorkshopStatusPill status={workshop.status} /></h1>
          <p className="page-sub">{WORKSHOP_KIND_LABELS[workshop.kind]}{details.length ? ` · ${details.join(' · ')}` : ''}</p>
          {workshop.notes && <p className="mt-1 whitespace-pre-line text-ink-2">{workshop.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={exportParticipants}>Export PDF</button>
          <button className="btn" onClick={() => setEditingWorkshop(true)}>Edit workshop</button>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Add participant</button>
        </div>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard icon="users" label="Registered" value={people.length} />
        <StatCard icon="check" label="Attended" value={people.filter(attended).length} />
        <StatCard icon="user-x" label="Did not attend" value={people.length - people.filter(attended).length} />
      </div>
      <input className="input mb-4 max-w-xs" placeholder="Search name, company, email…" value={search} onChange={(e) => { setSearch(e.target.value); setPageNo(1); }} />
      <DataTable columns={columns} data={shown} rowKey={(p) => p.id} onRowClick={setEditing} onEdit={setEditing} onDelete={remove} empty="No participants yet." emptyIcon="users" emptyAction={people.length ? undefined : { label: '+ Add participant', onClick: () => setEditing('new') }} />
      <Pager total={rows.length} page={pageNo} onPage={setPageNo} />
      {editingWorkshop && <WorkshopForm workshop={workshop} onClose={() => setEditingWorkshop(false)} />}
      {editing && <ParticipantForm workshopId={workshop.id} participant={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
